/**
 * Esfuerzos de sección y deformada a lo largo de una barra 2D-XZ (escrito desde cero; ADR-001 §6).
 *
 * Equilibrio del tramo [0, x] (cara positiva en x, fuerzas de extremo nudo→barra en i, cargas en el tramo):
 *   N(x)  = −Fx_i − ∫₀ˣ wx ds − Σ px
 *   Vz(x) = −Fz_i − ∫₀ˣ wz ds − Σ pz
 *   My(x) = −My_i − x·Fz_i − ∫₀ˣ (x − s)·wz ds − Σ (x − a)·pz − Σ my
 * (momentos respecto a la sección: el brazo (s − x)·x̂ × wz·ẑ = (x − s)·wz·ŷ). Cumple dN/dx = −wx,
 * dVz/dx = −wz, dMy/dx = Vz y N(0) = −Fx_i, Vz(0) = −Fz_i, My(0) = −My_i (ADR-001 §6.2).
 *
 * Deformada (ejes locales): de las relaciones constitutivas de ADR-001 §5.1,
 *   du/dx = N/EA + α·dT,  d²w/dx² = −dθ/dx = −(My/EI + α·gz),
 * resueltas como interpolación de Hermite de los desplazamientos de extremo + solución particular de las cargas
 * de vano (ver `memberDeflection`).
 */
import type { SectionForces } from "./index";
import type { BeamProps, MemberLoads2D } from "./element2d";
import { GAUSS3, gauss3, hermite, linearAt } from "./element2d";
import { at } from "./linalg";

/** Número de tramos iguales de la malla base de estaciones. */
export const BASE_SEGMENTS = 10;

const posTol = (L: number): number => 1e-9 * L;

interface Raw {
  N: number;
  Vz: number;
  My: number;
}

/** Esfuerzos crudos en x. `includeAt`: incluye las cargas puntuales situadas exactamente en x (límite x⁺). */
export function sectionAt(L: number, endI: readonly number[], loads: MemberLoads2D, x: number, includeAt: boolean): Raw {
  const tol = posTol(L);
  const Fx = at(endI, 0);
  const Fz = at(endI, 1);
  const Mi = at(endI, 2);
  let N = -Fx;
  let Vz = -Fz;
  let My = -Mi - x * Fz;
  for (const d of loads.dist) {
    const c = Math.min(x, d.b);
    if (c <= d.a) continue;
    N -= gauss3(d.a, c, (s) => linearAt(d.a, d.b, d.wx1, d.wx2, s));
    Vz -= gauss3(d.a, c, (s) => linearAt(d.a, d.b, d.wz1, d.wz2, s));
    My -= gauss3(d.a, c, (s) => (x - s) * linearAt(d.a, d.b, d.wz1, d.wz2, s));
  }
  const included = (a: number): boolean => a < x - tol || (Math.abs(a - x) <= tol && includeAt);
  for (const f of loads.forces) {
    if (!included(f.a)) continue;
    N -= f.px;
    Vz -= f.pz;
    My -= (x - f.a) * f.pz;
  }
  for (const m of loads.moments) if (included(m.a)) My -= m.my;
  return { N, Vz, My };
}

/** Abscisas con discontinuidad: cargas y momentos puntuales (también en los extremos) y extremos interiores de cargas parciales. */
export function discontinuities(L: number, loads: MemberLoads2D): number[] {
  const tol = posTol(L);
  const out: number[] = [];
  for (const f of loads.forces) out.push(f.a);
  for (const m of loads.moments) out.push(m.a);
  for (const d of loads.dist) {
    if (d.a > tol) out.push(d.a);
    if (d.b < L - tol) out.push(d.b);
  }
  return out;
}

/** Abscisas de las estaciones (sin duplicar) y cuáles son discontinuidades. */
export function stationGrid(L: number, loads: MemberLoads2D): { x: number; jump: boolean }[] {
  const tol = posTol(L);
  const pts: { x: number; jump: boolean }[] = [];
  for (const x of discontinuities(L, loads)) pts.push({ x, jump: true });
  for (let k = 0; k <= BASE_SEGMENTS; k++) pts.push({ x: (L * k) / BASE_SEGMENTS, jump: false });
  pts.sort((p, q) => p.x - q.x || Number(q.jump) - Number(p.jump));
  const out: { x: number; jump: boolean }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(p.x - last.x) <= tol) {
      last.jump ||= p.jump;
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

/** Estaciones con esfuerzos (ADR-001 §6.1): duplicadas left/right en las discontinuidades. */
export function memberStations(L: number, endI: readonly number[], loads: MemberLoads2D): SectionForces[] {
  const out: SectionForces[] = [];
  const mk = (x: number, r: Raw, side?: "left" | "right"): SectionForces => ({
    x,
    ...(side ? { side } : {}),
    N: r.N,
    Vy: 0,
    Vz: r.Vz,
    T: 0,
    My: r.My,
    Mz: 0,
  });
  for (const p of stationGrid(L, loads)) {
    if (p.jump) {
      out.push(mk(p.x, sectionAt(L, endI, loads, p.x, false), "left"));
      out.push(mk(p.x, sectionAt(L, endI, loads, p.x, true), "right"));
    } else {
      out.push(mk(p.x, sectionAt(L, endI, loads, p.x, false)));
    }
  }
  return out;
}

export interface DeflectionPoint {
  x: number;
  /** Desplazamientos locales: axil u y transversal w (m). */
  u: number;
  w: number;
}

/** Número de tramos iguales de la malla de la deformada (21 estaciones base por barra). */
export const DEFLECTION_SEGMENTS = 20;

/**
 * Abscisas de la deformada, estrictamente crecientes, con x = 0 y x = L exactos: todas las de `stationGrid`
 * (misma malla que los esfuerzos, recomendación de ADR-006 §3, incluidas las cargas puntuales y los extremos de
 * cargas parciales) más L·k/DEFLECTION_SEGMENTS, descartando las que distan ≤ 1e-9·L de una ya presente.
 */
export function deflectionGrid(L: number, loads: MemberLoads2D): number[] {
  const tol = posTol(L);
  const xs = stationGrid(L, loads).map((p) => p.x);
  for (let k = 0; k <= DEFLECTION_SEGMENTS; k++) {
    const x = (L * k) / DEFLECTION_SEGMENTS;
    if (!xs.some((y) => Math.abs(y - x) <= tol)) xs.push(x);
  }
  xs.sort((a, b) => a - b);
  xs[0] = 0;
  xs[xs.length - 1] = L;
  return xs;
}

/**
 * Deformada local exacta (Euler-Bernoulli) en las abscisas de `deflectionGrid`. `uLocal` = 6 desplazamientos
 * locales de extremo de la barra [u_i, w_i, θ_i, u_j, w_j, θ_j] (con los u_R recuperados de las liberaciones).
 *
 * Solución = parte homogénea + parte particular de las cargas de vano:
 *   M0(x), N0(x): esfuerzos del tramo [0, x] debidos SOLO a las cargas de vano (fuerzas de extremo nulas);
 *   w0(x) = −∫₀ˣ (x − s)·M0/EI ds,  θ0(x) = −w0'(x) = ∫₀ˣ M0/EI ds,  u0(x) = ∫₀ˣ N0/EA ds
 * (solución particular con w0(0) = θ0(0) = u0(0) = 0). El resto (esfuerzos de extremo) da un My lineal y un N
 * constante, cuya deformada es cúbica en w y lineal en u, luego queda fijada por los valores de extremo:
 *   w(x) = N1·w_i + N2·θ_i + N3·(w_j − w0(L)) + N4·(θ_j − θ0(L)) + w0(x)   (Hermite, `hermite`)
 *   u(x) = (1 − ξ)·u_i + ξ·(u_j − u0(L)) + u0(x).
 * Por construcción coincide con los desplazamientos de extremo en x = 0 y x = L sin depender del equilibrio.
 * Térmica: α·dT (deformación axil constante) y α·gz (curvatura constante) aportan a u un término lineal y a w uno
 * cuadrático, ambos contenidos en la interpolación de extremos ⇒ se cancelan exactamente y no se suman aparte.
 * Integrales partidas en las discontinuidades y evaluadas con Gauss de 3 puntos: M0 es de grado ≤ 3 por tramo
 * (trapezoidal), (x − s)·M0 de grado ≤ 4 ⇒ exacto.
 */
export function memberDeflection(p: BeamProps, loads: MemberLoads2D, uLocal: readonly number[]): DeflectionPoint[] {
  const { L, EA, EI } = p;
  const zero = [0, 0, 0];
  const breaks = [...new Set([...discontinuities(L, loads), ...loads.dist.flatMap((d) => [d.a, d.b])])]
    .filter((b) => b > 0 && b < L)
    .sort((a, b) => a - b);
  const grid = deflectionGrid(L, loads);
  const parts = particularAlong(grid, breaks, (s) => sectionAt(L, zero, loads, s, false));
  const end = parts[parts.length - 1] as Particular;
  const q = [at(uLocal, 1), at(uLocal, 2), at(uLocal, 4) - end.w0 / EI, at(uLocal, 5) - end.t0 / EI];
  const ui = at(uLocal, 0);
  const uj = at(uLocal, 3) - end.u0 / EA;
  return grid.map((x, k) => {
    const pt = parts[k] as Particular;
    const n = hermite(x, L);
    const xi = x / L;
    const w = n.reduce((acc, nk, r) => acc + nk * at(q, r), 0) + pt.w0 / EI;
    return { x, u: (1 - xi) * ui + xi * uj + pt.u0 / EA, w };
  });
}

/** Integrales particulares sin dividir por la rigidez: u0·EA = ∫N0, w0·EI = −∫(x − s)·M0, θ0·EI = ∫M0. */
interface Particular {
  u0: number;
  w0: number;
  t0: number;
}

/**
 * Integrales particulares en cada abscisa de `grid` (creciente, grid[0] = 0) en una sola pasada acumulada por
 * tramos (O(n) evaluaciones de `span`, una por punto de Gauss). Los tramos se cortan en `grid` ∪ `breaks`, así que
 * cada uno queda dentro de un intervalo de continuidad y Gauss de 3 puntos es exacto. Recurrencia sin cancelación
 * para W(x) = ∫₀ˣ (x − s)·M0 ds entre x_k y x_{k+1} = x_k + h:
 *   W(x_{k+1}) = W(x_k) + h·∫₀^{x_k} M0 ds + ∫_{x_k}^{x_{k+1}} (x_{k+1} − s)·M0 ds.
 */
function particularAlong(grid: readonly number[], breaks: readonly number[], span: (s: number) => Raw): Particular[] {
  const cuts = [...grid.map((x, k) => ({ x, k })), ...breaks.map((x) => ({ x, k: -1 }))].sort((p, r) => p.x - r.x);
  const out: Particular[] = new Array<Particular>(grid.length);
  let prev = 0;
  let iN = 0; // ∫ N0
  let iM = 0; // ∫ M0
  let W = 0; // ∫ (x − s)·M0
  for (const c of cuts) {
    const b = c.x;
    if (b > prev) {
      const h = (b - prev) / 2;
      const mid = (b + prev) / 2;
      let sN = 0;
      let sM = 0;
      let sW = 0;
      for (const [t, wt] of GAUSS3) {
        const s = mid + h * t;
        const r = span(s);
        sN += wt * r.N;
        sM += wt * r.My;
        sW += wt * (b - s) * r.My;
      }
      W += (b - prev) * iM + sW * h;
      iN += sN * h;
      iM += sM * h;
      prev = b;
    }
    if (c.k >= 0) out[c.k] = { u0: iN, w0: -W, t0: iM };
  }
  return out;
}
