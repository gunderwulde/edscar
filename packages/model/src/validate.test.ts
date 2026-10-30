import { describe, expect, it } from "vitest";
import example from "../examples/viga-biapoyada.edscar.json";
import type { Load, Project } from "./index";
import { validateProject } from "./validate";

const base = (): Project => structuredClone(example) as unknown as Project;

/** Devuelve los códigos de error de un proyecto (vacío si es válido). */
const codes = (p: unknown): string[] => {
  const r = validateProject(p);
  return r.ok ? [] : r.errors.map((e) => `${e.code}@${e.path}`);
};
const has = (p: unknown, code: string, path?: string): boolean =>
  codes(p).some((c) => (path === undefined ? c.startsWith(`${code}@`) : c === `${code}@${path}`));

const first = <T extends object>(a: readonly T[]): T => {
  const x = a[0];
  if (!x) throw new Error("colección vacía");
  return x;
};

const withLoad = (load: Load, mut?: (p: Project) => void): Project => {
  const p = base();
  p.loads = [load];
  mut?.(p);
  return p;
};
const uniform = (over: Record<string, unknown> = {}): Load =>
  ({ id: "L1", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, -10], frame: "global", ...over });

describe("proyecto de ejemplo", () => {
  it("valida y devuelve el proyecto", () => {
    const r = validateProject(example);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.nodes).toHaveLength(2);
      expect(r.project.analysis).toBe("2D-XZ");
    }
  });
  it("es la viga E1 del ADR-001: L = 6 m, w = 10 kN/m hacia abajo", () => {
    const p = base();
    const [a, b] = p.nodes;
    expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), 0, 0)).toBe(6);
    const l = p.loads[0];
    expect(l?.type === "member-uniform" && l.w[2]).toBe(-10);
  });
});

describe("esquema (estructura)", () => {
  it("rechaza no-objetos y campos desconocidos con ruta", () => {
    expect(codes(42)).toEqual(["schema@"]);
    const p = { ...base(), extra: 1 };
    expect(has(p, "schema")).toBe(true);
  });
  it("informa la ruta del campo erróneo", () => {
    const p = base();
    p.nodes = [{ id: "A", x: Number.NaN, y: 0, z: 0 }, ...p.nodes.slice(1)];
    expect(has(p, "schema", "nodes[0].x")).toBe(true);
  });
  it("rechaza ids vacíos, valores físicos no positivos y enums inválidos", () => {
    const p = base();
    p.materials = [{ id: "", name: "m", E: 0, G: 1, density: -1, alpha: 0 }];
    expect(codes(p).length).toBeGreaterThanOrEqual(3);
    const q = { ...base(), analysis: "2D" };
    expect(has(q, "schema", "analysis")).toBe(true);
  });
  it("acepta releases parciales y rotation", () => {
    const p = base();
    p.members = [{ id: "E1", i: "A", j: "B", material: "M1", section: "S1", releases: { i: { ry: true }, j: {} }, rotation: Math.PI }];
    expect(validateProject(p).ok).toBe(true);
  });
  it("rechaza una variante de carga desconocida", () => {
    expect(has(withLoad({ id: "L1", pattern: "G", type: "magic" } as unknown as Load), "schema")).toBe(true);
  });
});

describe("schemaVersion", () => {
  it("válido: versión actual", () => {
    expect(validateProject(base()).ok).toBe(true);
  });
  it("inválido: otra versión pide migrar", () => {
    expect(has({ ...base(), schemaVersion: 0 }, "schema-version", "schemaVersion")).toBe(true);
  });
});

describe("ids únicos", () => {
  it("válido: ids repetidos entre colecciones distintas", () => {
    const p = base();
    p.patterns = [{ id: "A", name: "x", kind: "D", selfWeightFactor: 0 }];
    p.cases = [{ id: "A", name: "c", type: "static-linear", terms: [{ pattern: "A", factor: 1 }] }];
    p.loads = [];
    p.combinations = [];
    expect(validateProject(p).ok).toBe(true);
  });
  it.each([
    ["nodes", (p: Project) => { p.nodes.push({ ...first(p.nodes), x: 1 }); }],
    ["members", (p: Project) => { p.members.push({ ...first(p.members) }); }],
    ["materials", (p: Project) => { p.materials.push({ ...first(p.materials) }); }],
    ["sections", (p: Project) => { p.sections.push({ ...first(p.sections) }); }],
    ["supports", (p: Project) => { p.supports.push({ ...first(p.supports), node: "B" }); }],
    ["patterns", (p: Project) => { p.patterns.push({ ...first(p.patterns) }); }],
    ["loads", (p: Project) => { p.loads.push({ ...first(p.loads) }); }],
    ["cases", (p: Project) => { p.cases.push({ ...first(p.cases) }); }],
    ["combinations", (p: Project) => { p.combinations.push({ ...first(p.combinations) }); }],
  ])("inválido: id duplicado en %s", (name, mut) => {
    const p = base();
    mut(p);
    expect(codes(p).some((c) => c.startsWith("duplicate-id@") && c.includes(`${name}[`))).toBe(true);
  });
});

describe("referencias colgantes", () => {
  it("inválido: barra con nudo, material y sección inexistentes", () => {
    const p = base();
    p.members = [{ id: "E1", i: "X", j: "Y", material: "MX", section: "SX" }];
    for (const path of ["members[0].i", "members[0].j", "members[0].material", "members[0].section"]) {
      expect(has(p, "dangling-ref", path)).toBe(true);
    }
  });
  it("inválido: apoyo en nudo inexistente", () => {
    const p = base();
    p.supports = [{ id: "S", node: "Z", fixed: [true, true, true, true, true, true] }];
    expect(has(p, "dangling-ref", "supports[0].node")).toBe(true);
  });
  it("inválido: carga con patrón, nudo o barra inexistentes", () => {
    const n = withLoad({ id: "L", pattern: "P?", type: "nodal", node: "Z", f: [0, 0, 1], m: [0, 0, 0] });
    expect(has(n, "dangling-ref", "loads[0].pattern")).toBe(true);
    expect(has(n, "dangling-ref", "loads[0].node")).toBe(true);
    const d = withLoad({ id: "L", pattern: "G", type: "support-displacement", node: "Z", d: [0, 0, 0, 0, 0, 0] });
    expect(has(d, "dangling-ref", "loads[0].node")).toBe(true);
    const m = withLoad(uniform({ member: "Z" }));
    expect(has(m, "dangling-ref", "loads[0].member")).toBe(true);
  });
  it("válido: cargas con todas las referencias correctas", () => {
    expect(validateProject(withLoad({ id: "L", pattern: "G", type: "nodal", node: "A", f: [0, 0, 1], m: [0, 0, 0] })).ok).toBe(true);
  });
  it("inválido: caso con patrón inexistente", () => {
    const p = base();
    p.cases = [{ id: "C1", name: "c", type: "static-linear", terms: [{ pattern: "Q", factor: 1 }] }];
    expect(has(p, "dangling-ref", "cases[0].terms[0].pattern")).toBe(true);
  });
  it("inválido: combinación con caso y combinación inexistentes", () => {
    const p = base();
    p.combinations = [{
      id: "K1", name: "k", kind: "ULS",
      terms: [{ ref: "C9", refType: "case", factor: 1 }, { ref: "K9", refType: "combination", factor: 1 }],
    }];
    expect(has(p, "dangling-ref", "combinations[0].terms[0].ref")).toBe(true);
    expect(has(p, "dangling-ref", "combinations[0].terms[1].ref")).toBe(true);
  });
  it("válido: combinación que referencia otra combinación existente", () => {
    const p = base();
    p.combinations.push({ id: "K2", name: "k2", kind: "ULS", terms: [{ ref: "K1", refType: "combination", factor: 1.5 }] });
    expect(validateProject(p).ok).toBe(true);
  });
});

describe("barras", () => {
  it("inválido: nudos iguales", () => {
    const p = base();
    p.members = [{ id: "E1", i: "A", j: "A", material: "M1", section: "S1" }];
    expect(has(p, "member-degenerate", "members[0]")).toBe(true);
  });
  it("inválido: nudos distintos pero coincidentes (longitud 0)", () => {
    const p = base();
    p.nodes = [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 0, y: 0, z: 0 }];
    expect(has(p, "member-zero-length", "members[0]")).toBe(true);
  });
});

describe("posiciones de carga en barra (L = 6 m)", () => {
  it("válido: uniforme sin a/b, con a/b exactos y trapezoidal", () => {
    expect(validateProject(withLoad(uniform())).ok).toBe(true);
    expect(validateProject(withLoad(uniform({ a: 0, b: 6 }))).ok).toBe(true);
    expect(validateProject(withLoad(uniform({ a: 1 }))).ok).toBe(true);
    expect(validateProject(withLoad(uniform({ b: 2 }))).ok).toBe(true);
    const t = { id: "L", pattern: "G", type: "member-trapezoid", member: "E1", w1: [0, 0, 0], w2: [0, 0, -5], frame: "local", a: 1, b: 5 } as Load;
    expect(validateProject(withLoad(t)).ok).toBe(true);
  });
  it.each([
    ["a negativo", { a: -1 }],
    ["a = b", { a: 3, b: 3 }],
    ["a > b", { a: 4, b: 2 }],
    ["b > L", { b: 7 }],
    ["a >= L por defecto b = L", { a: 6 }],
  ])("inválido uniforme: %s", (_n, over) => {
    expect(has(withLoad(uniform(over)), "load-range", "loads[0]")).toBe(true);
  });
  it.each([
    ["a = b", 2, 2],
    ["b > L", 1, 6.5],
    ["a < 0", -0.5, 3],
  ])("inválido trapezoidal: %s", (_n, a, b) => {
    const t = { id: "L", pattern: "G", type: "member-trapezoid", member: "E1", w1: [0, 0, 0], w2: [0, 0, -5], frame: "local", a, b } as Load;
    expect(has(withLoad(t), "load-range", "loads[0]")).toBe(true);
  });
  it("con barra sin longitud conocida, se valida a < b sin L", () => {
    const p = withLoad(uniform({ member: "ZZ", a: 3, b: 2 }));
    expect(has(p, "load-range")).toBe(true);
    const q = withLoad(uniform({ member: "ZZ", a: 1, b: 2 }));
    expect(has(q, "load-range")).toBe(false);
    const r = withLoad(uniform({ member: "ZZ" }));
    expect(has(r, "load-range")).toBe(false);
    const t = { id: "L", pattern: "G", type: "member-trapezoid", member: "ZZ", w1: [0, 0, 0], w2: [0, 0, -5], frame: "local", a: 1, b: 2 } as Load;
    expect(has(withLoad(t), "load-range")).toBe(false);
  });
  it("member-point: relativo y absoluto", () => {
    const pt = (at: number, relative: boolean): Load =>
      ({ id: "L", pattern: "G", type: "member-point", member: "E1", p: [0, 0, -1], at, relative, frame: "global" });
    expect(validateProject(withLoad(pt(0.5, true))).ok).toBe(true);
    expect(validateProject(withLoad(pt(6, false))).ok).toBe(true);
    expect(has(withLoad(pt(1.5, true)), "load-range", "loads[0].at")).toBe(true);
    expect(has(withLoad(pt(-0.1, true)), "load-range", "loads[0].at")).toBe(true);
    expect(has(withLoad(pt(6.5, false)), "load-range", "loads[0].at")).toBe(true);
    expect(has(withLoad(pt(-1, false)), "load-range", "loads[0].at")).toBe(true);
    const unknown = { ...pt(2, false), member: "ZZ" } as Load;
    expect(has(withLoad(unknown), "load-range")).toBe(false);
    expect(has(withLoad({ ...unknown, at: -2 } as Load), "load-range")).toBe(true);
  });
});

describe("combinaciones sin ciclos", () => {
  const comb = (id: string, refs: string[]): Project["combinations"][number] => ({
    id, name: id, kind: "CUSTOM", terms: refs.map((ref) => ({ ref, refType: "combination" as const, factor: 1 })),
  });
  it("válido: cadena y rombo (DAG)", () => {
    const p = base();
    p.combinations = [comb("K1", ["K2", "K3"]), comb("K2", ["K4"]), comb("K3", ["K4"]), comb("K4", [])];
    expect(validateProject(p).ok).toBe(true);
  });
  it("inválido: autorreferencia", () => {
    const p = base();
    p.combinations = [comb("K1", ["K1"])];
    expect(has(p, "combination-cycle", "combinations[0].terms[0].ref")).toBe(true);
  });
  it("inválido: ciclo de tres, con ruta en el mensaje", () => {
    const p = base();
    p.combinations = [comb("K1", ["K2"]), comb("K2", ["K3"]), comb("K3", ["K1"])];
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.code === "combination-cycle");
      expect(e?.message).toContain("K1 -> K2 -> K3 -> K1");
    }
  });
});

describe("un solo Support por nudo", () => {
  it("válido: un apoyo por nudo", () => {
    expect(validateProject(base()).ok).toBe(true);
  });
  it("inválido: dos apoyos en el mismo nudo", () => {
    const p = base();
    p.supports.push({ id: "SA2", node: "A", fixed: [true, true, true, true, true, true] });
    expect(has(p, "duplicate-support", "supports[2].node")).toBe(true);
  });
});

describe("support-displacement solo en GDL restringidos", () => {
  const sd = (node: string, d: [number, number, number, number, number, number]): Load =>
    ({ id: "L", pattern: "G", type: "support-displacement", node, d });
  it("válido: no nulo en GDL restringido (uz de A) y nulo en los libres", () => {
    expect(validateProject(withLoad(sd("A", [0, 0, -0.01, 0, 0, 0]))).ok).toBe(true);
  });
  it("inválido: no nulo en GDL libre (rotación en y de A)", () => {
    expect(has(withLoad(sd("A", [0, 0, 0, 0, 0.001, 0])), "displacement-free-dof", "loads[0].d[4]")).toBe(true);
  });
  it("inválido: nudo sin apoyo", () => {
    const p = withLoad(sd("B", [0.01, 0, 0, 0, 0, 0])); // ux libre en B
    expect(has(p, "displacement-free-dof", "loads[0].d[0]")).toBe(true);
    const q = withLoad(sd("A", [0, 0, 0, 0, 0, 0]), (x) => { x.supports = []; });
    expect(validateProject(q).ok).toBe(true);
    const r = withLoad(sd("A", [0, 0, 1, 0, 0, 0]), (x) => { x.supports = []; });
    expect(has(r, "displacement-free-dof")).toBe(true);
  });
  it("2D-XZ: uy/rx/rz no nulos son error aunque estén restringidos", () => {
    const p = withLoad(sd("A", [0, 0.01, 0, 0, 0, 0]));
    expect(has(p, "2d-out-of-plane", "loads[0].d[1]")).toBe(true);
    const q = withLoad(sd("A", [0, 0, 0, 0, 0, 0.01]), (x) => { x.supports = [{ id: "S", node: "A", fixed: [true, true, true, true, true, true] }]; });
    expect(has(q, "2d-out-of-plane", "loads[0].d[5]")).toBe(true);
  });
  it("3D: uy restringido admite desplazamiento", () => {
    const p = withLoad(sd("A", [0, 0.01, 0, 0, 0, 0]), (x) => { x.analysis = "3D"; });
    expect(validateProject(p).ok).toBe(true);
  });
});

describe("reglas 2D-XZ (ADR-001 §2.1)", () => {
  const to3D = (p: Project): Project => ({ ...p, analysis: "3D" });

  it("nudos con y = 0: válido en tolerancia, inválido fuera; 3D lo permite", () => {
    const p = base();
    p.nodes = [{ id: "A", x: 0, y: 5e-10, z: 0 }, { id: "B", x: 6, y: 0, z: 0 }];
    expect(validateProject(p).ok).toBe(true);
    p.nodes = [{ id: "A", x: 0, y: 0.1, z: 0 }, { id: "B", x: 6, y: 0, z: 0 }];
    expect(has(p, "2d-out-of-plane", "nodes[0].y")).toBe(true);
    expect(validateProject(to3D(p)).ok).toBe(true);
  });

  it("rotation en {0, π} mod 2π", () => {
    const rot = (r: number): Project => {
      const p = base();
      p.members = [{ id: "E1", i: "A", j: "B", material: "M1", section: "S1", rotation: r }];
      return p;
    };
    for (const r of [0, Math.PI, -Math.PI, 2 * Math.PI, 3 * Math.PI, 2 * Math.PI - 1e-12]) {
      expect(validateProject(rot(r)).ok).toBe(true);
    }
    expect(has(rot(Math.PI / 2), "2d-rotation", "members[0].rotation")).toBe(true);
    expect(has(rot(0.01), "2d-rotation")).toBe(true);
    expect(validateProject(to3D(rot(Math.PI / 2))).ok).toBe(true);
  });

  it("peso propio y gravity[1]", () => {
    const p = base();
    p.settings = { gravity: [0, 1, -9.81] };
    expect(validateProject(p).ok).toBe(true); // selfWeightFactor = 0: no hay peso propio
    p.patterns = [{ id: "G", name: "g", kind: "D", selfWeightFactor: 1 }];
    expect(has(p, "2d-gravity", "settings.gravity")).toBe(true);
    p.settings = { gravity: [0, 0, -9.81] };
    expect(validateProject(p).ok).toBe(true);
    p.settings = { gravity: [0, 1, -9.81] };
    expect(validateProject(to3D(p)).ok).toBe(true);
  });

  it("cargas nodales fuera de plano", () => {
    const n = (f: [number, number, number], m: [number, number, number]): Project =>
      withLoad({ id: "L", pattern: "G", type: "nodal", node: "A", f, m });
    expect(validateProject(n([1, 0, 1], [0, 3, 0])).ok).toBe(true);
    expect(has(n([0, 1, 0], [0, 0, 0]), "2d-out-of-plane", "loads[0].f")).toBe(true);
    expect(has(n([0, 0, 0], [1, 0, 0]), "2d-out-of-plane", "loads[0].m")).toBe(true);
    expect(has(n([0, 0, 0], [0, 0, 1]), "2d-out-of-plane", "loads[0].m")).toBe(true);
    expect(validateProject(to3D(n([0, 1, 0], [1, 0, 1]))).ok).toBe(true);
  });

  it("cargas distribuidas con componente Y, en ambos marcos", () => {
    for (const frame of ["global", "local"]) {
      expect(has(withLoad(uniform({ frame, w: [0, 2, 0] })), "2d-out-of-plane", "loads[0].w")).toBe(true);
    }
    expect(validateProject(withLoad(uniform({ w: [1, 0, -1] }))).ok).toBe(true);
    const t = (w1: number[], w2: number[]): Load =>
      ({ id: "L", pattern: "G", type: "member-trapezoid", member: "E1", w1, w2, frame: "local", a: 1, b: 2 }) as unknown as Load;
    expect(validateProject(withLoad(t([0, 0, 1], [0, 0, 2]))).ok).toBe(true);
    expect(has(withLoad(t([0, 1, 0], [0, 0, 0])), "2d-out-of-plane", "loads[0].w1")).toBe(true);
    expect(has(withLoad(t([0, 0, 0], [0, 1, 0])), "2d-out-of-plane", "loads[0].w1")).toBe(true);
    expect(validateProject(to3D(withLoad(uniform({ w: [0, 2, 0] })))).ok).toBe(true);
  });

  it("cargas puntuales de barra: p[1] y momentos, global y local", () => {
    const pt = (p: number[], m: number[] | undefined, frame: string): Project =>
      withLoad({ id: "L", pattern: "G", type: "member-point", member: "E1", p, ...(m ? { m } : {}), at: 0.5, relative: true, frame } as unknown as Load);
    expect(validateProject(pt([1, 0, 1], undefined, "global")).ok).toBe(true);
    expect(validateProject(pt([1, 0, 1], [0, 2, 0], "local")).ok).toBe(true);
    expect(has(pt([0, 1, 0], undefined, "local"), "2d-out-of-plane", "loads[0].p")).toBe(true);
    for (const frame of ["global", "local"]) {
      expect(has(pt([0, 0, 1], [1, 0, 0], frame), "2d-out-of-plane", "loads[0].m")).toBe(true);
      expect(has(pt([0, 0, 1], [0, 0, 1], frame), "2d-out-of-plane", "loads[0].m")).toBe(true);
    }
    expect(validateProject(to3D(pt([0, 1, 0], [1, 0, 1], "global"))).ok).toBe(true);
  });

  it("térmica con gradientY", () => {
    const th = (extra: Record<string, number>): Project =>
      withLoad({ id: "L", pattern: "G", type: "thermal", member: "E1", dT: 10, ...extra });
    expect(validateProject(th({ gradientZ: 5 })).ok).toBe(true);
    expect(validateProject(th({ gradientY: 0 })).ok).toBe(true);
    expect(has(th({ gradientY: 5 }), "2d-out-of-plane", "loads[0].gradientY")).toBe(true);
    expect(validateProject(to3D(th({ gradientY: 5 }))).ok).toBe(true);
  });
});
