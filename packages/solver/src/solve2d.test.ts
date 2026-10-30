/**
 * Solver 2D-XZ completo. Esperados de soluciones analíticas clásicas (biapoyada, ménsula, empotrada-empotrada) y de
 * los ejemplos numéricos de ADR-005 §4, derivados a mano; nunca tomados de la salida del código.
 */
import { describe, expect, it } from "vitest";
import type { Load, Member, Node, Project, Support } from "@edscar/model";
import { createSolver, PACKAGE_NAME } from "./index";
import type { SolveResult } from "./index";
import { equilibriumError, fmtRatio, fmtValue, propertyErrors, relativeResidual, solve2D } from "./solve2d";
import { condense, localStiffness, stiffnessToGlobal, transform2D } from "./element2d";
import type { Released6 } from "./element2d";
import { localAxes } from "./geometry";
import type { V3 } from "./geometry";
import { get } from "./linalg";

type Fixed6 = Support["fixed"];
const PIN: Fixed6 = [true, false, true, false, false, false];
const ROLLER: Fixed6 = [false, false, true, false, false, false];
const FIXED: Fixed6 = [true, false, true, false, true, false];

interface Parts {
  analysis?: "2D-XZ" | "3D";
  nodes: [string, number, number][];
  members: Member[] | [string, string, string][];
  supports: [string, Fixed6][];
  loads?: Load[];
  E?: number;
  A?: number;
  Iy?: number;
  alpha?: number;
  density?: number;
  selfWeightFactor?: number;
  terms?: { pattern: string; factor: number }[];
  extraPatterns?: string[];
}

const E0 = 2e8;
const A0 = 0.01;
const I0 = 1e-4;
const EI0 = E0 * I0;
const EA0 = E0 * A0;

function project(p: Parts): Project {
  const nodes: Node[] = p.nodes.map(([id, x, z]) => ({ id, x, y: 0, z }));
  const members: Member[] = p.members.map((m) =>
    Array.isArray(m) ? { id: m[0], i: m[1], j: m[2], material: "M", section: "S" } : m,
  );
  return {
    schemaVersion: 1,
    units: "SI",
    analysis: p.analysis ?? "2D-XZ",
    nodes,
    members,
    materials: [{ id: "M", name: "Acero", E: p.E ?? E0, G: 8e7, density: p.density ?? 0, alpha: p.alpha ?? 1.2e-5 }],
    sections: [{ id: "S", name: "Sección", A: p.A ?? A0, Iy: p.Iy ?? I0, Iz: 1e-4, J: 1e-6 }],
    supports: p.supports.map(([node, fixed], k) => ({ id: `S${String(k)}`, node, fixed })),
    patterns: [
      { id: "G", name: "G", kind: "D", selfWeightFactor: p.selfWeightFactor ?? 0 },
      ...(p.extraPatterns ?? []).map((id) => ({ id, name: id, kind: "L" as const, selfWeightFactor: 0 })),
    ],
    loads: p.loads ?? [],
    cases: [{ id: "C1", name: "C1", type: "static-linear", terms: p.terms ?? [{ pattern: "G", factor: 1 }] }],
    combinations: [],
    settings: { gravity: [0, 0, -9.81] },
  };
}

const solve = (p: Project, caseId = "C1"): SolveResult => createSolver().solve({ project: p, caseId });

const rel = (got: number | undefined, exp: number, tol = 1e-6): void => {
  const g = got ?? NaN;
  const den = Math.abs(exp) > 0 ? Math.abs(exp) : 1;
  expect(Math.abs(g - exp) / den).toBeLessThan(tol);
};

const nodal = (id: string, node: string, f: [number, number, number], m: [number, number, number] = [0, 0, 0], pattern = "G"): Load => ({
  id,
  pattern,
  type: "nodal",
  node,
  f,
  m,
});

const ok = (r: SolveResult): void => {
  expect(r.message).toBeUndefined();
  expect(r.status).toBe("ok");
};

/** Momento My de la estación con abscisa x (y lado, si se indica). */
function stationAt(r: SolveResult, member: string, x: number, side?: "left" | "right"): { N: number; Vz: number; My: number } {
  const m = r.members.find((mm) => mm.member === member);
  const s = m?.stations.find((st) => Math.abs(st.x - x) < 1e-9 && st.side === side);
  if (!s) throw new Error(`Sin estación en x=${String(x)} ${String(side)}`);
  return s;
}

describe("viga biapoyada con carga uniforme (L = 6, w = 10)", () => {
  const L = 6;
  const w = 10;
  const p = project({
    nodes: [
      ["A", 0, 0],
      ["B", L, 0],
    ],
    members: [["M1", "A", "B"]],
    supports: [
      ["A", PIN],
      ["B", ROLLER],
    ],
    loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -w], frame: "global" }],
  });
  const out = solve2D({ project: p, caseId: "C1" });
  const r = out.result;

  it("estado, reacciones wL/2 y giros θ_A = wL³/(24EI)", () => {
    ok(r);
    expect(r.reactions.A).toEqual([0, 0, expect.closeTo(w * L / 2, 9), 0, 0, 0]);
    rel(r.reactions.B?.[2], (w * L) / 2);
    expect(r.reactions.B?.[0]).toBe(0);
    rel(r.displacements.A?.[4], (w * L ** 3) / (24 * EI0));
    rel(r.displacements.B?.[4], (-w * L ** 3) / (24 * EI0));
    expect(r.indeterminateDofs).toBeUndefined();
  });

  it("M = wL²/8 en el centro (My = −45 con el criterio crudo de ADR-001 §6) y Vz(0) = −wL/2", () => {
    rel(stationAt(r, "M1", L / 2).My, (-w * L * L) / 8);
    rel(stationAt(r, "M1", 0).Vz, (-w * L) / 2);
    rel(stationAt(r, "M1", L).Vz, (w * L) / 2);
    const st = r.members[0]?.stations ?? [];
    expect(st.length).toBe(11);
    expect(st[0]?.x).toBe(0);
    expect(st[10]?.x).toBe(L);
  });

  it("deformada interna: δ = 5wL⁴/(384EI) en el centro y 0 en los apoyos", () => {
    const d = out.deflections.M1 ?? [];
    const mid = d.find((q) => Math.abs(q.x - L / 2) < 1e-12);
    rel(mid?.w, (-5 * w * L ** 4) / (384 * EI0));
    expect(Math.abs(d[d.length - 1]?.w ?? NaN)).toBeLessThan(1e-14);
  });

  it("rotation = π: y local = −Y, luego My = +wL²/8", () => {
    const pr = project({
      nodes: [
        ["A", 0, 0],
        ["B", L, 0],
      ],
      members: [{ id: "M1", i: "A", j: "B", material: "M", section: "S", rotation: Math.PI }],
      supports: [
        ["A", PIN],
        ["B", ROLLER],
      ],
      loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -w], frame: "global" }],
    });
    const rr = solve(pr);
    ok(rr);
    rel(stationAt(rr, "M1", L / 2).My, (w * L * L) / 8);
  });
});

describe("ménsulas", () => {
  it("horizontal con P en el extremo: δ = PL³/(3EI), θ = PL²/(2EI), M_A = −PL", () => {
    const L = 4;
    const P = 20;
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", L, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [["A", FIXED]],
        loads: [nodal("P", "B", [0, 0, -P])],
      }),
    );
    ok(r);
    rel(r.displacements.B?.[2], (-P * L ** 3) / (3 * EI0));
    rel(r.displacements.B?.[4], (P * L * L) / (2 * EI0));
    rel(r.reactions.A?.[2], P);
    // Momento de la carga respecto a A: (L, 0, 0) × (0, 0, −P) = (0, +PL, 0) ⇒ reacción −PL.
    rel(r.reactions.A?.[4], -P * L);
    expect(r.reactions.B).toBeUndefined();
  });

  it("pilar vertical con H en cabeza: u = HL³/(3EI), θY = +HL²/(2EI), reacción [−H, ·, 0, ·, −HL]", () => {
    const L = 3;
    const H = 5;
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", 0, L],
        ],
        members: [["P1", "A", "B"]],
        supports: [["A", FIXED]],
        loads: [nodal("H", "B", [H, 0, 0])],
      }),
    );
    ok(r);
    rel(r.displacements.B?.[0], (H * L ** 3) / (3 * EI0));
    rel(r.displacements.B?.[4], (H * L * L) / (2 * EI0));
    rel(r.reactions.A?.[0], -H);
    rel(r.reactions.A?.[4], -H * L);
    expect(Math.abs(r.reactions.A?.[2] ?? NaN)).toBeLessThan(1e-12);
  });

  it("peso propio con factores de caso y de patrón: Fz = ρ·A·g·swf·φ·L", () => {
    const L = 5;
    const rho = 78.5;
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", L, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [["A", FIXED]],
        density: rho,
        selfWeightFactor: 1,
        terms: [{ pattern: "G", factor: 1.35 }],
      }),
    );
    ok(r);
    const q = rho * A0 * 9.81 * 1.35;
    rel(r.reactions.A?.[2], q * L);
    rel(r.reactions.A?.[4], (-q * L * L) / 2);
    rel(r.displacements.B?.[2], (-q * L ** 4) / (8 * EI0));
  });

  it("superposición de patrones con factores (G·1.35 + Q·1.5)", () => {
    const L = 2;
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", L, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [["A", FIXED]],
        extraPatterns: ["Q"],
        loads: [nodal("g", "B", [0, 0, -10]), nodal("q", "B", [4, 0, 0], [0, 0, 0], "Q")],
        terms: [
          { pattern: "G", factor: 1.35 },
          { pattern: "Q", factor: 1.5 },
        ],
      }),
    );
    ok(r);
    rel(r.reactions.A?.[2], 13.5);
    rel(r.reactions.A?.[0], -6);
    rel(r.displacements.B?.[0], (6 * L) / EA0);
  });

  it("gradiente térmico libre: w(L) = −α·gz·L²/2, θ(L) = α·gz·L, sin esfuerzos", () => {
    const L = 4;
    const a = 1.2e-5;
    const gz = 30;
    const out = solve2D({
      project: project({
        nodes: [
          ["A", 0, 0],
          ["B", L, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [["A", FIXED]],
        loads: [{ id: "t", pattern: "G", type: "thermal", member: "M1", dT: 10, gradientZ: gz }],
      }),
      caseId: "C1",
    });
    const r = out.result;
    ok(r);
    rel(r.displacements.B?.[2], (-a * gz * L * L) / 2);
    rel(r.displacements.B?.[4], a * gz * L);
    rel(r.displacements.B?.[0], a * 10 * L);
    expect(Math.abs(stationAt(r, "M1", L / 2).My)).toBeLessThan(1e-9);
    const d = out.deflections.M1 ?? [];
    rel(d[d.length - 1]?.u, a * 10 * L);
    rel(d[d.length - 1]?.w, (-a * gz * L * L) / 2);
  });
});

describe("empotrada-empotrada", () => {
  const L = 5;
  const base = (loads: Load[]): Project =>
    project({
      nodes: [
        ["A", 0, 0],
        ["B", L, 0],
      ],
      members: [["M1", "A", "B"]],
      supports: [
        ["A", FIXED],
        ["B", FIXED],
      ],
      loads,
    });

  it("asiento δ en B: cortante 12EIδ/L³, momentos 6EIδ/L², uz_B = −δ exacto", () => {
    const d = 0.01;
    const r = solve(base([{ id: "s", pattern: "G", type: "support-displacement", node: "B", d: [0, 0, -d, 0, 0, 0] }]));
    ok(r);
    expect(r.displacements.B?.[2]).toBe(-d);
    rel(r.reactions.B?.[2], (-12 * EI0 * d) / L ** 3);
    rel(r.reactions.A?.[2], (12 * EI0 * d) / L ** 3);
    // Barra con j hundido: momento de extremo de igual signo en ambos, |M| = 6EIδ/L².
    rel(Math.abs(r.members[0]?.endForces.i[4] ?? NaN), (6 * EI0 * d) / L ** 2);
    rel(r.members[0]?.endForces.i[4] ?? NaN, r.members[0]?.endForces.j[4] ?? NaN);
  });

  it("térmica uniforme y gradiente: N = −EAαdT, My = −EIα·gz, reacción ±EAαdT", () => {
    const a = 1.2e-5;
    const r = solve(base([{ id: "t", pattern: "G", type: "thermal", member: "M1", dT: 25, gradientZ: 40 }]));
    ok(r);
    const s = stationAt(r, "M1", L / 2);
    rel(s.N, -EA0 * a * 25);
    rel(s.My, -EI0 * a * 40);
    rel(r.reactions.A?.[0], EA0 * a * 25);
    rel(r.reactions.B?.[0], -EA0 * a * 25);
    expect(Math.abs(r.reactions.A?.[2] ?? NaN)).toBeLessThan(1e-9);
  });

  it("carga puntual centrada (absoluta, local): M_emp = PL/8", () => {
    const P = 16;
    const r = solve(base([{ id: "p", pattern: "G", type: "member-point", member: "M1", p: [0, 0, -P], at: L / 2, relative: false, frame: "local" }]));
    ok(r);
    rel(r.members[0]?.endForces.i[4] ?? NaN, (-P * L) / 8);
    rel(stationAt(r, "M1", L / 2, "left").My, (-P * L) / 8);
  });
});

describe("cargas de barra y estaciones con discontinuidad", () => {
  const L = 6;
  const ss = (loads: Load[]): Project =>
    project({
      nodes: [
        ["A", 0, 0],
        ["B", L, 0],
      ],
      members: [["M1", "A", "B"]],
      supports: [
        ["A", PIN],
        ["B", ROLLER],
      ],
      loads,
    });

  it("puntual relativa en L/2: Vz salta de −P/2 a +P/2; M = PL/4", () => {
    const P = 12;
    const r = solve(ss([{ id: "p", pattern: "G", type: "member-point", member: "M1", p: [0, 0, -P], at: 0.5, relative: true, frame: "global" }]));
    ok(r);
    rel(stationAt(r, "M1", 3, "left").Vz, -P / 2);
    rel(stationAt(r, "M1", 3, "right").Vz, P / 2);
    rel(stationAt(r, "M1", 3, "left").My, (-P * L) / 4);
    const st = r.members[0]?.stations ?? [];
    expect(st.length).toBe(12);
    const k = st.findIndex((s) => s.side === "left");
    expect(st[k + 1]?.side).toBe("right");
  });

  it("momento puntual my = 8 en L/2: reacciones ∓my/L y salto de My de +4 a −4", () => {
    const r = solve(
      ss([{ id: "m", pattern: "G", type: "member-point", member: "M1", p: [0, 0, 0], m: [0, 8, 0], at: 3, relative: false, frame: "global" }]),
    );
    ok(r);
    rel(r.reactions.A?.[2], -8 / L);
    rel(r.reactions.B?.[2], 8 / L);
    rel(stationAt(r, "M1", 3, "left").My, 4);
    rel(stationAt(r, "M1", 3, "right").My, -4);
  });

  it("uniforme parcial [2, 4] (local): reacciones q·2/2 y estaciones duplicadas en 2 y 4", () => {
    const q = 9;
    const r = solve(ss([{ id: "u", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -q], frame: "local", a: 2, b: 4 }]));
    ok(r);
    rel(r.reactions.A?.[2], q);
    rel(r.reactions.B?.[2], q);
    // M(3) = R·3 − q·1·0.5 = 27 − 4.5 = 22.5 ⇒ My = −22.5.
    rel(stationAt(r, "M1", 3).My, -22.5);
    rel(stationAt(r, "M1", 2, "left").My, stationAt(r, "M1", 2, "right").My);
    // 2 y 4 no están en la malla base (paso 0.6): 11 base + 2 abscisas nuevas, cada una duplicada left/right.
    expect((r.members[0]?.stations ?? []).length).toBe(11 + 2 * 2);
  });

  it("triangular 0 → q (trapecio global): reacciones qL/6 y qL/3", () => {
    const q = 12;
    const r = solve(ss([{ id: "t", pattern: "G", type: "member-trapezoid", member: "M1", w1: [0, 0, 0], w2: [0, 0, -q], a: 0, b: L, frame: "global" }]));
    ok(r);
    rel(r.reactions.A?.[2], (q * L) / 6);
    rel(r.reactions.B?.[2], (q * L) / 3);
  });

  it("carga global vertical sobre barra inclinada 3-4-5 (por longitud real): reacciones 2.5·q", () => {
    const q = 2;
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", 3, 4],
        ],
        members: [["M1", "A", "B"]],
        supports: [
          ["A", PIN],
          ["B", ROLLER],
        ],
        loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -q], frame: "global" }],
      }),
    );
    ok(r);
    rel(r.reactions.A?.[2], 2.5 * q);
    rel(r.reactions.B?.[2], 2.5 * q);
    expect(Math.abs(r.reactions.A?.[0] ?? NaN)).toBeLessThan(1e-12);
    // Axil en i: componente de la reacción vertical sobre x local (0.6, 0.8): N(0) = −(2.5q·0.8)·… compresión.
    rel(stationAt(r, "M1", 0).N, -2.5 * q * 0.8);
  });

  it("cargas nulas se ignoran y la viga queda sin esfuerzos", () => {
    const r = solve(
      ss([
        { id: "z1", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, 0], frame: "global" },
        { id: "z2", pattern: "G", type: "member-point", member: "M1", p: [0, 0, 0], m: [0, 0, 0], at: 1, relative: false, frame: "local" },
      ]),
    );
    ok(r);
    expect(r.members[0]?.stations.length).toBe(11);
    expect(r.reactions.A).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("cercha triangular de ADR-005 §4", () => {
  const truss = (extra: Partial<Parts> = {}, supA: Fixed6 = PIN): Project => {
    const art = { i: { ry: true }, j: { ry: true } };
    return project({
      nodes: [
        ["A", 0, 0],
        ["B", 8, 0],
        ["C", 4, 3],
        ...(extra.nodes ?? []),
      ],
      members: [
        { id: "AB", i: "A", j: "B", material: "M", section: "S", releases: art },
        { id: "AC", i: "A", j: "C", material: "M", section: "S", releases: art },
        { id: "BC", i: "B", j: "C", material: "M", section: "S", releases: art },
        ...((extra.members ?? []) as Member[]),
      ],
      supports: [["A", supA], ["B", ROLLER], ...(extra.supports ?? [])],
      loads: [nodal("P", "C", [0, 0, -60]), ...(extra.loads ?? [])],
      E: 2.1e8,
      A: 0.004,
    });
  };

  it("desplazamientos, esfuerzos, reacciones e indeterminateDofs del ADR", () => {
    const r = solve(truss());
    ok(r);
    rel(r.displacements.B?.[0], 8 / 21000);
    rel(r.displacements.C?.[0], 4 / 21000);
    rel(r.displacements.C?.[2], -7.5e-4);
    expect(r.displacements.C?.[4]).toBe(0);
    rel(r.reactions.A?.[2], 30);
    rel(r.reactions.B?.[2], 30);
    expect(r.reactions.A?.[4]).toBe(0);
    expect(r.reactions.B?.[4]).toBe(0);
    expect(r.indeterminateDofs).toEqual({ A: [4], B: [4], C: [4] });
    const ab = r.members.find((m) => m.member === "AB");
    const ac = r.members.find((m) => m.member === "AC");
    rel(ab?.endForces.i[0], -40);
    rel(ab?.endForces.j[0], 40);
    rel(ac?.endForces.i[0], 50);
    expect(ac?.endForces.i[4]).toBe(0);
    expect(ac?.endForces.j[4]).toBe(0);
    for (const s of ac?.stations ?? []) {
      rel(s.N, -50);
      expect(Math.abs(s.My)).toBeLessThan(1e-9);
    }
  });

  it("mecanismo real (A rodillo): singular con modo A.ux, B.ux, C.ux y resultados vacíos", () => {
    const r = solve(truss({}, ROLLER));
    expect(r.status).toBe("singular");
    expect(r.message).toMatch(/^Mecanismo detectado en el nudo [ABC], GDL ux \(pivote relativo .+\); modo: A\.ux, B\.ux, C\.ux; revise apoyos y liberaciones$/);
    expect(r.displacements).toEqual({});
    expect(r.reactions).toEqual({});
    expect(r.members).toEqual([]);
  });

  it("momento nodal en C sin rigidez: invalid-model con el mensaje exacto", () => {
    const r = solve(truss({ loads: [nodal("m", "C", [0, 0, 0], [0, 5, 0])] }));
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe("Nudo C: momento aplicado en ry pero ninguna barra transmite momento a ese nudo (todas articuladas)");
  });

  const dc = {
    nodes: [["D", 7, 3]] as [string, number, number][],
    members: [{ id: "DC", i: "D", j: "C", material: "M", section: "S", releases: { i: { uz: true, ry: true } } }] as Member[],
    loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "DC", w: [0, 0, -10], frame: "global" }] as Load[],
  };

  it("barra DC con momento perdido (r = +45 kN·m): mensaje exacto del ADR", () => {
    const r = solve(truss({ ...dc, supports: [["D", PIN]] }));
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe(
      "Barra DC: su carga produce un momento 45 kN·m en el extremo j (nudo C, GDL ry) que ninguna barra transmite (nudo articulado); revise liberaciones",
    );
  });

  it("barra CD (orientación inversa, {uz_j, ry_j}): momento perdido en el extremo i", () => {
    // C → D: x local = +X, y local = +Y. Voladizo empotrado en i con wz = −10, L = 3: My_i = −wL²/2 = −45 (local)
    // ⇒ f*_eq,i = +45 alrededor de +Y ⇒ r(C.ry) = +45 (mismo valor físico que el caso DC del ADR).
    const r = solve(
      truss({
        nodes: dc.nodes,
        members: [{ id: "CD", i: "C", j: "D", material: "M", section: "S", releases: { j: { uz: true, ry: true } } }],
        loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "CD", w: [0, 0, -10], frame: "global" }],
        supports: [["D", PIN]],
      }),
    );
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe(
      "Barra CD: su carga produce un momento 45 kN·m en el extremo i (nudo C, GDL ry) que ninguna barra transmite (nudo articulado); revise liberaciones",
    );
  });

  it("dos barras con momento perdido en C: se nombra la de mayor |c| y se listan las demás", () => {
    // EC (E(2, 0, 3) → C, x local = +X, y local = +Y), L = 2, {uz_i, ry_i}: voladizo empotrado en C con
    // My_j = +wL²/2 = +20 (local, alrededor de +Y) ⇒ c = −20 alrededor de +Y. DC aporta +45 ⇒ r = 25 ≠ 0.
    const r = solve(
      truss({
        nodes: [...dc.nodes, ["E", 2, 3]],
        members: [
          ...dc.members,
          { id: "EC", i: "E", j: "C", material: "M", section: "S", releases: { i: { uz: true, ry: true } } },
        ],
        loads: [...dc.loads, { id: "q2", pattern: "G", type: "member-uniform", member: "EC", w: [0, 0, -10], frame: "global" }],
        supports: [
          ["D", PIN],
          ["E", PIN],
        ],
      }),
    );
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe(
      "Barra DC: su carga produce un momento 45 kN·m en el extremo j (nudo C, GDL ry) que ninguna barra transmite (nudo articulado); revise liberaciones (también: EC)",
    );
  });

  it("con apoyo en C.ry: reacción C[4] = −45 kN·m y C fuera de indeterminateDofs", () => {
    const r = solve(
      truss({
        ...dc,
        supports: [
          ["D", PIN],
          ["C", [false, false, false, false, true, false]],
        ],
      }),
    );
    ok(r);
    rel(r.reactions.C?.[4], -45);
    expect(r.reactions.C?.[0]).toBe(0);
    expect(r.indeterminateDofs?.C).toBeUndefined();
    expect(r.indeterminateDofs?.D).toEqual([4]);
  });

  it("No es mecanismo (§4): barra continua CE a un empotramiento en E(4, 0, 6) ⇒ C.ry tiene rigidez y no se elimina", () => {
    // CE vertical (h = 3, EA = 840 000, EI = 2.1e8·1e-4 = 21 000) aporta EA/h en C.uz y, en C.ux–C.ry, la flexión de
    // una ménsula empotrada en E. C.ry solo recibe rigidez de CE y no tiene carga ⇒ condensándolo, la rigidez lateral
    // en C.ux es 12EI/h³ − (6EI/h²)²/(4EI/h) = 3EI/h³ y |θ_C| = (6EI/h²)/(4EI/h)·|C.ux| = 1.5·|C.ux|/h. Signo: la
    // deformada es u_X(s) = C.ux·(1 − 3s/2h + s³/2h³) (s desde C hacia +Z, u(h) = u'(h) = 0, M(0) = 0); la tangente
    // en C, (du/ds, 1) = (−1.5·C.ux/h, 1), es el eje Z girado θ alrededor de Y (Z → X positivo) ⇒ θ_C = −1.5·C.ux/h.
    // Sistema [B.ux, C.ux, C.uz] = K de §4 + diag(0, 3EI/h³, EA/h), F = [0, 0, −60], resuelto por Cramer.
    const h = 3;
    const EA = 2.1e8 * 0.004;
    const EI = 2.1e8 * I0;
    const K = [
      [212520, -107520, 80640],
      [-107520, 215040 + (3 * EI) / h ** 3, 0],
      [80640, 0, 120960 + EA / h],
    ];
    const det3 = (m: number[][]): number => {
      const g = (i: number, j: number): number => m[i]?.[j] ?? NaN;
      return (
        g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
        g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
        g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0))
      );
    };
    const F = [0, 0, -60];
    const D = det3(K);
    const sol = [0, 1, 2].map((c) => det3(K.map((row, i) => row.map((v, j) => (j === c ? (F[i] ?? NaN) : v)))) / D);
    const [bx, cx, cz] = sol as [number, number, number];
    const r = solve(
      truss({
        nodes: [["E", 4, 6]],
        members: [{ id: "CE", i: "C", j: "E", material: "M", section: "S" }],
        supports: [["E", FIXED]],
      }),
    );
    ok(r);
    expect(r.indeterminateDofs).toEqual({ A: [4], B: [4] });
    rel(r.displacements.B?.[0], bx);
    rel(r.displacements.C?.[0], cx);
    rel(r.displacements.C?.[2], cz);
    rel(r.displacements.C?.[4], (-1.5 * cx) / h);
    // Reacciones en E: axil de CE −(EA/h)·C.uz (tracción, hacia +Z), cortante −(3EI/h³)·C.ux y momento
    // h·(3EI/h³)·C.ux (fuerza (3EI/h³)·C.ux en C, a dz = −h de E: M_Y = dz·Fx).
    rel(r.reactions.E?.[2], (-EA / h) * cz);
    rel(r.reactions.E?.[0], ((-3 * EI) / h ** 3) * cx);
    rel(r.reactions.E?.[4], ((3 * EI) / h ** 2) * cx);
    rel((r.reactions.A?.[2] ?? NaN) + (r.reactions.B?.[2] ?? NaN) + (r.reactions.E?.[2] ?? NaN), 60);
  });

  it("K global (§1.5, §2.4): filas y columnas de los GDL ry eliminados exactamente nulas", () => {
    // Ensamblaje completo (sin eliminar nada) de la cercha + DC con {uz_i, ry_i}. Teórico: los bloques de flexión
    // condensados con |R ∩ flexión| ≥ 2 se escriben con ceros exactos y T no mezcla ry con traslaciones ⇒ las filas
    // y columnas de A.ry, B.ry, C.ry y D.ry son 0 exacto; las de traslación son las de §4 (B.ux–B.ux = 212 520,
    // C.ux–C.uz = 0) más la barra DC (horizontal, solo axil EA/3 = 280 000 en D.ux–C.ux).
    const pos: Record<string, [number, number, number]> = { A: [0, 0, 0], B: [8, 0, 0], C: [4, 0, 3], D: [7, 0, 3] };
    const idx: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    const EA = 2.1e8 * 0.004;
    const EI = 2.1e8 * I0;
    const art: Released6 = [false, false, true, false, false, true];
    const bars: [string, string, Released6][] = [
      ["A", "B", art],
      ["A", "C", art],
      ["B", "C", art],
      ["D", "C", [false, true, true, false, false, false]],
    ];
    const n = 12;
    const KG = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const [i, j, rl] of bars) {
      const ax = localAxes(pos[i] as V3, pos[j] as V3, 0, true);
      const props = { L: ax.length, EA, EI, alpha: 0 };
      const c = condense(localStiffness(props), [0, 0, 0, 0, 0, 0], rl, props.L);
      const kg = stiffnessToGlobal(transform2D(ax), c.k);
      const dofs = [0, 1, 2, 3, 4, 5].map((r) => 3 * (idx[r < 3 ? i : j] ?? NaN) + (r % 3));
      dofs.forEach((ga, a) => {
        dofs.forEach((gb, b) => {
          const row = KG[ga] as number[];
          row[gb] = (row[gb] ?? 0) + get(kg, a, b);
        });
      });
    }
    for (const node of [0, 1, 2, 3]) {
      const g = 3 * node + 2;
      for (let q = 0; q < n; q++) {
        expect(KG[g]?.[q] === 0).toBe(true);
        expect(KG[q]?.[g] === 0).toBe(true);
      }
    }
    rel(KG[3]?.[3], 212520);
    expect(Math.abs(KG[6]?.[7] ?? NaN)).toBeLessThan(1e-9);
    rel(KG[6]?.[6], 215040 + EA / 3);
    rel(KG[9]?.[6], -EA / 3);
    // D.uz no recibe rigidez (DC solo trabaja a axil horizontal): por eso D necesita el apoyo articulado.
    expect(Math.abs(KG[10]?.[10] ?? NaN)).toBeLessThan(1e-9);
  });
});

describe("biela interna con las cuatro liberaciones de flexión (hallazgo 2 del Revisor)", () => {
  // A(0) – B(3) – C(5) – D(8) sobre el eje X; A y D empotrados; AB y CD continuas; BC con uz y ry liberados en ambos
  // extremos (solo transmite axil); P = −10 kN (Z) en B. Esperado a mano: AB es una ménsula con P en la punta,
  // uz_B = PL³/(3EI) = −10·27/(3EI) = −90/EI y θ_B = −w'(L) = −PL²/(2EI) = +45/EI; CD sin carga ⇒ C fijo. BC no tiene
  // esfuerzos y su posición transversal es indeterminada (núcleo de 2 modos rígidos): por convención se dibuja unida
  // a los nudos (salto mínimo de traslaciones): w(x) = uz_B·(1 − x/2), u = 0.
  const p = project({
    nodes: [
      ["A", 0, 0],
      ["B", 3, 0],
      ["C", 5, 0],
      ["D", 8, 0],
    ],
    members: [
      { id: "AB", i: "A", j: "B", material: "M", section: "S" },
      { id: "BC", i: "B", j: "C", material: "M", section: "S", releases: { i: { uz: true, ry: true }, j: { uz: true, ry: true } } },
      { id: "CD", i: "C", j: "D", material: "M", section: "S" },
    ],
    supports: [
      ["A", FIXED],
      ["D", FIXED],
    ],
    loads: [nodal("P", "B", [0, 0, -10])],
  });
  const r = solve(p);

  it("ok con aviso de mecanismo interno; desplazamientos y esfuerzos de la ménsula AB", () => {
    expect(r.status).toBe("ok");
    expect(r.message).toBe(
      "Aviso: Barra BC: mecanismo interno sin carga que lo active (flexión x–z: uz_i, ry_i, uz_j, ry_j); sus desplazamientos de extremo liberados son indeterminados y la deformada se dibuja unida a los nudos por convención",
    );
    expect(r.indeterminateDofs).toBeUndefined();
    rel(r.displacements.B?.[2], -90 / EI0);
    rel(r.displacements.B?.[4], 45 / EI0);
    expect(Math.abs(r.displacements.C?.[2] ?? NaN)).toBeLessThan(1e-15);
    rel(r.reactions.A?.[2], 10);
    rel(r.reactions.A?.[4], -30);
    const bc = r.members.find((m) => m.member === "BC");
    for (const v of [...(bc?.endForces.i ?? []), ...(bc?.endForces.j ?? [])]) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it("deformada de BC unida a B y a C: w(x) = uz_B·(1 − x/2), no [0, 0, 0] en ambos extremos", () => {
    const d = r.deflections?.BC ?? [];
    expect(d.length).toBeGreaterThan(2);
    rel(d[0]?.d[2], -90 / EI0);
    expect(Math.abs(d[d.length - 1]?.d[2] ?? NaN)).toBeLessThan(1e-15);
    for (const s of d) {
      rel(s.d[2], (-90 / EI0) * (1 - s.x / 2));
      expect(Math.abs(s.d[0])).toBeLessThan(1e-15);
    }
  });
});

describe("modelos inválidos y otros estados", () => {
  const beam = (patch: Partial<Parts> = {}): Project =>
    project({
      nodes: [
        ["A", 0, 0],
        ["B", 4, 0],
      ],
      members: [["M1", "A", "B"]],
      supports: [["A", FIXED]],
      ...patch,
    });

  it("E = 0: invalid-model con el mensaje por barra", () => {
    const r = solve(beam({ E: 0 }));
    expect(r.status).toBe("invalid-model");
    expect(r.message?.startsWith("Barra M1: E debe ser > 0; ")).toBe(true);
    expect(r.members).toEqual([]);
  });

  it("proyecto no válido (no es un objeto) ⇒ invalid-model sin lanzar", () => {
    const r = createSolver().solve({ project: null as unknown as Project, caseId: "C1" });
    expect(r.status).toBe("invalid-model");
    expect(r.message?.length ?? 0).toBeGreaterThan(0);
  });

  it("análisis 3D ⇒ unsupported (no soportado en M1), sin resultados ni deformada", () => {
    const r = solve(beam({ analysis: "3D", supports: [["A", [true, true, true, true, true, true]]] }));
    expect(r.status).toBe("unsupported");
    expect(r.message).toBe('Análisis "3D" no soportado todavía por el solver (previsto en M4, pendiente de ADR); solo se resuelve "2D-XZ"');
    expect(r.members).toEqual([]);
    expect(r.displacements).toEqual({});
    expect(r.deflections).toBeUndefined();
  });

  it("modelo 3D no válido ⇒ invalid-model (la validación va antes que el análisis)", () => {
    const r = solve(beam({ analysis: "3D", E: 0, supports: [["A", [true, true, true, true, true, true]]] }));
    expect(r.status).toBe("invalid-model");
  });

  it("estados distintos de ok: sin deformada", () => {
    expect(solve(beam(), "NOPE").deflections).toBeUndefined();
    expect(solve(beam({ supports: [], loads: [nodal("P", "B", [0, 0, -1])] })).deflections).toBeUndefined();
  });

  it("caso inexistente", () => {
    const r = solve(beam(), "NOPE");
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe('El caso "NOPE" no existe');
  });

  it("deslizaderas en ambos extremos: rechazadas (ADR-005 §1.4)", () => {
    const r = solve(
      beam({ members: [{ id: "M1", i: "A", j: "B", material: "M", section: "S", releases: { i: { uz: true }, j: { uz: true } } }] }),
    );
    expect(r.status).toBe("invalid-model");
    expect(r.message).toContain("Barra M1: las liberaciones uz_i, uz_j");
  });

  it("mecanismo interno axil con carga axil ⇒ invalid-model nombrando la barra", () => {
    const r = solve(
      beam({
        members: [{ id: "M1", i: "A", j: "B", material: "M", section: "S", releases: { i: { ux: true }, j: { ux: true } } }],
        loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [3, 0, 0], frame: "local" }],
      }),
    );
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe(
      "Barra M1: las liberaciones ux_i, ux_j forman un mecanismo interno (axil) y la barra tiene carga en ese bloque",
    );
  });

  it("sin apoyos: singular por pivote", () => {
    const r = solve(beam({ supports: [], loads: [nodal("P", "B", [0, 0, -1])] }));
    expect(r.status).toBe("singular");
    // Los GDL de A solos forman un bloque regular; el primer pivote nulo aparece en B.ux (traslación axil rígida).
    expect(r.message).toBe("Mecanismo detectado en el nudo B, GDL ux (pivote relativo 0.00e+0); modo: A.ux, B.ux; revise apoyos y liberaciones");
  });

  it("todo restringido: sin ecuaciones; la carga en el nudo apoyado la toma su apoyo (ΣR + ΣF = 0, ADR-001 §5)", () => {
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", 4, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [
          ["A", FIXED],
          ["B", FIXED],
        ],
        loads: [nodal("P", "B", [0, 0, -7])],
      }),
    );
    ok(r);
    // La reacción es solo la acción del apoyo: la barra no trabaja (u = 0) y el apoyo de B equilibra −7 ⇒ +7.
    expect(r.reactions.B).toEqual([0, 0, 7, 0, 0, 0]);
    expect(r.reactions.A).toEqual([0, 0, 0, 0, 0, 0]);
  });

  // Ménsula a 45° (L = √2) con EA ≫ EI. Pivote relativo a mano en el bloque ux–uz de B (a = EA/L, b = 12EI/L³):
  // d/K = 4ab/(a + b)² ≈ 4b/a = 48·Iy/(A·L²) = 24·Iy (A = 1). El error de equilibrio es ruido de redondeo de
  // orden ε/(d/K) ≈ 2.2e-16/(24·Iy) (ADR-005 §3.6–3.7): su valor exacto depende del redondeo, así que solo se
  // comprueba la banda teórica eligiendo contrastes con gran margen respecto a los umbrales 1e-9 y 1e-6.
  const ill = (Iy: number): Project =>
    beam({
      nodes: [
        ["A", 0, 0],
        ["B", 1, 1],
      ],
      A: 1,
      Iy,
      loads: [nodal("P", "B", [0, 0, -1])],
    });
  const eqValue = (msg: string | undefined): number => {
    const m = /desequilibrio (?:global )?relativo ([0-9.]+e[-+]\d+)/.exec(msg ?? "");
    return m ? Number(m[1]) : NaN;
  };

  it("mal condicionamiento (Iy = 3e-10, d/K = 7.2e-9): aviso de pivote exacto y equilibrio en la banda de aviso", () => {
    const r = solve(ill(3e-10));
    expect(r.status).toBe("ok");
    // Pivote 7.20e-9 ⇒ se pierden ≈ 8 cifras (determinista: es d/K, no ruido). Estimación del equilibrio:
    // ε/(d/K) ≈ 3.1e-8 ≈ √(1e-9·1e-6): centro logarítmico de la banda de aviso (1.5 órdenes a cada umbral).
    expect(r.message?.startsWith(
      "Aviso: sistema mal condicionado en el nudo B, GDL uz (pivote relativo 7.20e-9; se pierden ≈ 8 cifras significativas); Aviso: desequilibrio global relativo ",
    )).toBe(true);
    expect(r.message?.endsWith("; revise rigideces muy dispares (EA o EI enormes)")).toBe(true);
    const e = eqValue(r.message);
    expect(e).toBeGreaterThan(1e-9);
    expect(e).toBeLessThanOrEqual(1e-6);
    // δ_z = (P/2)·(L/EA + L³/(3EI)), L = √2 (componentes axil y transversal de la carga a 45°).
    const Lb = Math.SQRT2;
    rel(r.displacements.B?.[2], -0.5 * (Lb / (E0 * 1) + Lb ** 3 / (3 * E0 * 3e-10)), 1e-5);
  });

  it("contraste extremo (Iy = 3e-13, d/K = 7.2e-12 > τ = 1e-12): equilibrio > 1e-6 ⇒ singular y resultados vacíos", () => {
    // Estimación ε/(d/K) ≈ 3e-5, 1.5 órdenes por encima de 1e-6, y pivote ~0.9 órdenes por encima de τ (no
    // cae en el criterio de pivote, que es determinista).
    const r = solve(ill(3e-13));
    expect(r.status).toBe("singular");
    expect(r.message?.startsWith("Sistema singular o mal condicionado: desequilibrio relativo ")).toBe(true);
    expect(r.message?.endsWith("; revise rigideces muy dispares (EA o EI enormes) y liberaciones")).toBe(true);
    expect(eqValue(r.message)).toBeGreaterThan(1e-6);
    expect(r.members).toEqual([]);
    expect(r.displacements).toEqual({});
  });

  it("contraste moderado (Iy = 1e-6, d/K = 2.4e-5): sin avisos", () => {
    ok(solve(ill(1e-6)));
  });

  it("control de integridad §3.5 alcanzable: desbordamiento (U = ∞) con un modelo válido ⇒ singular por residuo", () => {
    // Datos finitos y > 0 que validateProject admite, pero F/K ≈ 1e300/1e-18 desborda a ∞ en la sustitución: el
    // pivote no lo detecta (d/K ≈ 1) y el residuo es NaN ⇒ !(res ≤ 1e-9). La otra causa de §3.5 (error de
    // implementación en ensamblaje o sustitución) no es alcanzable con un modelo legítimo: se prueba la utilidad
    // relativeResidual por separado.
    const r = solve(beam({ E: 1e-6, A: 1e-6, Iy: 1e-12, loads: [nodal("P", "B", [0, 0, -1e300])] }));
    expect(r.status).toBe("singular");
    expect(r.message?.startsWith("Sistema singular o mal condicionado: residuo relativo ")).toBe(true);
    expect(r.members).toEqual([]);
  });

  it("error interno: createSolver().solve no lanza (status invalid-model, «Error interno del solver»)", () => {
    const req = {
      project: beam(),
      get caseId(): string {
        throw new Error("fallo simulado");
      },
    };
    const r = createSolver().solve(req);
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe("Error interno del solver: fallo simulado");
    expect(r.members).toEqual([]);
    const r2 = createSolver().solve({
      project: beam(),
      get caseId(): string {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- se prueba un valor lanzado que no es Error
        throw "texto";
      },
    });
    expect(r2.message).toBe("Error interno del solver: texto");
  });

  it("carga uniforme con a = L y b = L + 5e-10 (admitida por validateProject): tramo nulo tras recortar, sin NaN", () => {
    const L = 4;
    const r = solve(
      beam({
        loads: [{ id: "u", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -10], frame: "local", a: L, b: L + 5e-10 }],
      }),
    );
    ok(r);
    expect(r.reactions.A).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.members[0]?.stations.every((s) => s.My === 0 && s.Vz === 0)).toBe(true);
  });

  it("trapecio que sobresale de L con tramo interior ≤ 1e-9·L: puntual equivalente con la ley reinterpolada en L", () => {
    // Ménsula empotrada en A (L = 4). Trapecio local w1 = −1 en a = L − 1e-12, w2 = −2 en b = L + 5e-10. Se recorta a
    // [a, L] (los doubles exactos de la entrada: len = L − a, len0 = b − a); en L la ley vale w(L) = −1 − (L − a)/len0.
    // Resultante P = (w1 + w(L))/2·len en x = (a + L)/2 ⇒ reacción Fz_A = −P, M_A = x·P (M_Y = −dx·Fz).
    const L = 4;
    const a = L - 1e-12;
    const b = L + 5e-10;
    const len = L - a;
    const wL = -1 - (L - a) / (b - a);
    const P = ((-1 + wL) / 2) * len;
    const r = solve(
      beam({
        loads: [{ id: "t", pattern: "G", type: "member-trapezoid", member: "M1", w1: [0, 0, -1], w2: [0, 0, -2], a, b, frame: "local" }],
      }),
    );
    ok(r);
    rel(r.reactions.A?.[2], -P);
    rel(r.reactions.A?.[4], ((a + L) / 2) * P);
    expect(r.members[0]?.stations.some((s) => Number.isNaN(s.My))).toBe(false);
  });

  it("carga de 1e8 kN/m en 2e-9 m (≤ 1e-9·L): no se pierde, actúa como P = 0.2 kN puntual (biapoyada L = 4)", () => {
    // Antes se descartaba en silencio. P = 1e8·2e-9 = 0.2 kN en x = 2 + 1e-9 ⇒ R_A = P·(L − x)/L, R_B = P·x/L
    // (≈ 0.1 cada una), δ(L/2) = PL³/(48EI) salvo O(1e-9) relativo y My(L/2) = −PL/4 (criterio crudo ADR-001 §6).
    const L = 4;
    const x = 2 + 1e-9;
    const P = 1e8 * 2e-9;
    const out = solve2D({
      project: project({
        nodes: [
          ["A", 0, 0],
          ["B", L, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [
          ["A", PIN],
          ["B", ROLLER],
        ],
        loads: [{ id: "u", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -1e8], frame: "local", a: 2, b: 2 + 2e-9 }],
      }),
      caseId: "C1",
    });
    const r = out.result;
    ok(r);
    rel(r.reactions.A?.[2], (P * (L - x)) / L);
    rel(r.reactions.B?.[2], (P * x) / L);
    rel(stationAt(r, "M1", 2, "left").My, (-P * L) / 4);
    const mid = out.deflections.M1?.find((q) => Math.abs(q.x - L / 2) < 1e-6);
    rel(mid?.w, (-P * L ** 3) / (48 * EI0));
  });

  it("patrones de mecanismo interno con carga no ortogonal ⇒ invalid-model nombrando barra y liberaciones", () => {
    const pats: [string, NonNullable<Member["releases"]>][] = [
      ["uz_i, ry_i, ry_j", { i: { uz: true, ry: true }, j: { ry: true } }],
      ["uz_i, ry_i, uz_j", { i: { uz: true, ry: true }, j: { uz: true } }],
      ["uz_i, uz_j, ry_j", { i: { uz: true }, j: { uz: true, ry: true } }],
      ["ry_i, uz_j, ry_j", { i: { ry: true }, j: { uz: true, ry: true } }],
      ["uz_i, ry_i, uz_j, ry_j", { i: { uz: true, ry: true }, j: { uz: true, ry: true } }],
    ];
    for (const [names, releases] of pats) {
      const r = solve(
        beam({
          members: [{ id: "M1", i: "A", j: "B", material: "M", section: "S", releases }],
          loads: [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -5], frame: "global" }],
        }),
      );
      expect(r.status).toBe("invalid-model");
      expect(r.message).toBe(`Barra M1: las liberaciones ${names} forman un mecanismo interno (flexión x–z) y la barra tiene carga en ese bloque`);
    }
  });

  it("modo de mecanismo con más de 10 GDL: se listan 10 y «…»", () => {
    // Viga continua de 11 nudos, todos con rodillo: traslación horizontal libre de los 11 nudos.
    const nodes: [string, number, number][] = Array.from({ length: 11 }, (_, k) => [`N${String(k)}`, k, 0]);
    const members: [string, string, string][] = Array.from({ length: 10 }, (_, k) => [`B${String(k)}`, `N${String(k)}`, `N${String(k + 1)}`]);
    const r = solve(project({ nodes, members, supports: nodes.map(([id]) => [id, ROLLER]) }));
    expect(r.status).toBe("singular");
    expect(r.message).toBe(
      `Mecanismo detectado en el nudo N10, GDL ux (pivote relativo 0.00e+0); modo: ${Array.from({ length: 10 }, (_, k) => `N${String(k)}.ux`).join(", ")}, …; revise apoyos y liberaciones`,
    );
  });

  it("térmica sin gradientZ en barra empotrada-empotrada: solo axil −EAαdT", () => {
    const r = solve(
      project({
        nodes: [
          ["A", 0, 0],
          ["B", 3, 0],
        ],
        members: [["M1", "A", "B"]],
        supports: [
          ["A", FIXED],
          ["B", FIXED],
        ],
        loads: [{ id: "t", pattern: "G", type: "thermal", member: "M1", dT: -15 }],
      }),
    );
    ok(r);
    rel(stationAt(r, "M1", 1.5).N, EA0 * 1.2e-5 * 15);
    expect(stationAt(r, "M1", 1.5).My === 0).toBe(true);
  });

  it("instancias independientes de createSolver", () => {
    expect(PACKAGE_NAME).toBe("@edscar/solver");
    const s1 = createSolver();
    const s2 = createSolver();
    expect(s1).not.toBe(s2);
    const p = beam({ loads: [nodal("P", "B", [0, 0, -1])] });
    expect(s1.solve({ project: p, caseId: "C1" })).toEqual(s2.solve({ project: p, caseId: "C1" }));
  });
});

describe("ejemplo del Revisor de ADR-005 §1.3: R = {uz_i, ry_i, ry_j} (bloque nulo con f*_emp ≠ 0)", () => {
  const L = 5;
  const Pz = -10; // local z = +Z en una barra horizontal A → B; P hacia −Z
  const model = (at: number): Project =>
    project({
      nodes: [
        ["A", 0, 0],
        ["B", L, 0],
      ],
      members: [{ id: "V", i: "A", j: "B", material: "M", section: "S", releases: { i: { uz: true, ry: true }, j: { ry: true } } }],
      // A: ux, uz (uz_A no recibe rigidez de la barra; necesita el apoyo); B: rodillo en uz.
      supports: [
        ["A", PIN],
        ["B", ROLLER],
      ],
      loads: [{ id: "p", pattern: "G", type: "member-point", member: "V", p: [0, 0, Pz], at, relative: false, frame: "local" }],
    });

  it("P en x = L: ok, endForces.j[2] = −P_z = +10, toda la carga al apoyo B", () => {
    const r = solve(model(L));
    expect(r.status).toBe("ok");
    // El núcleo (giro rígido alrededor de j) no está activado por la carga, pero la posición transversal de la barra
    // queda indeterminada: aviso informativo (status ok). Con w_A = w_B = 0 la deformada unida a los nudos es nula.
    expect(r.message).toBe(
      "Aviso: Barra V: mecanismo interno sin carga que lo active (flexión x–z: uz_i, ry_i, ry_j); sus desplazamientos de extremo liberados son indeterminados y la deformada se dibuja unida a los nudos por convención",
    );
    expect(r.deflections?.V?.every((s) => Math.abs(s.d[2]) < 1e-15)).toBe(true);
    const m = r.members[0];
    rel(m?.endForces.j[2], -Pz);
    expect(m?.endForces.i[2]).toBe(0);
    expect(m?.endForces.i[4]).toBe(0);
    expect(m?.endForces.j[4]).toBe(0);
    rel(r.reactions.B?.[2], -Pz);
    expect(Math.abs(r.reactions.A?.[2] ?? NaN)).toBeLessThan(1e-12);
    expect(r.indeterminateDofs).toEqual({ A: [4], B: [4] });
  });

  it("P en x = L/2: la barra gira libremente alrededor de j ⇒ invalid-model", () => {
    const r = solve(model(L / 2));
    expect(r.status).toBe("invalid-model");
    expect(r.message).toBe(
      "Barra V: las liberaciones uz_i, ry_i, ry_j forman un mecanismo interno (flexión x–z) y la barra tiene carga en ese bloque",
    );
  });
});

describe("coordenadas tipo UTM (ADR-005 §3.6)", () => {
  // Pórtico biempotrado 6 × 4 m: H = 15 kN en B (+X) y q = 10 kN/m hacia −Z en el dintel BC.
  const portal = (x0: number, z0: number): Project =>
    project({
      nodes: [
        ["A", x0, z0],
        ["B", x0, z0 + 4],
        ["C", x0 + 6, z0 + 4],
        ["D", x0 + 6, z0],
      ],
      members: [
        ["AB", "A", "B"],
        ["BC", "B", "C"],
        ["CD", "C", "D"],
      ],
      supports: [
        ["A", FIXED],
        ["D", FIXED],
      ],
      loads: [nodal("H", "B", [15, 0, 0]), { id: "q", pattern: "G", type: "member-uniform", member: "BC", w: [0, 0, -10], frame: "global" }],
    });

  it("X ≈ 5e5, Z ≈ 4.3e6: ok sin avisos, en equilibrio y con los mismos resultados que en el origen", () => {
    const r = solve(portal(512345.678, 4312345.678));
    const r0 = solve(portal(0, 0));
    ok(r);
    ok(r0);
    const RA = r.reactions.A ?? [];
    const RD = r.reactions.D ?? [];
    // ΣFx: RA + RD + 15 = 0; ΣFz: RA + RD − 60 = 0.
    rel((RA[0] ?? NaN) + (RD[0] ?? NaN), -15, 1e-9);
    rel((RA[2] ?? NaN) + (RD[2] ?? NaN), 60, 1e-9);
    // ΣM_Y respecto a A (coordenadas relativas; M_Y de (dx, dz) × (Fx, Fz) = dz·Fx − dx·Fz):
    // H en (0, 4): 60; q (resultante −60 en (3, 4)): 180; RD en (6, 0): −6·RD_z; más los momentos de apoyo.
    const sm = 60 + 180 - 6 * (RD[2] ?? NaN) + (RA[4] ?? NaN) + (RD[4] ?? NaN);
    expect(Math.abs(sm)).toBeLessThan(1e-9 * 240);
    for (const n of ["A", "B", "C", "D"]) {
      for (const k of [0, 2, 4]) {
        const a = r.displacements[n]?.[k] ?? NaN;
        const b = r0.displacements[n]?.[k] ?? NaN;
        if (Math.abs(b) > 0) rel(a, b, 1e-6);
        else expect(a).toBe(0);
      }
    }
    for (const n of ["A", "D"]) for (const k of [0, 2, 4]) rel(r.reactions[n]?.[k], r0.reactions[n]?.[k] ?? NaN, 1e-6);
  });
});

describe("utilidades de control (ADR-005 §3.5–3.6)", () => {
  it("residuo relativo", () => {
    expect(relativeResidual([2], [1], 1, [1])).toBe(0.5);
    expect(relativeResidual([0], [0], 0, [0])).toBe(0);
    expect(relativeResidual([1], [0], 0, [0])).toBe(Infinity);
  });

  it("equilibrio: sistema equilibrado con coordenadas UTM ⇒ 0", () => {
    const c = [
      [500000, 4e6],
      [500006, 4e6],
    ] as const;
    const e = equilibriumError(c, [
      { n: 0, f: [0, -10, 0] },
      { n: 1, f: [0, -10, 0] },
      { n: 0, f: [0, 10, 0] },
      { n: 1, f: [0, 10, 0] },
    ]);
    expect(e).toBe(0);
  });

  it("equilibrio: fuerza sin equilibrar ⇒ e_F = 1; par sin equilibrar ⇒ e_M = 1", () => {
    expect(equilibriumError([[0, 0]], [{ n: 0, f: [1, 0, 0] }])).toBe(1);
    expect(equilibriumError([[0, 0]], [{ n: 0, f: [0, 0, 3] }])).toBe(1);
    // Par de fuerzas ±1 en X a cotas z = 0 y z = 2: brazo respecto al centroide (z = 1) ⇒ M = −1·1 − 1·1 = −2;
    // D_M = 2 ⇒ e_M = 1.
    expect(
      equilibriumError(
        [
          [0, 0],
          [0, 2],
        ],
        [
          { n: 0, f: [1, 0, 0] },
          { n: 1, f: [-1, 0, 0] },
        ],
      ),
    ).toBe(1);
  });

  it("equilibrio: D_M = 0 usa L_ref·ΣF", () => {
    expect(
      equilibriumError(
        [
          [0, 0],
          [4, 0],
        ],
        [
          { n: 0, f: [1, 0, 0] },
          { n: 1, f: [-1, 0, 0] },
        ],
      ),
    ).toBe(0);
    expect(equilibriumError([[0, 0]], [])).toBe(0);
  });

  it("formatos y validación previa de propiedades", () => {
    expect(fmtValue(45.00000000001)).toBe("45");
    expect(fmtValue(1 / 3)).toBe("0.333333");
    expect(fmtRatio(1.5e-10)).toBe("1.50e-10");
    expect(fmtRatio(NaN)).toBe("NaN");
    expect(propertyErrors(null)).toEqual([]);
    expect(propertyErrors({ members: "no es una lista" })).toEqual([]);
    expect(
      propertyErrors({
        materials: [{ id: "M", E: -1 }, 3],
        sections: [{ id: "S", A: 0, Iy: Number.NaN }],
        members: [{ id: "B1", material: "M", section: "S" }, "x", { id: "B2", material: "?", section: "?" }],
      }),
    ).toEqual(["Barra B1: E debe ser > 0", "Barra B1: A debe ser > 0", "Barra B1: Iy debe ser > 0"]);
  });
});
