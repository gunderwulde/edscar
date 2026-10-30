/**
 * Barra Euler-Bernoulli plana (análisis "2D-XZ"), escrita desde cero a partir de la teoría clásica.
 *
 * GDL locales (6): [u_i, w_i, θ_i, u_j, w_j, θ_j] = [ux, uz, ry] locales en i y j, con θ = θy = −dw/dx (ADR-001 §4).
 * Fuerzas de extremo en el mismo orden: [Fx_i, Fz_i, My_i, Fx_j, Fz_j, My_j] (nudo sobre barra, ADR-001 §6.2).
 *
 * Rigidez de flexión x–z. Con funciones de Hermite en ξ = x/L (w = Σ N_k·q_k, q = [w_i, θ_i, w_j, θ_j]):
 *   N1 = 1 − 3ξ² + 2ξ³,  N2 = −L(ξ − 2ξ² + ξ³),  N3 = 3ξ² − 2ξ³,  N4 = L(ξ² − ξ³)
 * (el signo de N2, N4 sale de θ = −w'), k_ab = ∫ EI·N_a''·N_b'' dx da
 *   k = EI/L³ · [[12, −6L, −12, −6L], [−6L, 4L², 6L, 2L²], [−12, 6L, 12, 6L], [−6L, 2L², 6L, 4L²]].
 * Axil: k = EA/L·[[1, −1], [−1, 1]] con funciones lineales 1 − ξ, ξ.
 *
 * Cargas nodales equivalentes (vector consistente; para la barra prismática de Euler-Bernoulli coinciden con las
 * reacciones exactas de empotramiento perfecto cambiadas de signo, porque las funciones de Hermite son la
 * solución homogénea exacta):
 *   distribuida q(x): f_eq = ∫ Nᵀ q dx (integrada con Gauss-Legendre de 3 puntos: exacta hasta grado 5; aquí grado ≤ 4);
 *   puntual P en a: f_eq = N(a)ᵀ P;   momento my en a: f_eq,k = −my·N_k'(a) (trabajo virtual my·θ(a), θ = −w').
 * Térmica (ADR-001 §5.1), empotramiento perfecto directo: N = −EA·α·dT, My = −EI·α·gz constantes ⇒
 *   f_emp = [EA·α·dT, 0, EI·α·gz, −EA·α·dT, 0, −EI·α·gz]  (Fx_i = −N(0), My_i = −My(0), Fx_j = N(L), My_j = My(L)).
 * f_emp = −f_eq (+ térmica). Comprobación con ADR-001 §6.2: wz = −w uniforme ⇒ Fz_i = Fz_j = wL/2,
 * My_i = −wL²/12, My_j = +wL²/12.
 *
 * Liberaciones (ADR-005 §1): condensación estática por bloques (axil {0, 3}, flexión {1, 2, 4, 5}) en variables
 * escaladas ũ = D·u (D = 1 en traslaciones, L en giros), con pseudoinversa k̃_RR⁺ = (k̃_RR + c·N·Nᵀ)⁻¹ − N·Nᵀ/c, donde
 * N es el núcleo (modos rígidos con u_C = 0), conocido en forma cerrada, y c = traza(k̃_RR)/n_R (penalización
 * escalada con la rigidez, independiente de las unidades; ver `pinvWithNull`).
 */
import type { LocalAxes } from "./geometry";
import type { Mat } from "./linalg";
import { at, get, pinvWithNull, setM, zeros } from "./linalg";

/** Carga distribuida lineal en ejes locales sobre [a, b] (kN/m por longitud real). */
export interface DistLoad {
  a: number;
  b: number;
  wx1: number;
  wx2: number;
  wz1: number;
  wz2: number;
}
export interface PointForce {
  a: number;
  px: number;
  pz: number;
}
export interface PointMoment {
  a: number;
  my: number;
}
/** Cargas de una barra para un caso, ya en ejes locales y multiplicadas por los factores del caso. */
export interface MemberLoads2D {
  dist: DistLoad[];
  forces: PointForce[];
  moments: PointMoment[];
  /** Σ factor·dT (°C) y Σ factor·gradientZ (°C/m). */
  dT: number;
  gz: number;
}

export const emptyLoads = (): MemberLoads2D => ({ dist: [], forces: [], moments: [], dT: 0, gz: 0 });

export interface BeamProps {
  L: number;
  EA: number;
  EI: number;
  alpha: number;
}

/** Nombres de las liberaciones por GDL local (ADR-005: ux_i, uz_i, ry_i, ux_j, uz_j, ry_j). */
export const RELEASE_NAMES = ["ux_i", "uz_i", "ry_i", "ux_j", "uz_j", "ry_j"] as const;

export const AXIAL = [0, 3] as const;
export const BENDING = [1, 2, 4, 5] as const;

/** Matriz de rigidez local 6×6. */
export function localStiffness(p: BeamProps): Mat {
  const { L, EA, EI } = p;
  const k = zeros(6, 6);
  const a = EA / L;
  const set = (i: number, j: number, v: number): void => {
    setM(k, i, j, v);
  };
  set(0, 0, a);
  set(0, 3, -a);
  set(3, 0, -a);
  set(3, 3, a);
  const c = EI / L ** 3;
  const kb = [
    [12, -6 * L, -12, -6 * L],
    [-6 * L, 4 * L * L, 6 * L, 2 * L * L],
    [-12, 6 * L, 12, 6 * L],
    [-6 * L, 2 * L * L, 6 * L, 4 * L * L],
  ];
  BENDING.forEach((gi, r) => {
    BENDING.forEach((gj, s) => {
      set(gi, gj, c * get(kb, r, s));
    });
  });
  return k;
}

/** Funciones de forma de flexión [N1…N4] en la abscisa x. */
export function hermite(x: number, L: number): [number, number, number, number] {
  const s = x / L;
  return [1 - 3 * s * s + 2 * s ** 3, -L * (s - 2 * s * s + s ** 3), 3 * s * s - 2 * s ** 3, L * (s * s - s ** 3)];
}

/** Derivadas dN_k/dx de las funciones de forma de flexión. */
export function hermiteDx(x: number, L: number): [number, number, number, number] {
  const s = x / L;
  return [(-6 * s + 6 * s * s) / L, -(1 - 4 * s + 3 * s * s), (6 * s - 6 * s * s) / L, 2 * s - 3 * s * s];
}

/** Puntos y pesos de Gauss-Legendre de 3 puntos en [−1, 1]. */
export const GAUSS3: readonly (readonly [number, number])[] = [
  [-Math.sqrt(3 / 5), 5 / 9],
  [0, 8 / 9],
  [Math.sqrt(3 / 5), 5 / 9],
];

/** Integra g en [a, b] con Gauss-Legendre de 3 puntos (exacto para polinomios de grado ≤ 5). */
export function gauss3(a: number, b: number, g: (s: number) => number): number {
  const h = (b - a) / 2;
  const m = (a + b) / 2;
  let sum = 0;
  for (const [t, w] of GAUSS3) sum += w * g(m + h * t);
  return sum * h;
}

/** Valor de una carga lineal en s ∈ [a, b]. */
export const linearAt = (a: number, b: number, v1: number, v2: number, s: number): number => v1 + ((v2 - v1) * (s - a)) / (b - a);

/** Fuerzas de empotramiento perfecto f_emp (6, ejes locales) de las cargas de barra, incluidas las térmicas. */
export function fixedEndForces(p: BeamProps, loads: MemberLoads2D): number[] {
  const { L } = p;
  const feq = [0, 0, 0, 0, 0, 0];
  const add = (k: number, v: number): void => {
    feq[k] = at(feq, k) + v;
  };
  for (const d of loads.dist) {
    const comp = (k: number, fn: (s: number) => number): void => {
      add(k, gauss3(d.a, d.b, fn));
    };
    const wx = (s: number): number => linearAt(d.a, d.b, d.wx1, d.wx2, s);
    const wz = (s: number): number => linearAt(d.a, d.b, d.wz1, d.wz2, s);
    comp(0, (s) => (1 - s / L) * wx(s));
    comp(3, (s) => (s / L) * wx(s));
    BENDING.forEach((g, r) => {
      comp(g, (s) => at(hermite(s, L), r) * wz(s));
    });
  }
  for (const f of loads.forces) {
    add(0, (1 - f.a / L) * f.px);
    add(3, (f.a / L) * f.px);
    const n = hermite(f.a, L);
    BENDING.forEach((g, r) => {
      add(g, at(n, r) * f.pz);
    });
  }
  for (const m of loads.moments) {
    const dn = hermiteDx(m.a, L);
    BENDING.forEach((g, r) => {
      add(g, -m.my * at(dn, r));
    });
  }
  const fa = p.EA * p.alpha * loads.dT;
  const fb = p.EI * p.alpha * loads.gz;
  const therm = [fa, 0, fb, -fa, 0, -fb];
  return feq.map((v, k) => -v + at(therm, k));
}

/* ------------------------------------------------------------------------------------------------
 * Liberaciones (ADR-005 §1)
 * ---------------------------------------------------------------------------------------------- */

/** Liberaciones por GDL local (true = componente liberada). En 2D se ignoran uy, rx, rz (ADR-001 §2.1). */
export type Released6 = readonly [boolean, boolean, boolean, boolean, boolean, boolean];

interface BlockDef {
  idx: readonly number[];
  /** Escala D por GDL del bloque (1 traslación, L giro). */
  scale: (L: number) => number[];
  /** Base de modos rígidos del bloque en variables escaladas. */
  rigid: readonly (readonly number[])[];
  /** true en las posiciones de traslación del bloque. */
  translation: readonly boolean[];
  name: string;
}

const AXIAL_BLOCK: BlockDef = { idx: AXIAL, scale: () => [1, 1], rigid: [[1, 1]], translation: [true, true], name: "axil" };
/** Flexión x–z: traslación (1, 0, 1, 0) y giro rígido alrededor de i (θ = 1/L ⇒ ũ = (0, 1, −1, 1)). */
const BENDING_BLOCK: BlockDef = {
  idx: BENDING,
  scale: (L) => [1, L, 1, L],
  rigid: [
    [1, 0, 1, 0],
    [0, 1, -1, 1],
  ],
  translation: [true, false, true, false],
  name: "flexión x–z",
};

/**
 * Combinaciones de modos rígidos del bloque con componentes nulas en C (núcleo de k_RR, ADR-005 §1.3), devueltas
 * como vectores completos del bloque (escalados). Criterio combinatorio exacto: las entradas son enteros pequeños.
 */
export function rigidNullCombos(rigid: readonly (readonly number[])[], isC: readonly boolean[]): number[][] {
  const restrict = (v: readonly number[]): number[] => v.filter((_, k) => isC[k] === true);
  const isZero = (v: readonly number[]): boolean => v.every((c) => c === 0);
  const t = rigid[0] as readonly number[];
  const r = rigid[1];
  const tC = restrict(t);
  if (r === undefined) return isZero(tC) ? [[...t]] : [];
  const rC = restrict(r);
  const tz = isZero(tC);
  const rz = isZero(rC);
  if (tz && rz) return [[...t], [...r]];
  if (tz) return [[...t]];
  if (rz) return [[...r]];
  // Ambas no nulas: ¿paralelas? (todos los menores 2×2 nulos)
  for (let p = 0; p < tC.length; p++) {
    for (let q = p + 1; q < tC.length; q++) {
      if (at(tC, p) * at(rC, q) - at(tC, q) * at(rC, p) !== 0) return [];
    }
  }
  const p = tC.findIndex((c) => c !== 0);
  const al = at(rC, p);
  const be = -at(tC, p);
  return [t.map((c, k) => al * c + be * at(r, k))];
}

export interface Condensed {
  /** k* local 6×6 (filas y columnas de R a 0; bloques nulos con ceros exactos, ADR-005 §1.5). */
  k: Mat;
  /** f*_emp local (6), 0 en R. */
  f: number[];
  released: Released6;
  /** Recupera u_R (norma mínima escalada, ADR-005 §1.2) a partir de u local completo; devuelve el vector de 6. */
  recover: (uLocal: readonly number[]) => number[];
  /**
   * Recuperación para la DEFORMADA. Igual que `recover` salvo en los bloques con núcleo (mecanismo interno sin
   * carga, `kernelBlocks` no vacío): ahí u_R es indeterminado (cualquier u_R + N·c es solución) y, en lugar de la
   * norma mínima absoluta (que separa el extremo liberado de su nudo), se elige la componente de núcleo que
   * minimiza el SALTO de traslaciones Σ (u_R − u_nodal)² en las traslaciones liberadas del bloque. Los giros
   * liberados no entran en el criterio: su salto es la rótula, físicamente legítimo. El mínimo es único: en todos
   * los patrones con núcleo admitidos, el núcleo restringido a las traslaciones liberadas es inyectivo (traslación
   * rígida ⇒ uz_i, uz_j ∈ R; giro alrededor de i ⇒ uz_j ∈ R; alrededor de j ⇒ uz_i ∈ R; axil ⇒ ux_i, ux_j ∈ R).
   * Sin núcleo coincide exactamente con `recover`. El valor sigue siendo una CONVENCIÓN (ADR-005 §2.7): la UI
   * debe marcar esos desplazamientos como indeterminados.
   */
  recoverAttached: (uLocal: readonly number[]) => number[];
  /** Bloques con núcleo no trivial (mecanismo interno sin carga), con los nombres de sus liberaciones. */
  kernelBlocks: { name: string; releases: string[] }[];
}

/** Número de liberaciones en el bloque de flexión. */
export const bendingReleaseCount = (rel: Released6): number => BENDING.filter((g) => rel[g]).length;

/**
 * ¿Transmite la barra momento alrededor de y local en el extremo e? (ADR-005 §1.6, criterio exacto):
 * ry_e ∉ R y |R ∩ bloque de flexión| ≤ 1.
 */
export function transmitsMy(rel: Released6, end: "i" | "j"): boolean {
  const ry = end === "i" ? rel[2] : rel[5];
  return !ry && bendingReleaseCount(rel) <= 1;
}

/** ¿Deslizaderas en ambos extremos? (R ∩ flexión = {uz_i, uz_j}: rechazado en v1, ADR-005 §1.4). */
export const hasDoubleSlide = (rel: Released6): boolean => rel[1] && rel[4] && !rel[2] && !rel[5];

/**
 * Comprueba la ortogonalidad de la carga respecto al núcleo de k_RR (ADR-005 §1.3). Devuelve el mensaje de
 * `invalid-model` o null. `f` = f_emp local completo (6).
 */
export function internalMechanismError(memberId: string, L: number, rel: Released6, f: readonly number[]): string | null {
  const ft = f.map((v, k) => (k === 2 || k === 5 ? v / L : v)); // f̃ = D⁻¹·f
  const base = ft.reduce((s, v) => s + Math.abs(v), 0); // Σ w_k·|f_emp,k|
  for (const blk of [AXIAL_BLOCK, BENDING_BLOCK]) {
    const isR = blk.idx.map((g) => rel[g] === true);
    if (!isR.some(Boolean)) continue;
    const combos = rigidNullCombos(
      blk.rigid,
      isR.map((b) => !b),
    );
    for (const n of combos) {
      let proj = 0;
      let sAbs = 0;
      blk.idx.forEach((g, r) => {
        if (!isR[r]) return;
        const term = at(ft, g) * at(n, r);
        proj += term;
        sAbs += Math.abs(term);
      });
      if (!(Math.abs(proj) <= 1e-9 * (sAbs + base))) {
        const names = blk.idx.filter((_, r) => isR[r]).map((g) => RELEASE_NAMES[g] as string);
        return `Barra ${memberId}: las liberaciones ${names.join(", ")} forman un mecanismo interno (${blk.name}) y la barra tiene carga en ese bloque`;
      }
    }
  }
  return null;
}

/**
 * Condensación estática por bloques (ADR-005 §1.2). Requiere que la barra haya superado `hasDoubleSlide` e
 * `internalMechanismError` (condición de rango).
 */
export function condense(k: Mat, f: readonly number[], rel: Released6, L: number): Condensed {
  const kOut = zeros(6, 6);
  const fOut = [0, 0, 0, 0, 0, 0];
  const recovers: ((u: number[], uLocal: readonly number[], attach: boolean) => void)[] = [];
  const kernelBlocks: Condensed["kernelBlocks"] = [];
  for (const blk of [AXIAL_BLOCK, BENDING_BLOCK]) {
    const n = blk.idx.length;
    const s = blk.scale(L);
    const g = (r: number): number => at(blk.idx, r);
    const sc = (r: number): number => at(s, r);
    const isR = blk.idx.map((gi) => rel[gi] === true);
    const R = [...Array(n).keys()].filter((r) => isR[r]);
    const C = [...Array(n).keys()].filter((r) => !isR[r]);
    if (R.length === 0) {
      for (let r = 0; r < n; r++) {
        fOut[g(r)] = at(f, g(r));
        for (let q = 0; q < n; q++) setM(kOut, g(r), g(q), get(k, g(r), g(q)));
      }
      continue;
    }
    const kt = (r: number, q: number): number => get(k, g(r), g(q)) / (sc(r) * sc(q));
    const ftv = (r: number): number => at(f, g(r)) / sc(r);
    const kRR = R.map((r) => R.map((q) => kt(r, q)));
    const nul = rigidNullCombos(
      blk.rigid,
      isR.map((b) => !b),
    ).map((v) => R.map((r) => at(v, r)));
    const P = pinvWithNull(kRR, nul);
    // k_RR⁺·f̃_R y k_RR⁺·k̃_RC
    const pf = R.map((_, a) => R.reduce((acc, r, b) => acc + get(P, a, b) * ftv(r), 0));
    const pk = R.map((_, a) => C.map((c) => R.reduce((acc, r, b) => acc + get(P, a, b) * kt(r, c), 0)));
    // Bloque condensado nulo determinado combinatoriamente (axil con ≥ 1 liberación, flexión con ≥ 2).
    const knownZero = blk === AXIAL_BLOCK ? R.length >= 1 : R.length >= 2;
    C.forEach((c) => {
      const fStar = ftv(c) - R.reduce((acc, r, a) => acc + kt(c, r) * at(pf, a), 0);
      fOut[g(c)] = fStar * sc(c);
      if (knownZero) return;
      C.forEach((d, di) => {
        const kStar = kt(c, d) - R.reduce((acc, r, a) => acc + kt(c, r) * get(pk, a, di), 0);
        setM(kOut, g(c), g(d), kStar * sc(c) * sc(d));
      });
    });
    recovers.push((u, uLocal, attach) => {
      R.forEach((r, a) => {
        const v = -(C.reduce((acc, c, ci) => acc + get(pk, a, ci) * at(uLocal, g(c)) * sc(c), 0) + at(pf, a));
        u[g(r)] = v / sc(r);
      });
      if (!attach || nul.length === 0) return;
      // Salto mínimo de traslaciones: min_c ‖N_T·c − d‖², d = u_nodal − u_R (traslaciones liberadas, escala 1).
      const T = R.map((r, a) => ({ r, a })).filter((e) => blk.translation[e.r] === true);
      const d = T.map((e) => at(uLocal, g(e.r)) - at(u, g(e.r)));
      const G = nul.map((ni) => nul.map((nj) => T.reduce((s, e) => s + at(ni, e.a) * at(nj, e.a), 0)));
      const b = nul.map((ni) => T.reduce((s, e, t) => s + at(ni, e.a) * at(d, t), 0));
      const c = solveSmall(G, b);
      R.forEach((r, a) => {
        const corr = nul.reduce((s, ni, q) => s + at(c, q) * at(ni, a), 0);
        u[g(r)] = at(u, g(r)) + corr / sc(r);
      });
    });
    if (nul.length > 0) kernelBlocks.push({ name: blk.name, releases: R.map((r) => RELEASE_NAMES[g(r)] as string) });
  }
  const run = (uLocal: readonly number[], attach: boolean): number[] => {
    const u = [...uLocal];
    for (const fn of recovers) fn(u, uLocal, attach);
    return u;
  };
  return {
    k: kOut,
    f: fOut,
    released: rel,
    recover: (uLocal) => run(uLocal, false),
    recoverAttached: (uLocal) => run(uLocal, true),
    kernelBlocks,
  };
}

/** Resuelve G·c = b para G simétrica definida positiva de 1×1 o 2×2 (regla de Cramer). */
function solveSmall(G: Mat, b: readonly number[]): number[] {
  if (b.length === 1) return [at(b, 0) / get(G, 0, 0)];
  const det = get(G, 0, 0) * get(G, 1, 1) - get(G, 0, 1) * get(G, 1, 0);
  return [
    (at(b, 0) * get(G, 1, 1) - get(G, 0, 1) * at(b, 1)) / det,
    (get(G, 0, 0) * at(b, 1) - get(G, 1, 0) * at(b, 0)) / det,
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Transformación 2D (plano X–Z): GDL globales por nudo [ux, uz, ry].
 * u_local = x̂·u, w_local = ẑ·u, θ_local = (ŷ·Y)·ry  (ŷ = ±Y en 2D).
 * ---------------------------------------------------------------------------------------------- */

/** Matriz 3×3 por nudo (global → local) en 2D-XZ. */
export function transform2D(ax: LocalAxes): Mat {
  return [
    [ax.x[0], ax.x[2], 0],
    [ax.z[0], ax.z[2], 0],
    [0, 0, ax.y[1]],
  ];
}

/** u_local (6) = T·u_global (6). */
export function toLocal6(t: Mat, ug: readonly number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  for (let e = 0; e < 2; e++) {
    for (let r = 0; r < 3; r++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += get(t, r, c) * at(ug, 3 * e + c);
      out[3 * e + r] = s;
    }
  }
  return out;
}

/** f_global (6) = Tᵀ·f_local (6). */
export function toGlobal6(t: Mat, fl: readonly number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  for (let e = 0; e < 2; e++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let r = 0; r < 3; r++) s += get(t, r, c) * at(fl, 3 * e + r);
      out[3 * e + c] = s;
    }
  }
  return out;
}

/** K_global = Tᵀ·k·T (6×6). */
export function stiffnessToGlobal(t: Mat, k: Mat): Mat {
  const out = zeros(6, 6);
  // T por bloques diagonales: (Tᵀ k T)_ab = Σ T_ra k_rs T_sb
  for (let a = 0; a < 6; a++) {
    for (let b = 0; b < 6; b++) {
      let s = 0;
      const ea = Math.floor(a / 3);
      const eb = Math.floor(b / 3);
      for (let r = 0; r < 3; r++) {
        const tra = get(t, r, a % 3);
        for (let q = 0; q < 3; q++) s += tra * get(k, 3 * ea + r, 3 * eb + q) * get(t, q, b % 3);
      }
      setM(out, a, b, s);
    }
  }
  return out;
}
