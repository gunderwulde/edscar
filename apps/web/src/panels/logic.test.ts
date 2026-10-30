// Lógica pura de los paneles: unidades, números, campos de carga, asignación, validación en vivo, resultados.
import { describe, expect, it } from "vitest";
import type { Load, Project } from "@edscar/model";
import { beamE1Project, createEditorStore, createEmptyProject } from "@edscar/ui-state";
import { rectangularSection } from "./catalog";
import { fixedFromFlags, isReleased, releaseChange, supportChoice, supportFlags } from "./edits";
import { loadFields, loadTarget, loadTypeKey } from "./loadFields";
import { DEFAULT_SPEC, planAssign, type AssignSpec } from "./loadAssign";
import { flattenCombination, parseSolverMessage, projectWithCombination } from "./results";
import { formatPlain, fromDisplay, parseNumber, toDisplay, unitLabel, type Quantity } from "./units";
import { connectedGroups, describeErrors, liveChecks } from "./validation";
import { translate } from "./i18n";
import { es } from "./dict.es";
import { en } from "./dict.en";

describe("unidades", () => {
  const quantities: Quantity[] = ["length", "smallLength", "force", "moment", "distributed", "modulus", "area", "inertia", "density", "alpha", "tempDelta", "gradient", "angle", "factor"];
  it("ida y vuelta SI -> presentación -> SI para todas las magnitudes y sistemas", () => {
    for (const q of quantities) {
      for (const sys of ["SI", "imperial"] as const) {
        expect(fromDisplay(q, toDisplay(q, 3.7, sys), sys)).toBeCloseTo(3.7, 9);
      }
    }
  });
  it("factores conocidos", () => {
    expect(toDisplay("length", 0.3048, "imperial")).toBeCloseTo(1, 12);
    expect(toDisplay("force", 4.4482216152605, "imperial")).toBeCloseTo(1, 12);
    expect(toDisplay("moment", 1.3558179483314004, "imperial")).toBeCloseTo(1, 9);
    expect(toDisplay("distributed", 14.593903, "imperial")).toBeCloseTo(1, 5);
    expect(toDisplay("modulus", 210e6, "SI")).toBeCloseTo(210000, 6); // 210 GPa = 210000 MPa
    expect(toDisplay("angle", Math.PI, "SI")).toBeCloseTo(180, 9);
    expect(toDisplay("area", 28.5e-4, "SI")).toBeCloseTo(28.5, 9);
    expect(unitLabel("force", "imperial")).toBe("kip");
    expect(unitLabel("force", "SI")).toBe("kN");
  });
  it("parseNumber admite coma decimal y rechaza basura", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber(" -2.5e3 ")).toBe(-2500);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
    expect(parseNumber("1e999")).toBeNull();
  });
  it("formatPlain recorta cifras y usa exponencial en extremos", () => {
    expect(formatPlain(0)).toBe("0");
    expect(formatPlain(1 / 3)).toBe("0.333333");
    expect(formatPlain(210000)).toBe("210000");
    expect(formatPlain(1.2e-5)).toBe("1.2e-5");
    expect(formatPlain(1e-6)).toBe("1e-6");
    expect(formatPlain(0.0005)).toBe("0.0005");
    expect(formatPlain(Number.NaN)).toBe("");
  });
});

describe("diccionarios i18n", () => {
  it("ES y EN tienen las mismas claves y no hay valores vacíos", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const v of [...Object.values(es), ...Object.values(en)]) expect(v.length).toBeGreaterThan(0);
  });
  it("sustituye parámetros y deja intactos los desconocidos", () => {
    expect(translate("es", "common.deleteItem", { id: "B1" })).toBe("Borrar B1");
    expect(translate("en", "common.deleteItem", { id: "B1" })).toBe("Delete B1");
    expect(translate("en", "common.deleteItem", {})).toBe("Delete {id}");
  });
  it("los parámetros de cada clave coinciden entre idiomas", () => {
    const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
    for (const k of Object.keys(es) as (keyof typeof es)[]) expect(params(en[k])).toEqual(params(es[k]));
  });
});

function porticoLike(): Project {
  const store = createEditorStore({ storage: null, project: beamE1Project() });
  return store.getState().project;
}

describe("campos de carga", () => {
  const base = { id: "L", pattern: "G" };
  it("cada variante expone sus campos y los cambios son parches válidos", () => {
    const cases: Load[] = [
      { ...base, type: "nodal", node: "A", f: [1, 0, 2], m: [0, 3, 0] },
      { ...base, type: "member-uniform", member: "E1", w: [0, 0, -5], frame: "global", a: 1 },
      { ...base, type: "member-trapezoid", member: "E1", w1: [0, 0, -1], w2: [0, 0, -3], frame: "local", a: 0, b: 6 },
      { ...base, type: "member-point", member: "E1", p: [0, 0, -4], at: 0.5, relative: true, frame: "global" },
      { ...base, type: "thermal", member: "E1", dT: 20 },
      { ...base, type: "support-displacement", node: "A", d: [0, 0, -0.01, 0, 0, 0] },
    ];
    for (const l of cases) {
      const fields = loadFields(l, "2D-XZ");
      expect(fields.length).toBeGreaterThan(1);
      expect(loadFields(l, "3D").length).toBeGreaterThanOrEqual(fields.length);
      for (const f of fields) {
        if (f.kind === "number") expect(f.apply(f.value).patch).toBeDefined();
      }
    }
  });
  it("los componentes se editan sin tocar los demás y las opcionales se eliminan con null", () => {
    const l: Load = { ...base, type: "member-uniform", member: "E1", w: [1, 0, -5], frame: "global", a: 1 };
    const wz = loadFields(l, "2D-XZ").find((f) => f.id === "w2");
    if (wz?.kind !== "number") throw new Error("falta wz");
    expect(wz.apply(-7).patch).toEqual({ w: [1, 0, -7] });
    const a = loadFields(l, "2D-XZ").find((f) => f.id === "a");
    if (a?.kind !== "number") throw new Error("falta a");
    expect(a.optional).toBe(true);
    expect(a.apply(null)).toEqual({ patch: {}, unset: ["a"] });
  });
  it("momento puntual, destino y tipos", () => {
    const m: Load = { ...base, type: "member-point", member: "E1", p: [0, 0, 0], m: [0, 5, 0], at: 1, relative: false, frame: "local" };
    expect(loadTypeKey(m)).toBe("load.type.moment");
    expect(loadTarget(m)).toEqual({ kind: "member", id: "E1" });
    const rel = loadFields(m, "2D-XZ").find((f) => f.id === "at");
    expect(rel?.kind === "number" && rel.quantity).toBe("length");
    const n: Load = { ...base, type: "nodal", node: "B", f: [0, 0, 0], m: [0, 0, 0] };
    expect(loadTarget(n)).toEqual({ kind: "node", id: "B" });
    expect(loadTypeKey(n)).toBe("load.type.nodal");
  });
});

describe("asignación de cargas (planAssign)", () => {
  const project = porticoLike();
  const sel = { nodes: [], members: ["E1"], loads: [] };

  it("añadir: un comando por elemento y ids sin colisión", () => {
    const store = createEditorStore({ storage: null, project: beamE1Project() });
    store.dispatch({ type: "node.add", payload: { item: { id: "C", x: 9, y: 0, z: 0 } } });
    store.dispatch({ type: "member.add", payload: { item: { id: "E2", i: "B", j: "C", material: "MAT1", section: "SEC1" } } });
    const p = store.getState().project;
    const plan = planAssign(p, { mode: "add", pattern: "G", spec: DEFAULT_SPEC, selection: { nodes: [], members: ["E1", "E2", "E2"], loads: [] } });
    expect(plan.ok && plan.added).toBe(2);
    if (!plan.ok) return;
    const before = store.getState().history.undoCount;
    store.beginGroup("x");
    for (const c of plan.commands) expect(store.dispatch(c).ok).toBe(true);
    store.endGroup();
    expect(store.getState().project.loads).toHaveLength(3);
    expect(new Set(store.getState().project.loads.map((l) => l.id)).size).toBe(3);
    expect(store.getState().history.undoCount).toBe(before + 1);
  });

  it("reemplazar quita las cargas del patrón en esos elementos y añade la nueva", () => {
    const store = createEditorStore({ storage: null, project });
    const spec: AssignSpec = { ...DEFAULT_SPEC, vz: -25 };
    const plan = planAssign(store.getState().project, { mode: "replace", pattern: "G", spec, selection: sel });
    expect(plan.ok && [plan.removed, plan.added]).toEqual([1, 1]);
    if (!plan.ok) return;
    store.beginGroup("r");
    for (const c of plan.commands) store.dispatch(c);
    store.endGroup();
    const loads = store.getState().project.loads;
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ type: "member-uniform", w: [0, 0, -25] });
    expect(store.undo()).toBe(true);
    expect(store.getState().project.loads[0]).toMatchObject({ w: [0, 0, -10] });
  });

  it("eliminar respeta patrón y filtro de tipo", () => {
    const none = planAssign(project, { mode: "remove", pattern: "G", spec: DEFAULT_SPEC, selection: sel, removeFilter: "member-point" });
    expect(none).toEqual({ ok: false, error: "nothing-to-remove" });
    const all = planAssign(project, { mode: "remove", pattern: "G", spec: DEFAULT_SPEC, selection: sel });
    expect(all.ok && all.removed).toBe(1);
  });

  it("construye todas las variantes y valida entradas", () => {
    const kinds: AssignSpec["kind"][] = ["member-uniform", "member-trapezoid", "member-point", "member-moment", "thermal"];
    for (const kind of kinds) {
      const plan = planAssign(project, { mode: "add", pattern: "G", spec: { ...DEFAULT_SPEC, kind }, selection: sel });
      expect(plan.ok).toBe(true);
    }
    const nodal = planAssign(project, { mode: "add", pattern: "G", spec: { ...DEFAULT_SPEC, kind: "nodal", vx: 5 }, selection: { nodes: ["A"], members: [], loads: [] } });
    expect(nodal.ok && nodal.commands).toHaveLength(1);
    const disp = planAssign(project, { mode: "add", pattern: "G", spec: { ...DEFAULT_SPEC, kind: "support-displacement", vz: -0.01 }, selection: { nodes: ["A"], members: [], loads: [] } });
    expect(disp.ok).toBe(true);
    expect(planAssign(project, { mode: "add", pattern: null, spec: DEFAULT_SPEC, selection: sel })).toEqual({ ok: false, error: "no-pattern" });
    expect(planAssign(project, { mode: "add", pattern: "G", spec: DEFAULT_SPEC, selection: { nodes: ["A"], members: [], loads: [] } })).toEqual({ ok: false, error: "no-targets" });
    expect(planAssign(project, { mode: "add", pattern: "G", spec: { ...DEFAULT_SPEC, a: 4, b: 2 }, selection: sel })).toEqual({ ok: false, error: "bad-range" });
    expect(planAssign(project, { mode: "add", pattern: "G", spec: { ...DEFAULT_SPEC, kind: "member-point", at: 1.5 }, selection: sel })).toEqual({ ok: false, error: "bad-position" });
    expect(planAssign(project, { mode: "remove", pattern: "G", spec: DEFAULT_SPEC, selection: { nodes: [], members: [], loads: [] } })).toEqual({ ok: false, error: "no-targets" });
  });

  it("un rango inválido llega al store como rechazo de validateProject sin cambiar nada", () => {
    const store = createEditorStore({ storage: null, project });
    const plan = planAssign(store.getState().project, { mode: "add", pattern: "G", spec: { ...DEFAULT_SPEC, a: 0, b: 99 }, selection: sel });
    if (!plan.ok) throw new Error("plan");
    const r = store.dispatch(plan.commands[0] ?? { type: "batch", payload: { commands: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(describeErrors(r.errors)).toMatch(/0 ≤ a < b ≤ L/);
    expect(store.getState().project.loads).toHaveLength(1);
  });
});

describe("validación en vivo", () => {
  const codes = (p: Project): string[] => liveChecks(p).map((c) => c.code);
  it("modelo vacío y solo nudos", () => {
    const p = createEmptyProject();
    expect(codes(p)).toEqual(["empty-model"]);
    expect(codes({ ...p, nodes: [{ id: "N1", x: 0, y: 0, z: 0 }] })).toContain("no-members");
  });
  it("mecanismo, sin apoyos y nudos sueltos", () => {
    const p = beamE1Project();
    expect(codes(p)).not.toContain("mechanism");
    const noSupports = { ...p, supports: [] };
    expect(codes(noSupports)).toContain("no-supports");
    const one = { ...p, supports: [{ id: "SA", node: "A", fixed: [true, true, true, false, false, false] as const }] };
    const checks = liveChecks(one);
    expect(checks.find((c) => c.code === "mechanism")?.params["dofs"]).toBe(2);
    const loose = { ...p, nodes: [...p.nodes, { id: "Z", x: 9, y: 0, z: 0 }] };
    const l = liveChecks(loose).find((c) => c.code === "loose-nodes");
    expect(l?.select?.nodes).toEqual(["Z"]);
  });
  it("patrones sin caso, casos y combinaciones vacíos", () => {
    const p = beamE1Project();
    expect(codes({ ...p, cases: [] })).toEqual(expect.arrayContaining(["pattern-unused", "no-cases"]));
    expect(codes({ ...p, cases: [{ id: "C1", name: "x", type: "static-linear", terms: [] }] })).toContain("case-empty");
    expect(codes({ ...p, cases: [{ id: "C1", name: "x", type: "static-linear", terms: [{ pattern: "G", factor: 0 }] }] })).toContain("case-zero");
    expect(codes({ ...p, combinations: [{ id: "U1", name: "u", kind: "ULS", terms: [] }] })).toContain("combination-empty");
    expect(codes({ ...p, patterns: [...p.patterns, { id: "Q", name: "q", kind: "L", selfWeightFactor: 0 }] })).toContain("pattern-empty");
    expect(codes({ ...p, patterns: [{ id: "G", name: "g", kind: "D", selfWeightFactor: 1 }] })).toContain("selfweight-no-density");
    expect(codes({ ...p, analysis: "3D" })).toContain("analysis-3d");
  });
  it("grupos conectados", () => {
    const p = beamE1Project();
    expect(connectedGroups(p)).toHaveLength(1);
    expect(describeErrors([])).toBe("");
    expect(describeErrors([{ path: "a", message: "x" }, { path: "b", message: "y" }])).toBe("x (+1)");
  });
});

describe("resultados", () => {
  it("aplana combinaciones (incluidas anidadas) y detecta ciclos y referencias rotas", () => {
    const base = beamE1Project();
    const project: Project = {
      ...base,
      patterns: [...base.patterns, { id: "Q", name: "q", kind: "L", selfWeightFactor: 0 }],
      cases: [
        { id: "C1", name: "g", type: "static-linear", terms: [{ pattern: "G", factor: 1 }] },
        { id: "C2", name: "q", type: "static-linear", terms: [{ pattern: "Q", factor: 2 }, { pattern: "G", factor: 0.5 }] },
      ],
      combinations: [
        { id: "U1", name: "a", kind: "ULS", terms: [{ ref: "C1", refType: "case", factor: 1.35 }, { ref: "C2", refType: "case", factor: 1.5 }] },
        { id: "U2", name: "b", kind: "CUSTOM", terms: [{ ref: "U1", refType: "combination", factor: 2 }] },
      ],
    };
    const f = flattenCombination(project, "U2");
    if (!f.ok) throw new Error(f.reason);
    const by = Object.fromEntries(f.terms.map((t) => [t.pattern, t.factor]));
    expect(by["G"]).toBeCloseTo(2 * (1.35 + 1.5 * 0.5), 12);
    expect(by["Q"]).toBeCloseTo(2 * 1.5 * 2, 12);
    expect(flattenCombination(project, "NOPE").ok).toBe(false);
    const cyc: Project = { ...project, combinations: [{ id: "U1", name: "a", kind: "ULS", terms: [{ ref: "U1", refType: "combination", factor: 1 }] }] };
    expect(flattenCombination(cyc, "U1").ok).toBe(false);
    const broken: Project = { ...project, combinations: [{ id: "U1", name: "a", kind: "ULS", terms: [{ ref: "ZZ", refType: "case", factor: 1 }] }] };
    expect(flattenCombination(broken, "U1").ok).toBe(false);
    const built = projectWithCombination(project, "U1");
    expect("error" in built).toBe(false);
    expect("error" in projectWithCombination(project, "NOPE")).toBe(true);
  });

  it("trocea los avisos del solver y extrae ubicaciones", () => {
    const msg = "Aviso: sistema mal condicionado en el nudo N3, GDL ry (pivote relativo 1e-12); Aviso: Barra P7: mecanismo interno sin carga que lo active (uz, ry); sus desplazamientos son indeterminados";
    const notes = parseSolverMessage(msg, "ok");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ kind: "ill-conditioned", nodes: ["N3"], severity: "warning" });
    expect(notes[1]).toMatchObject({ kind: "mechanism", members: ["P7"] });
    const err = parseSolverMessage("Sistema singular o mal condicionado: residuo", "singular");
    expect(err).toHaveLength(1);
    expect(err[0]?.severity).toBe("error");
    expect(parseSolverMessage(null, "ok")).toEqual([]);
  });
});

describe("edición de barras y apoyos", () => {
  it("liberaciones: se crean, se combinan y se limpian los objetos vacíos", () => {
    const m = { id: "B", i: "A", j: "C", material: "M", section: "S" };
    const c1 = releaseChange(m, "j", "ry", true);
    expect(c1.patch).toEqual({ releases: { j: { ry: true } } });
    const m2 = { ...m, releases: { j: { ry: true as const } } };
    expect(isReleased(m2, "j", "ry")).toBe(true);
    expect(isReleased(m2, "i", "ry")).toBe(false);
    expect(releaseChange(m2, "i", "uz", true).patch).toEqual({ releases: { i: { uz: true }, j: { ry: true } } });
    expect(releaseChange(m2, "j", "ry", false)).toEqual({ patch: {}, unset: ["releases"] });
  });
  it("apoyos: banderas, fixed y clasificación", () => {
    expect(fixedFromFlags({ ux: true, uz: true, ry: false })).toEqual([true, true, true, false, false, false]);
    expect(fixedFromFlags({ ux: true, uz: true, ry: true })).toEqual([true, true, true, true, true, true]);
    expect(supportFlags([true, true, true, false, false, false])).toEqual({ ux: true, uz: true, ry: false });
    const p = beamE1Project();
    expect(supportChoice(p, "A")).toBe("pinned");
    expect(supportChoice(p, "B")).toBe("roller-x");
    const weird = { ...p, supports: [{ id: "SA", node: "A", fixed: [true, false, true, false, false, false] as const }] };
    expect(supportChoice(weird, "A")).toBe("custom");
    expect(supportChoice(weird, "B")).toBe("none");
  });
  it("sección rectangular: A, Iy, Iz y J de un cuadrado conocido", () => {
    const s = rectangularSection(0.3, 0.3);
    expect(s.A).toBeCloseTo(0.09, 12);
    expect(s.Iy).toBeCloseTo(0.3 ** 4 / 12, 12);
    expect(s.Iz).toBeCloseTo(0.3 ** 4 / 12, 12);
    // J de un cuadrado de lado a: 0,1406 a⁴ (valor clásico); la fórmula aproximada queda a < 1 % de él.
    expect(Math.abs(s.J / (0.3 ** 4) - 0.1406)).toBeLessThan(0.0015);
  });
});
