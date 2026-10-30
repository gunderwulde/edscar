/**
 * Barra 2D-XZ: rigidez, empotramiento perfecto, liberaciones y transformación.
 * Esperados de fórmulas clásicas de empotramiento perfecto (con los signos de ADR-001 §6.2) y derivaciones a mano
 * de la condensación; nunca tomados de la salida del código.
 */
import { describe, expect, it } from "vitest";
import {
  bendingReleaseCount,
  condense,
  emptyLoads,
  fixedEndForces,
  gauss3,
  hasDoubleSlide,
  hermite,
  hermiteDx,
  internalMechanismError,
  linearAt,
  localStiffness,
  rigidNullCombos,
  stiffnessToGlobal,
  toGlobal6,
  toLocal6,
  transform2D,
  transmitsMy,
} from "./element2d";
import type { BeamProps, MemberLoads2D, Released6 } from "./element2d";
import { localAxes } from "./geometry";
import { get } from "./linalg";

const L = 6;
const w = 10;
const P: BeamProps = { L, EA: 2.1e6, EI: 8.4e3, alpha: 1.2e-5 };
const NONE: Released6 = [false, false, false, false, false, false];

const rel = (...names: number[]): Released6 => {
  const r = [false, false, false, false, false, false];
  for (const n of names) r[n] = true;
  return r as unknown as Released6;
};

const loads = (patch: Partial<MemberLoads2D>): MemberLoads2D => ({ ...emptyLoads(), ...patch });
const uniform = (wz: number, a = 0, b = L): MemberLoads2D => loads({ dist: [{ a, b, wx1: 0, wx2: 0, wz1: wz, wz2: wz }] });

const expectVec = (got: readonly number[], exp: readonly number[], tol = 1e-9): void => {
  expect(got.length).toBe(exp.length);
  exp.forEach((v, k) => {
    const g = got[k] ?? NaN;
    expect(Math.abs(g - v)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(v)));
  });
};

describe("rigidez local y funciones de forma", () => {
  it("entradas de k con L = 2, EA = 10, EI = 8", () => {
    const k = localStiffness({ L: 2, EA: 10, EI: 8, alpha: 0 });
    // EA/L = 5; EI/L³ = 1 ⇒ 12, −6L = −12, 4L² = 16, 2L² = 8.
    expect(get(k, 0, 0)).toBe(5);
    expect(get(k, 0, 3)).toBe(-5);
    expect(get(k, 1, 1)).toBe(12);
    expect(get(k, 1, 2)).toBe(-12);
    expect(get(k, 1, 4)).toBe(-12);
    expect(get(k, 2, 2)).toBe(16);
    expect(get(k, 2, 5)).toBe(8);
    expect(get(k, 4, 5)).toBe(12);
    expect(get(k, 0, 1)).toBe(0);
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) expect(get(k, a, b)).toBe(get(k, b, a));
  });

  it("Hermite: valores en L/2 y derivadas en los extremos (θ = −w')", () => {
    const n = hermite(L / 2, L);
    expectVec(n, [0.5, -L / 8, 0.5, L / 8]);
    expectVec(hermiteDx(0, L), [0, -1, 0, 0]);
    expectVec(hermiteDx(L, L), [0, 0, 0, -1]);
  });

  it("Gauss de 3 puntos exacto para x⁵ y valor lineal", () => {
    expect(gauss3(0, 1, (s) => s ** 5)).toBeCloseTo(1 / 6, 15);
    expect(linearAt(1, 3, 2, 6, 2)).toBe(4);
  });
});

describe("fuerzas de empotramiento perfecto (nudo→barra, ejes locales)", () => {
  it("uniforme wz = −w: [0, wL/2, −wL²/12, 0, wL/2, +wL²/12] (ADR-001 §6.2)", () => {
    expectVec(fixedEndForces(P, uniform(-w)), [0, w * L / 2, -w * L * L / 12, 0, w * L / 2, w * L * L / 12]);
  });

  it("dos parciales [0, 2] y [2, 6] equivalen a la uniforme completa", () => {
    const two = loads({
      dist: [
        { a: 0, b: 2, wx1: 0, wx2: 0, wz1: -w, wz2: -w },
        { a: 2, b: L, wx1: 0, wx2: 0, wz1: -w, wz2: -w },
      ],
    });
    expectVec(fixedEndForces(P, two), [0, w * L / 2, -w * L * L / 12, 0, w * L / 2, w * L * L / 12]);
  });

  it("parcial en la mitad izquierda: momentos 11wL²/192 y 5wL²/192, reacciones 13wL/32 y 3wL/32", () => {
    expectVec(fixedEndForces(P, uniform(-w, 0, L / 2)), [
      0,
      (13 * w * L) / 32,
      (-11 * w * L * L) / 192,
      0,
      (3 * w * L) / 32,
      (5 * w * L * L) / 192,
    ]);
  });

  it("triangular 0 → w: momentos wL²/30 y wL²/20, reacciones 3wL/20 y 7wL/20", () => {
    const tri = loads({ dist: [{ a: 0, b: L, wx1: 0, wx2: 0, wz1: 0, wz2: -w }] });
    expectVec(fixedEndForces(P, tri), [0, (3 * w * L) / 20, (-w * L * L) / 30, 0, (7 * w * L) / 20, (w * L * L) / 20]);
  });

  it("axil uniforme wx: f = [−wxL/2, 0, 0, −wxL/2, 0, 0]", () => {
    const ax = loads({ dist: [{ a: 0, b: L, wx1: 4, wx2: 4, wz1: 0, wz2: 0 }] });
    expectVec(fixedEndForces(P, ax), [-12, 0, 0, -12, 0, 0]);
  });

  it("puntual P = 12 en a = 2 (b = 4): Pb²(3a+b)/L³, Pa²(a+3b)/L³, Pab²/L², Pa²b/L²", () => {
    const pt = loads({ forces: [{ a: 2, px: 3, pz: -12 }] });
    const Pz = 12;
    const a = 2;
    const b = 4;
    expectVec(fixedEndForces(P, pt), [
      -3 * (b / L),
      (Pz * b * b * (3 * a + b)) / L ** 3,
      (-Pz * a * b * b) / L ** 2,
      -3 * (a / L),
      (Pz * a * a * (a + 3 * b)) / L ** 3,
      (Pz * a * a * b) / L ** 2,
    ]);
  });

  it("momento puntual my en L/2: reacciones ∓1.5·my/L, momentos my/4 en ambos extremos", () => {
    const my = 8;
    const f = fixedEndForces(P, loads({ moments: [{ a: L / 2, my }] }));
    expectVec(f, [0, (-1.5 * my) / L, my / 4, 0, (1.5 * my) / L, my / 4]);
    // Equilibrio de momentos respecto a i: My_i + My_j − L·Fz_j + my = 0 (x̂ × ẑ = −ŷ).
    expect((f[2] ?? 0) + (f[5] ?? 0) - L * (f[4] ?? 0) + my).toBeCloseTo(0, 12);
  });

  it("térmica: [EAαdT, 0, EIαgz, −EAαdT, 0, −EIαgz]", () => {
    const f = fixedEndForces(P, loads({ dT: 20, gz: 50 }));
    const fa = 2.1e6 * 1.2e-5 * 20;
    const fb = 8.4e3 * 1.2e-5 * 50;
    expectVec(f, [fa, 0, fb, -fa, 0, -fb]);
  });
});

describe("liberaciones (ADR-005 §1)", () => {
  it("criterios combinatorios de transmisión de momento y deslizadera doble", () => {
    expect(bendingReleaseCount(rel(2, 5, 0))).toBe(2);
    expect(transmitsMy(NONE, "i")).toBe(true);
    expect(transmitsMy(rel(5), "i")).toBe(true);
    expect(transmitsMy(rel(5), "j")).toBe(false);
    expect(transmitsMy(rel(1, 4), "i")).toBe(false);
    expect(transmitsMy(rel(4), "j")).toBe(true);
    expect(hasDoubleSlide(rel(1, 4))).toBe(true);
    expect(hasDoubleSlide(rel(1, 4, 5))).toBe(false);
    expect(hasDoubleSlide(rel(1))).toBe(false);
  });

  it("núcleo rígido restringido a C: todas las ramas", () => {
    const axial = [[1, 1]];
    const bend = [
      [1, 0, 1, 0],
      [0, 1, -1, 1],
    ];
    expect(rigidNullCombos(axial, [false, false])).toEqual([[1, 1]]);
    expect(rigidNullCombos(axial, [true, false])).toEqual([]);
    expect(rigidNullCombos(bend, [false, false, false, false])).toEqual(bend);
    // C = {θ_i}: t|C = 0, r|C = 1 ⇒ solo traslación.
    expect(rigidNullCombos(bend, [false, true, false, false])).toEqual([[1, 0, 1, 0]]);
    // C = {w_i}: t|C = 1, r|C = 0 ⇒ solo giro alrededor de i.
    expect(rigidNullCombos(bend, [true, false, false, false])).toEqual([[0, 1, -1, 1]]);
    // C = {w_i, w_j}: no paralelos ⇒ núcleo vacío.
    expect(rigidNullCombos(bend, [true, false, true, false])).toEqual([]);
    // C = {w_j}: paralelos ⇒ giro alrededor de j, −t − r = (−1, −1, 0, −1).
    const n = rigidNullCombos(bend, [false, false, true, false]);
    expect(n.length).toBe(1);
    expect((n[0] ?? []).map((v) => v + 0)).toEqual([-1, -1, 0, -1]);
  });

  it("viga empotrada-articulada (ry_j liberado), uniforme: 5wL/8, −wL²/8, 3wL/8, 0", () => {
    const k = localStiffness(P);
    const c = condense(k, fixedEndForces(P, uniform(-w)), rel(5), L);
    expectVec(c.f, [0, (5 * w * L) / 8, (-w * L * L) / 8, 0, (3 * w * L) / 8, 0]);
    expect(c.f[5]).toBe(0);
    // k* = 3EI/L³·[[1, −L, −1], [−L, L², L], [−1, L, 1]] en (w_i, θ_i, w_j) con θ = −w'.
    const e = (3 * P.EI) / L ** 3;
    expect(get(c.k, 1, 1)).toBeCloseTo(e, 9);
    expect(get(c.k, 1, 2)).toBeCloseTo(-e * L, 9);
    expect(get(c.k, 2, 2)).toBeCloseTo(e * L * L, 9);
    expect(get(c.k, 2, 4)).toBeCloseTo(e * L, 9);
    expect(get(c.k, 4, 4)).toBeCloseTo(e, 9);
    expect(get(c.k, 5, 5)).toBe(0);
    expect(get(c.k, 0, 0)).toBe(P.EA / L);
    // Giro en el extremo articulado con nudos fijos: θ_j = −wL³/(48EI).
    const u = c.recover([0, 0, 0, 0, 0, 0]);
    expect(u[5]).toBeCloseTo((-w * L ** 3) / (48 * P.EI), 12);
  });

  it("ry_i liberado (simétrico): 3wL/8, 0, 5wL/8, +wL²/8", () => {
    const c = condense(localStiffness(P), fixedEndForces(P, uniform(-w)), rel(2), L);
    expectVec(c.f, [0, (3 * w * L) / 8, 0, 0, (5 * w * L) / 8, (w * L * L) / 8]);
  });

  it("biarticulada: flexión condensada con ceros exactos y giros ±wL³/(24EI)", () => {
    const c = condense(localStiffness(P), fixedEndForces(P, uniform(-w)), rel(2, 5), L);
    expectVec(c.f, [0, (w * L) / 2, 0, 0, (w * L) / 2, 0]);
    for (const a of [1, 2, 4, 5]) for (const b of [1, 2, 4, 5]) expect(get(c.k, a, b)).toBe(0);
    expect(get(c.k, 3, 3)).toBe(P.EA / L);
    const u = c.recover([0, 0, 0, 0, 0, 0]);
    expect(u[2]).toBeCloseTo((w * L ** 3) / (24 * P.EI), 12);
    expect(u[5]).toBeCloseTo((-w * L ** 3) / (24 * P.EI), 12);
  });

  it("extremo j libre (uz_j, ry_j): ménsula, Fz_i = wL, My_i = −wL²/2, flecha −wL⁴/(8EI)", () => {
    const c = condense(localStiffness(P), fixedEndForces(P, uniform(-w)), rel(4, 5), L);
    expectVec(c.f, [0, w * L, (-w * L * L) / 2, 0, 0, 0]);
    expect(get(c.k, 1, 1)).toBe(0);
    expect(get(c.k, 2, 2)).toBe(0);
    const u = c.recover([0, 0, 0, 0, 0, 0]);
    expect(u[4]).toBeCloseTo((-w * L ** 4) / (8 * P.EI), 10);
    expect(u[5]).toBeCloseTo((w * L ** 3) / (6 * P.EI), 12);
    // Con giro rígido impuesto en i (θ_i = 1e-3): el extremo sigue el sólido rígido, w_j = −θ_i·L.
    const u2 = condense(localStiffness(P), [0, 0, 0, 0, 0, 0], rel(4, 5), L).recover([0, 0, 1e-3, 0, 0, 0]);
    expect(u2[4]).toBeCloseTo(-1e-3 * L, 14);
    expect(u2[5]).toBeCloseTo(1e-3, 14);
  });

  it("cortante liberado en j (uz_j): k* = EI/L·[[1, −1], [−1, 1]] en (θ_i, θ_j), resto nulo", () => {
    const c = condense(localStiffness(P), [0, 0, 0, 0, 0, 0], rel(4), L);
    const e = P.EI / L;
    expect(get(c.k, 2, 2)).toBeCloseTo(e, 9);
    expect(get(c.k, 2, 5)).toBeCloseTo(-e, 9);
    expect(get(c.k, 5, 5)).toBeCloseTo(e, 9);
    expect(Math.abs(get(c.k, 1, 1))).toBeLessThan(1e-9 * e);
    expect(Math.abs(get(c.k, 1, 2))).toBeLessThan(1e-9 * e);
  });

  it("axil liberado en j con carga axil: toda la carga va a i (−wx·L)", () => {
    const ax = loads({ dist: [{ a: 0, b: L, wx1: 4, wx2: 4, wz1: 0, wz2: 0 }] });
    const f = fixedEndForces(P, ax);
    expect(internalMechanismError("B1", L, rel(3), f)).toBeNull();
    const c = condense(localStiffness(P), f, rel(3), L);
    expectVec(c.f, [-24, 0, 0, 0, 0, 0]);
    expect(get(c.k, 0, 0)).toBe(0);
    expect(get(c.k, 0, 3)).toBe(0);
  });

  it("axil liberado en ambos extremos: carga axil ⇒ mecanismo; térmica pura ⇒ válida", () => {
    const ax = loads({ dist: [{ a: 0, b: L, wx1: 4, wx2: 4, wz1: 0, wz2: 0 }] });
    expect(internalMechanismError("B1", L, rel(0, 3), fixedEndForces(P, ax))).toBe(
      "Barra B1: las liberaciones ux_i, ux_j forman un mecanismo interno (axil) y la barra tiene carga en ese bloque",
    );
    const th = fixedEndForces(P, loads({ dT: 30 }));
    expect(internalMechanismError("B1", L, rel(0, 3), th)).toBeNull();
    const c = condense(localStiffness(P), th, rel(0, 3), L);
    expect(c.f[0]).toBe(0);
    expect(c.f[3]).toBe(0);
  });

  it("ry_i, uz_j, ry_j: carga transversal ⇒ mecanismo; sin carga ⇒ válida y u_R de norma mínima", () => {
    expect(internalMechanismError("V", L, rel(2, 4, 5), fixedEndForces(P, uniform(-w)))).toBe(
      "Barra V: las liberaciones ry_i, uz_j, ry_j forman un mecanismo interno (flexión x–z) y la barra tiene carga en ese bloque",
    );
    // Carga solo axil: ortogonal al núcleo de flexión.
    const ax = fixedEndForces(P, loads({ dist: [{ a: 0, b: L, wx1: 1, wx2: 1, wz1: 0, wz2: 0 }] }));
    expect(internalMechanismError("V", L, rel(2, 4, 5), ax)).toBeNull();
    const c = condense(localStiffness(P), [0, 0, 0, 0, 0, 0], rel(2, 4, 5), L);
    for (const a of [1, 2, 4, 5]) for (const b of [1, 2, 4, 5]) expect(get(c.k, a, b)).toBe(0);
    // Con w_i = 0.01: las soluciones son la traslación rígida ũ_R = (0, 0.01, 0) más c·(1, −1, 1) (núcleo en
    // variables escaladas (θ_i·L, w_j, θ_j·L)). Norma mínima: d/dc [c² + (0.01 − c)² + c²] = 0 ⇒ c = 0.01/3.
    const u = c.recover([0, 0.01, 0, 0, 0, 0]);
    expect(u[4]).toBeCloseTo((2 * 0.01) / 3, 14);
    expect(u[2]).toBeCloseTo(0.01 / 3 / L, 14);
    expect(u[5]).toBeCloseTo(0.01 / 3 / L, 14);
    expect(c.kernelBlocks).toEqual([{ name: "flexión x–z", releases: ["ry_i", "uz_j", "ry_j"] }]);
    // recoverAttached: misma familia ũ_R = (c, 0.01 − c, c), pero c minimiza el salto en la traslación liberada
    // w_j respecto al nudo (w_j,nodal = 0.004): 0.01 − c = 0.004 ⇒ c = 0.006 ⇒ θ_i = θ_j = 0.006/L.
    const ua = c.recoverAttached([0, 0.01, 0, 0, 0.004, 0]);
    expect(ua[4]).toBeCloseTo(0.004, 14);
    expect(ua[2]).toBeCloseTo(0.006 / L, 14);
    expect(ua[5]).toBeCloseTo(0.006 / L, 14);
  });

  it("recoverAttached: barra con las cuatro liberaciones de flexión y biela axil ux_i, ux_j", () => {
    // Flexión con R = {uz_i, ry_i, uz_j, ry_j} sin carga: u_R = combinación de los dos modos rígidos; el salto
    // mínimo de traslaciones (2 ecuaciones, 2 incógnitas) es nulo ⇒ w_i = 0.01, w_j = −0.02 (los del nudo) y el giro
    // rígido θ = −(w_j − w_i)/L = 0.03/L en ambos extremos, sean cuales sean los giros nodales.
    const c = condense(localStiffness(P), [0, 0, 0, 0, 0, 0], rel(1, 2, 4, 5), L);
    // Norma mínima absoluta (ADR-005 §1.2): u_R = 0, el extremo se separa del nudo (motivo de recoverAttached).
    expect(c.recover([0, 0.01, 0.5, 0, -0.02, -0.7]).every((v) => v === 0)).toBe(true);
    const ua = c.recoverAttached([0, 0.01, 0.5, 0, -0.02, -0.7]);
    expect(ua[1]).toBeCloseTo(0.01, 14);
    expect(ua[4]).toBeCloseTo(-0.02, 14);
    expect(ua[2]).toBeCloseTo(0.03 / L, 14);
    expect(ua[5]).toBeCloseTo(0.03 / L, 14);
    // Axil con ux_i, ux_j liberados y sin carga: traslación rígida c·(1, 1); min (c − 0.001)² + (c − 0.003)² ⇒ c = 0.002.
    const a = condense(localStiffness(P), [0, 0, 0, 0, 0, 0], rel(0, 3), L);
    expect(a.kernelBlocks).toEqual([{ name: "axil", releases: ["ux_i", "ux_j"] }]);
    const ub = a.recoverAttached([0.001, 0, 0, 0.003, 0, 0]);
    expect(ub[0]).toBeCloseTo(0.002, 15);
    expect(ub[3]).toBeCloseTo(0.002, 15);
    // Sin núcleo (biarticulada {ry_i, ry_j}): recoverAttached ≡ recover exactamente.
    const f = fixedEndForces(P, uniform(-w));
    const b = condense(localStiffness(P), f, rel(2, 5), L);
    expect(b.kernelBlocks).toEqual([]);
    const uLoc = [0.001, 0.002, 0.003, -0.001, 0.004, 0.005];
    expect(b.recoverAttached(uLoc)).toEqual(b.recover(uLoc));
  });

  it("momento puntual en barra biarticulada: válido (no está en el núcleo)", () => {
    const f = fixedEndForces(P, loads({ moments: [{ a: 2, my: 5 }] }));
    expect(internalMechanismError("M", L, rel(2, 5), f)).toBeNull();
    const c = condense(localStiffness(P), f, rel(2, 5), L);
    // Biapoyada con par my: reacciones ±my/L.
    expectVec(c.f, [0, -5 / L, 0, 0, 5 / L, 0]);
  });
});

describe("patrones de mecanismo interno de ADR-005 §1.3: carga ortogonal admitida, no ortogonal rechazada", () => {
  // Índices locales: uz_i = 1, ry_i = 2, uz_j = 4, ry_j = 5.
  // Cargas ortogonales (derivadas a mano; la barra se comporta como sólido rígido en el bloque y toda la carga
  // va al extremo retenido, f*_emp = −resultante en fuerzas o −par en momentos):
  //  - Par de fuerzas transversales sin momento respecto a i: −40 en L/4 y +20 en L/2 (−40·L/4 + 20·L/2 = 0),
  //    resultante −20 ⇒ f*_emp,uz_i = +20. Comprobación de la proyección: f̃_R·n = Σ pz·(a/L) = 0.
  //  - Ídem sin momento respecto a j: −40 en 3L/4 y +20 en L/2 (−40·L/4 + 20·L/2 = 0) ⇒ f*_emp,uz_j = +20.
  //  - Momento puntual my (resultante transversal nula): ΣM = 0 ⇒ f*_emp,ry = −my en el extremo retenido.
  const aboutI = (Lb: number): MemberLoads2D =>
    loads({
      forces: [
        { a: Lb / 4, px: 0, pz: -40 },
        { a: Lb / 2, px: 0, pz: 20 },
      ],
    });
  const aboutJ = (Lb: number): MemberLoads2D =>
    loads({
      forces: [
        { a: (3 * Lb) / 4, px: 0, pz: -40 },
        { a: Lb / 2, px: 0, pz: 20 },
      ],
    });
  const my = 7;
  const moment = (Lb: number): MemberLoads2D => loads({ moments: [{ a: Lb / 2, my }] });

  interface Case {
    name: string;
    r: Released6;
    ortho: (Lb: number) => MemberLoads2D;
    /** f*_emp esperado (6). */
    fStar: number[];
  }
  const cases: Case[] = [
    { name: "uz_i, ry_i, ry_j", r: rel(1, 2, 5), ortho: aboutJ, fStar: [0, 0, 0, 0, 20, 0] },
    { name: "uz_i, ry_i, uz_j", r: rel(1, 2, 4), ortho: moment, fStar: [0, 0, 0, 0, 0, -my] },
    { name: "uz_i, uz_j, ry_j", r: rel(1, 4, 5), ortho: moment, fStar: [0, 0, -my, 0, 0, 0] },
    { name: "ry_i, uz_j, ry_j", r: rel(2, 4, 5), ortho: aboutI, fStar: [0, 20, 0, 0, 0, 0] },
  ];

  for (const c of cases) {
    it(`{${c.name}}: ortogonal ⇒ admitida, k* nulo exacto y f* en forma cerrada; uniforme ⇒ invalid-model`, () => {
      const f = fixedEndForces(P, c.ortho(L));
      expect(internalMechanismError("B", L, c.r, f)).toBeNull();
      const k = condense(localStiffness(P), f, c.r, L);
      expectVec(k.f, c.fStar, 1e-12);
      for (const a of [1, 2, 4, 5]) for (const b of [1, 2, 4, 5]) expect(get(k.k, a, b)).toBe(0);
      expect(internalMechanismError("B", L, c.r, fixedEndForces(P, uniform(-w)))).toBe(
        `Barra B: las liberaciones ${c.name} forman un mecanismo interno (flexión x–z) y la barra tiene carga en ese bloque`,
      );
    });

    it(`{${c.name}}: f* independiente de la escala EI/L³ ∈ {1e-3, 1, 1e12} (pseudoinversa escalada)`, () => {
      // Hallazgo del Revisor: con penalización 1 fija el error crecía como ε·EI/L³ (≈ 5e-4 en f* = 20 con 1e12).
      const Lb = 5;
      for (const s of [1e-3, 1, 1e12]) {
        const pr: BeamProps = { L: Lb, EA: s * Lb ** 2, EI: s * Lb ** 3, alpha: 0 };
        const f = fixedEndForces(pr, c.ortho(Lb));
        expect(internalMechanismError("B", Lb, c.r, f)).toBeNull();
        const k = condense(localStiffness(pr), f, c.r, Lb);
        expectVec(k.f, c.fStar, 1e-12);
      }
    });
  }

  it("ejemplo del Revisor (§1.3), R = {uz_i, ry_i, ry_j}: P en x = L ⇒ f*_emp,uz_j = −P_z; P en L/2 ⇒ rechazada", () => {
    const Pz = -10;
    const atL = fixedEndForces(P, loads({ forces: [{ a: L, px: 0, pz: Pz }] }));
    expect(internalMechanismError("V", L, rel(1, 2, 5), atL)).toBeNull();
    const c = condense(localStiffness(P), atL, rel(1, 2, 5), L);
    expectVec(c.f, [0, 0, 0, 0, -Pz, 0], 1e-12);
    // En L/2: f_emp,R·n = Fz_i + (My_i + My_j)/L = P/2 ≠ 0.
    const half = fixedEndForces(P, loads({ forces: [{ a: L / 2, px: 0, pz: Pz }] }));
    expect(internalMechanismError("V", L, rel(1, 2, 5), half)).toBe(
      "Barra V: las liberaciones uz_i, ry_i, ry_j forman un mecanismo interno (flexión x–z) y la barra tiene carga en ese bloque",
    );
  });

  it("las cuatro liberaciones de flexión: gradiente térmico (ortogonal) admitido, carga transversal rechazada", () => {
    const r4 = rel(1, 2, 4, 5);
    // Térmica gz: f̃ = (0, EIαgz/L, 0, −EIαgz/L) ⇒ proyección nula sobre la traslación (1, 0, 1, 0) y sobre el
    // giro (0, 1, −1, 1). Axil dT: fuera del bloque.
    const th = fixedEndForces(P, loads({ dT: 10, gz: 30 }));
    expect(internalMechanismError("Q", L, r4, th)).toBeNull();
    const c = condense(localStiffness(P), th, r4, L);
    const fa = P.EA * P.alpha * 10;
    expectVec(c.f, [fa, 0, 0, -fa, 0, 0], 1e-12);
    expect(c.f[2]).toBe(0);
    expect(internalMechanismError("Q", L, r4, fixedEndForces(P, uniform(-w)))).toBe(
      "Barra Q: las liberaciones uz_i, ry_i, uz_j, ry_j forman un mecanismo interno (flexión x–z) y la barra tiene carga en ese bloque",
    );
    // Momento puntual aislado: no equilibrable con los cuatro liberados (proyección sobre el giro ≠ 0).
    expect(internalMechanismError("Q", L, r4, fixedEndForces(P, moment(L)))).not.toBeNull();
  });

  it("{uz_i, uz_j}: deslizadera doble, rechazada con o sin carga (§1.4, en solve2D por hasDoubleSlide)", () => {
    expect(hasDoubleSlide(rel(1, 4))).toBe(true);
    expect(hasDoubleSlide(rel(1, 4, 0, 3))).toBe(true);
  });
});

describe("transformación 2D", () => {
  const ax = localAxes([0, 0, 0], [3, 0, 4]);
  const t = transform2D(ax);

  it("T por nudo para la barra 3-4-5", () => {
    expectVec(t.flat(), [0.6, 0.8, 0, -0.8, 0.6, 0, 0, 0, 1], 1e-15);
  });

  it("toLocal6 y toGlobal6 son inversas", () => {
    const ul = toLocal6(t, [1, 0, 0, 0, 0, 2]);
    expectVec(ul, [0.6, -0.8, 0, 0, 0, 2]);
    expectVec(toGlobal6(t, ul), [1, 0, 0, 0, 0, 2]);
  });

  it("K global de una barra solo axil: EA/L·[[c², cs], [cs, s²]]", () => {
    const k = stiffnessToGlobal(t, localStiffness({ L: 5, EA: 5, EI: 0, alpha: 0 }));
    expect(get(k, 0, 0)).toBeCloseTo(0.36, 15);
    expect(get(k, 0, 1)).toBeCloseTo(0.48, 15);
    expect(get(k, 1, 1)).toBeCloseTo(0.64, 15);
    expect(get(k, 0, 3)).toBeCloseTo(-0.36, 15);
    expect(get(k, 2, 2)).toBe(0);
  });

  it("pilar vertical: y = −Y ⇒ θ_local = −ry", () => {
    const tv = transform2D(localAxes([0, 0, 0], [0, 0, 3]));
    expectVec(toLocal6(tv, [0, 0, 1, 0, 0, 0]), [0, 0, -1, 0, 0, 0]);
    expectVec(toLocal6(tv, [1, 2, 0, 0, 0, 0]), [2, 1, 0, 0, 0, 0]);
  });
});
