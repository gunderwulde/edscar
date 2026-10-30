/**
 * Deformada en ejes globales (`SolveResult.deflections`, ADR-006 §3). Esperados derivados a mano de las
 * soluciones clásicas de Euler-Bernoulli (elástica de la biapoyada, de la ménsula, superposición, simetría);
 * nunca tomados de la salida del código.
 */
import { describe, expect, it } from "vitest";
import type { Load, Member, Project, Support } from "@edscar/model";
import { createSolver } from "./index";
import type { DeflectionStation, SolveResult } from "./index";
import { emptyLoads } from "./element2d";
import { deflectionGrid, DEFLECTION_SEGMENTS, stationGrid } from "./sections";

type Fixed6 = Support["fixed"];
const PIN: Fixed6 = [true, false, true, false, false, false];
const ROLLER: Fixed6 = [false, false, true, false, false, false];
const FIXED: Fixed6 = [true, false, true, false, true, false];

const E = 2e8;
const A = 0.01;
const I = 1e-4;
const EI = E * I;
const EA = E * A;
const ALPHA = 1.2e-5;

function project(
  nodes: [string, number, number][],
  members: (Member | [string, string, string])[],
  supports: [string, Fixed6][],
  loads: Load[],
): Project {
  return {
    schemaVersion: 1,
    units: "SI",
    analysis: "2D-XZ",
    nodes: nodes.map(([id, x, z]) => ({ id, x, y: 0, z })),
    members: members.map((m) => (Array.isArray(m) ? { id: m[0], i: m[1], j: m[2], material: "M", section: "S" } : m)),
    materials: [{ id: "M", name: "Acero", E, G: 8e7, density: 0, alpha: ALPHA }],
    sections: [{ id: "S", name: "Sección", A, Iy: I, Iz: 1e-4, J: 1e-6 }],
    supports: supports.map(([node, fixed], k) => ({ id: `S${String(k)}`, node, fixed })),
    patterns: [{ id: "G", name: "G", kind: "D", selfWeightFactor: 0 }],
    loads,
    cases: [{ id: "C1", name: "C1", type: "static-linear", terms: [{ pattern: "G", factor: 1 }] }],
    combinations: [],
    settings: { gravity: [0, 0, -9.81] },
  };
}

const solve = (p: Project): SolveResult => {
  const r = createSolver().solve({ project: p, caseId: "C1" });
  expect(r.message).toBeUndefined();
  expect(r.status).toBe("ok");
  return r;
};

const defl = (r: SolveResult, member: string): DeflectionStation[] => {
  const d = r.deflections?.[member];
  if (!d) throw new Error(`Sin deformada para ${member}`);
  return d;
};

/** Comparación con error relativo < tol respecto a la escala `ref` (para valores que pueden ser 0). */
const near = (got: number | undefined, exp: number, ref: number, tol = 1e-9): void => {
  expect(Math.abs((got ?? NaN) - exp) / Math.abs(ref)).toBeLessThan(tol);
};

/** Abscisas estrictamente crecientes con 0 y L exactos. */
function checkGrid(d: DeflectionStation[], L: number): void {
  expect(d[0]?.x).toBe(0);
  expect(d[d.length - 1]?.x).toBe(L);
  for (let k = 1; k < d.length; k++) expect(at(d, k).x).toBeGreaterThan(at(d, k - 1).x);
  for (const s of d) expect(s.d[1]).toBe(0);
}

const at = (d: DeflectionStation[], k: number): DeflectionStation => {
  const s = d[k];
  if (!s) throw new Error(`Sin estación ${String(k)}`);
  return s;
};
const stationX = (d: DeflectionStation[], x: number): DeflectionStation => {
  const s = d.find((q) => Math.abs(q.x - x) < 1e-12);
  if (!s) throw new Error(`Sin estación en x=${String(x)}`);
  return s;
};

describe("malla de la deformada", () => {
  it("21 estaciones base + cargas puntuales, superconjunto de la malla de esfuerzos", () => {
    const L = 6;
    const loads = emptyLoads();
    expect(deflectionGrid(L, loads)).toHaveLength(DEFLECTION_SEGMENTS + 1);
    loads.forces.push({ a: 1.45, px: 0, pz: -1 });
    const xs = deflectionGrid(L, loads);
    expect(xs).toHaveLength(22);
    expect(xs).toContain(1.45);
    for (const p of stationGrid(L, loads)) expect(xs).toContain(p.x);
  });

  it("extremos exactos aunque una carga puntual esté a < 1e-9·L de un extremo", () => {
    const L = 3;
    const loads = emptyLoads();
    loads.forces.push({ a: L * (1 - 1e-12), px: 0, pz: -1 }, { a: 1e-12, px: 0, pz: -1 });
    const xs = deflectionGrid(L, loads);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(L);
    expect(xs).toHaveLength(DEFLECTION_SEGMENTS + 1);
  });
});

describe("viga biapoyada (L = 6)", () => {
  const L = 6;
  const w = 10;
  const nodes: [string, number, number][] = [
    ["A", 0, 0],
    ["B", L, 0],
  ];
  const sup: [string, Fixed6][] = [
    ["A", PIN],
    ["B", ROLLER],
  ];

  it("uniforme: δ(L/2) = 5wL⁴/(384EI) y elástica w(x) = −w·x·(L³ − 2Lx² + x³)/(24EI) en toda la barra", () => {
    const r = solve(project(nodes, [["M1", "A", "B"]], sup, [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -w], frame: "global" }]));
    const d = defl(r, "M1");
    checkGrid(d, L);
    expect(d).toHaveLength(21);
    const dMax = (5 * w * L ** 4) / (384 * EI);
    near(stationX(d, L / 2).d[2], -dMax, dMax, 1e-12);
    for (const s of d) {
      const x = s.x;
      near(s.d[2], (-w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI), dMax);
      expect(Math.abs(s.d[0])).toBeLessThan(1e-15);
    }
    // Misma malla que los esfuerzos: toda abscisa de `stations` está en la deformada.
    for (const st of r.members[0]?.stations ?? []) stationX(d, st.x);
  });

  it("triangular 0 → w0: δ(L/2) = 5·w0·L⁴/(768EI) (mitad de la uniforme por simetría y superposición)", () => {
    const w0 = 12;
    const r = solve(
      project(nodes, [["M1", "A", "B"]], sup, [
        { id: "t", pattern: "G", type: "member-trapezoid", member: "M1", a: 0, b: L, w1: [0, 0, 0], w2: [0, 0, -w0], frame: "global" },
      ]),
    );
    const exp = (5 * w0 * L ** 4) / (768 * EI);
    near(stationX(defl(r, "M1"), L / 2).d[2], -exp, exp, 1e-12);
  });

  it("puntual P en a = 2: w(x) = −P·b·x·(L² − b² − x²)/(6·L·EI) para x ≤ a", () => {
    const P = 15;
    const a = 2;
    const b = L - a;
    const r = solve(project(nodes, [["M1", "A", "B"]], sup, [{ id: "p", pattern: "G", type: "member-point", member: "M1", at: a, relative: false, p: [0, 0, -P], frame: "global" }]));
    const d = defl(r, "M1");
    const ref = (P * b * a * (L * L - b * b - a * a)) / (6 * L * EI);
    for (const s of d.filter((q) => q.x <= a)) {
      near(s.d[2], (-P * b * s.x * (L * L - b * b - s.x * s.x)) / (6 * L * EI), ref);
    }
    near(stationX(d, a).d[2], -ref, ref, 1e-12);
  });
});

describe("ménsula horizontal (L = 4, empotrada en A)", () => {
  const L = 4;
  const P = 20;
  const nodes: [string, number, number][] = [
    ["A", 0, 0],
    ["B", L, 0],
  ];

  it("P nodal en la punta: δ = PL³/(3EI) y perfil w(x) = −P·x²·(3L − x)/(6EI); extremos = desplazamientos nodales", () => {
    const r = solve(project(nodes, [["M1", "A", "B"]], [["A", FIXED]], [{ id: "P", pattern: "G", type: "nodal", node: "B", f: [0, 0, -P], m: [0, 0, 0] }]));
    const d = defl(r, "M1");
    checkGrid(d, L);
    const tip = (P * L ** 3) / (3 * EI);
    near(at(d, d.length - 1).d[2], -tip, tip, 1e-12);
    for (const s of d) near(s.d[2], (-P * s.x * s.x * (3 * L - s.x)) / (6 * EI), tip);
    expect(at(d, 0).d).toEqual([0, 0, 0]);
    near(at(d, d.length - 1).d[2], r.displacements.B?.[2] ?? NaN, tip, 1e-14);
  });

  it("P de barra en a = 1.5: w = −P·x²·(3a − x)/(6EI) (x ≤ a), −P·a²·(3x − a)/(6EI) (x ≥ a)", () => {
    const a = 1.5;
    const r = solve(project(nodes, [["M1", "A", "B"]], [["A", FIXED]], [{ id: "p", pattern: "G", type: "member-point", member: "M1", at: a, relative: false, p: [0, 0, -P], frame: "global" }]));
    const d = defl(r, "M1");
    expect(d).toHaveLength(22);
    const ref = (P * a * a * (3 * L - a)) / (6 * EI);
    for (const s of d) {
      const x = s.x;
      const exp = x <= a ? (-P * x * x * (3 * a - x)) / (6 * EI) : (-P * a * a * (3 * x - a)) / (6 * EI);
      near(s.d[2], exp, ref);
    }
  });

  it("térmica libre (dT = 10, gz = 30): u = α·dT·x, w = −α·gz·x²/2", () => {
    const r = solve(project(nodes, [["M1", "A", "B"]], [["A", FIXED]], [{ id: "t", pattern: "G", type: "thermal", member: "M1", dT: 10, gradientZ: 30 }]));
    const d = defl(r, "M1");
    for (const s of d) {
      near(s.d[0], ALPHA * 10 * s.x, ALPHA * 10 * L);
      near(s.d[2], (-ALPHA * 30 * s.x * s.x) / 2, (ALPHA * 30 * L * L) / 2);
    }
  });

  it("térmica en biempotrada: sin deformada (desplazamientos de extremo nulos y sin cargas de vano)", () => {
    const r = solve(
      project(nodes, [["M1", "A", "B"]], [
        ["A", FIXED],
        ["B", FIXED],
      ], [{ id: "t", pattern: "G", type: "thermal", member: "M1", dT: 25, gradientZ: 40 }]),
    );
    for (const s of defl(r, "M1")) expect(s.d).toEqual([0, 0, 0]);
  });
});

describe("conversión local → global", () => {
  // Barra de (0, 0) a (3, 4), L = 5: x̂ = (0.6, 0, 0.8); ẑ = Z − 0.8·x̂ normalizado = (−0.8, 0, 0.6).
  // d = u·x̂ + w·ẑ ⇒ ux = 0.6u − 0.8w, uz = 0.8u + 0.6w.
  const L = 5;
  const P = 10;
  const toG = (u: number, w: number): [number, number] => [0.6 * u - 0.8 * w, 0.8 * u + 0.6 * w];

  for (const reversed of [false, true]) {
    it(`inclinada${reversed ? " (definida de j a i)" : ""}: P = −Z en la punta ⇒ axil −0.8P, transversal −0.6P`, () => {
      const nodes: [string, number, number][] = [
        ["A", 0, 0],
        ["B", 3, 4],
      ];
      const r = solve(
        project(nodes, [reversed ? ["M1", "B", "A"] : ["M1", "A", "B"]], [["A", FIXED]], [
          { id: "P", pattern: "G", type: "nodal", node: "B", f: [0, 0, -P], m: [0, 0, 0] },
        ]),
      );
      const d = defl(r, "M1");
      checkGrid(d, L);
      const ref = (0.6 * P * L ** 3) / (3 * EI);
      for (const s of d) {
        const t = reversed ? L - s.x : s.x; // distancia al empotramiento
        const u = (-0.8 * P * t) / EA;
        const w = (-0.6 * P * t * t * (3 * L - t)) / (6 * EI);
        const [ux, uz] = toG(u, w);
        near(s.d[0], ux, ref);
        near(s.d[2], uz, ref);
      }
      const tipStation = reversed ? at(d, 0) : at(d, d.length - 1);
      near(tipStation.d[0], r.displacements.B?.[0] ?? NaN, ref, 1e-12);
      near(tipStation.d[2], r.displacements.B?.[2] ?? NaN, ref, 1e-12);
    });
  }

  it("inclinada con carga uniforme local perpendicular: w = −q·x²·(6L² − 4Lx + x²)/(24EI)", () => {
    const q = 4;
    const r = solve(
      project(
        [
          ["A", 0, 0],
          ["B", 3, 4],
        ],
        [["M1", "A", "B"]],
        [["A", FIXED]],
        [{ id: "q", pattern: "G", type: "member-uniform", member: "M1", w: [0, 0, -q], frame: "local" }],
      ),
    );
    const ref = (q * L ** 4) / (8 * EI);
    for (const s of defl(r, "M1")) {
      const w = (-q * s.x * s.x * (6 * L * L - 4 * L * s.x + s.x * s.x)) / (24 * EI);
      const [ux, uz] = toG(0, w);
      near(s.d[0], ux, ref);
      near(s.d[2], uz, ref);
    }
  });

  // Pilar vertical de altura h empotrado en la base, H = +X y V = −Z en cabeza. A la altura z:
  // ux = H·z²·(3h − z)/(6EI), uz = −V·z/EA. Subiendo (x̂ = +Z, ẑ = +X) o bajando (x̂ = −Z, ẑ = +X, ADR-001 §3):
  // el resultado global es el mismo aunque x̂ gire 180°.
  for (const up of [true, false]) {
    it(`vertical ${up ? "ascendente (i en la base)" : "descendente (i en la cabeza)"}: misma deformada global`, () => {
      const h = 3;
      const H = 5;
      const V = 50;
      const r = solve(
        project(
          [
            ["A", 0, 0],
            ["B", 0, h],
          ],
          [up ? ["P1", "A", "B"] : ["P1", "B", "A"]],
          [["A", FIXED]],
          [{ id: "HV", pattern: "G", type: "nodal", node: "B", f: [H, 0, -V], m: [0, 0, 0] }],
        ),
      );
      const d = defl(r, "P1");
      checkGrid(d, h);
      const ref = (H * h ** 3) / (3 * EI);
      for (const s of d) {
        const z = up ? s.x : h - s.x;
        near(s.d[0], (H * z * z * (3 * h - z)) / (6 * EI), ref);
        near(s.d[2], (-V * z) / EA, (V * h) / EA);
      }
    });
  }
});

describe("continuidad en nudos", () => {
  it("pórtico en L con carga de vano y articulación: traslaciones continuas en el nudo e iguales a las nodales", () => {
    const r = solve(
      project(
        [
          ["A", 0, 0],
          ["B", 0, 3],
          ["C", 4, 3],
          ["D", 8, 3],
        ],
        [
          ["P1", "A", "B"],
          ["V1", "B", "C"],
          { id: "V2", i: "C", j: "D", material: "M", section: "S", releases: { i: { ry: true } } },
        ],
        [
          ["A", FIXED],
          ["D", PIN],
        ],
        [
          { id: "q", pattern: "G", type: "member-uniform", member: "V1", w: [0, 0, -10], frame: "global" },
          { id: "p", pattern: "G", type: "member-point", member: "V2", at: 0.5, relative: true, p: [3, 0, -8], frame: "global" },
        ],
      ),
    );
    const first = (m: string): DeflectionStation => at(defl(r, m), 0);
    const last = (m: string): DeflectionStation => {
      const d = defl(r, m);
      return at(d, d.length - 1);
    };
    const node = (n: string): [number, number] => [r.displacements[n]?.[0] ?? NaN, r.displacements[n]?.[2] ?? NaN];
    const scale = Math.max(...Object.values(r.displacements).flatMap((u) => [Math.abs(u[0]), Math.abs(u[2])]));
    const same = (s: DeflectionStation, n: string): void => {
      const [ux, uz] = node(n);
      near(s.d[0], ux, scale, 1e-12);
      near(s.d[2], uz, scale, 1e-12);
    };
    same(first("P1"), "A");
    same(last("P1"), "B");
    same(first("V1"), "B");
    same(last("V1"), "C");
    same(first("V2"), "C"); // extremo articulado (ry): la traslación sigue siendo la del nudo
    same(last("V2"), "D");
    expect(Object.keys(r.deflections ?? {}).sort()).toEqual(["P1", "V1", "V2"]);
  });
});
