// @vitest-environment happy-dom
// Componentes de los paneles con happy-dom + Testing Library: edición, validación junto al campo, i18n, unidades,
// gestión de patrones/casos/combinaciones, asignación de cargas, tabla, resultados, atajos y arranque.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { createSolver } from "@edscar/solver";
import { beamE1Project, createEditorStore, type EditorStore } from "@edscar/ui-state";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EditorProvider } from "../store";
import type { SolverClient } from "../worker/client";
import { AssignPanel } from "./AssignPanel";
import { CasesPanel } from "./CasesPanel";
import { DataTable } from "./DataTable";
import { EditorApp } from "./EditorApp";
import { MaterialsPanel } from "./MaterialsPanel";
import { NoticeBar } from "./Panels";
import { setPrefs } from "./prefs";
import { ProjectTree } from "./ProjectTree";
import { PropertiesPanel } from "./PropertiesPanel";
import { ResultsPanel } from "./ResultsPanel";
import { NumberField } from "./ui";
import { TopBar } from "./TopBar";
import { ValidationPanel } from "./ValidationPanel";

beforeEach(() => {
  setPrefs({ lang: "es", units: "SI", theme: "auto" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});

/** Lee un fichero de apps/web/public (el cwd puede ser la raíz del monorepo o apps/web). */
function publicText(rel: string): string {
  const candidates = [resolve(process.cwd(), "apps/web/public", rel), resolve(process.cwd(), "public", rel)];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("no existe " + rel);
  return readFileSync(found, "utf8");
}

const solverClient = (): SolverClient => ({
  ping: () => Promise.resolve(1),
  solve: (req) => Promise.resolve(createSolver().solve(req)),
  dispose: () => undefined,
});

function mount(ui: ReactElement, store: EditorStore = createEditorStore({ storage: null, project: beamE1Project() })) {
  const r = render(<EditorProvider store={store}>{ui}</EditorProvider>);
  return { store, ...r };
}

const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe("NumberField", () => {
  it("muestra el valor con su unidad, convierte a SI al confirmar y no llama si no cambia", () => {
    const onCommit = vi.fn<(v: number | null) => string | null>(() => null);
    render(<NumberField label="L" quantity="length" value={6} onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "L (m)" });
    expect((input as HTMLInputElement).value).toBe("6");
    type(input, "6");
    expect(onCommit).not.toHaveBeenCalled();
    type(input, "7,5");
    expect(onCommit).toHaveBeenCalledWith(7.5);
  });

  it("rechaza texto no numérico y vacío obligatorio sin llamar a onCommit", () => {
    const onCommit = vi.fn<(v: number | null) => string | null>(() => null);
    render(<NumberField label="L" quantity="length" value={6} onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "L (m)" });
    type(input, "abc");
    expect(screen.getByRole("alert").textContent).toBe("Número no válido");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    type(input, "");
    expect(screen.getByRole("alert").textContent).toBe("Valor obligatorio");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("muestra el error del modelo junto al campo, conserva lo escrito y Esc lo cancela", () => {
    render(<NumberField label="L" quantity="length" value={6} onCommit={() => "rechazado por el modelo"} />);
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "L (m)" });
    type(input, "9");
    expect(screen.getByRole("alert").textContent).toBe("rechazado por el modelo");
    expect(input.value).toBe("9");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("6");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("campo opcional vacío envía null; unidades imperiales convierten ida y vuelta", () => {
    const onCommit = vi.fn<(v: number | null) => string | null>(() => null);
    const { rerender } = render(<NumberField label="a" quantity="length" optional value={2} onCommit={onCommit} />);
    type(screen.getByRole("textbox", { name: "a (m)" }), "");
    expect(onCommit).toHaveBeenCalledWith(null);
    setPrefs({ units: "imperial" });
    rerender(<NumberField label="a" quantity="length" optional value={0.3048} onCommit={onCommit} />);
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "a (ft)" });
    expect(input.value).toBe("1");
    type(input, "2");
    expect(onCommit).toHaveBeenLastCalledWith(0.6096);
  });
});

describe("PropertiesPanel", () => {
  it("sin selección muestra la ayuda; con un nudo permite mover x y rechaza un movimiento inválido junto al campo", () => {
    const { store } = mount(<PropertiesPanel />);
    expect(screen.getByText(/Selecciona un nudo/)).toBeTruthy();
    act(() => { store.select({ nodes: ["A"] }); });
    const x = screen.getByRole("textbox", { name: "x (m)" });
    type(x, "1");
    expect(store.getState().project.nodes.find((n) => n.id === "A")?.x).toBe(1);
    // Mover A sobre B deja la barra con longitud 0: validateProject lo rechaza y el mensaje aparece junto al campo.
    type(x, "6");
    expect(screen.getByRole("alert").textContent).toMatch(/longitud 0/);
    expect(store.getState().project.nodes.find((n) => n.id === "A")?.x).toBe(1);
  });

  it("cambia el apoyo con el selector y los GDL personalizados", () => {
    const { store } = mount(<PropertiesPanel />);
    act(() => { store.select({ nodes: ["B"] }); });
    expect(screen.getByRole("combobox", { name: "Apoyo" }).getAttribute("aria-label")).toBe("Apoyo");
    fireEvent.change(screen.getByRole("combobox", { name: "Apoyo" }), { target: { value: "fixed" } });
    expect(store.getState().project.supports.find((s) => s.node === "B")?.fixed).toEqual([true, true, true, true, true, true]);
    fireEvent.click(screen.getByRole("checkbox", { name: "ry (giro)" }));
    expect(screen.getByRole("combobox", { name: "Apoyo" })).toBeTruthy();
    expect(store.getState().project.supports.find((s) => s.node === "B")?.fixed[4]).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Apoyo" }), { target: { value: "none" } });
    expect(store.getState().project.supports.some((s) => s.node === "B")).toBe(false);
  });

  it("barra: material, sección y rótula en j; varias barras: asignación en un solo undo", () => {
    const { store } = mount(<PropertiesPanel />);
    act(() => { store.dispatch({ type: "node.add", payload: { item: { id: "C", x: 9, y: 0, z: 0 } } }); });
    act(() => { store.dispatch({ type: "member.add", payload: { item: { id: "E2", i: "B", j: "C", material: "MAT1", section: "SEC1" } } }); });
    act(() => { store.dispatch({ type: "section.add", payload: { item: { id: "SEC2", name: "otra", A: 0.02, Iy: 0.0002, Iz: 0.0002, J: 0.00002 } } }); });
    act(() => { store.select({ members: ["E1"] }); });
    fireEvent.change(screen.getByRole("combobox", { name: "Sección" }), { target: { value: "SEC2" } });
    expect(store.getState().project.members.find((m) => m.id === "E1")?.section).toBe("SEC2");
    const hinge = screen.getAllByRole("checkbox", { name: "My (momento: rótula)" })[1];
    if (!hinge) throw new Error("sin rótula j");
    fireEvent.click(hinge);
    expect(store.getState().project.members.find((m) => m.id === "E1")?.releases).toEqual({ j: { ry: true } });
    // Varias barras.
    act(() => { store.select({ members: ["E1", "E2"] }); });
    const before = store.getState().history.undoCount;
    fireEvent.change(screen.getByRole("combobox", { name: "Sección" }), { target: { value: "SEC1" } });
    expect(store.getState().project.members.map((m) => m.section)).toEqual(["SEC1", "SEC1"]);
    expect(store.getState().history.undoCount).toBe(before + 1);
  });

  it("edita todas las variantes de carga con sus campos y unidades", () => {
    const { store } = mount(<PropertiesPanel />);
    const add = (item: Record<string, unknown>): void => {
      expect(store.dispatch({ type: "load.add", payload: { item } } as never).ok).toBe(true);
    };
    add({ id: "T1", pattern: "G", type: "member-trapezoid", member: "E1", w1: [0, 0, -1], w2: [0, 0, -3], frame: "global", a: 0, b: 6 });
    add({ id: "P1", pattern: "G", type: "member-point", member: "E1", p: [0, 0, -4], at: 0.5, relative: true, frame: "global" });
    add({ id: "H1", pattern: "G", type: "thermal", member: "E1", dT: 20 });
    add({ id: "D1", pattern: "G", type: "support-displacement", node: "A", d: [0, 0, 0, 0, 0, 0] });
    add({ id: "N1", pattern: "G", type: "nodal", node: "B", f: [0, 0, 0], m: [0, 0, 0] });

    act(() => { store.select({ loads: ["T1"] }); });
    type(screen.getByRole("textbox", { name: "w2z (kN/m)" }), "-6");
    expect(store.getState().project.loads.find((l) => l.id === "T1")).toMatchObject({ w2: [0, 0, -6], w1: [0, 0, -1] });
    // b fuera de rango (L = 6): error del modelo junto al campo.
    type(screen.getByRole("textbox", { name: "b (m)" }), "9");
    expect(screen.getByRole("alert").textContent).toMatch(/0 ≤ a < b ≤ L/);

    act(() => { store.select({ loads: ["P1"] }); });
    fireEvent.change(screen.getByRole("combobox", { name: "Marco" }), { target: { value: "local" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Posición relativa (fracción de L)" }));
    expect(store.getState().project.loads.find((l) => l.id === "P1")).toMatchObject({ frame: "local", relative: false });

    act(() => { store.select({ loads: ["H1"] }); });
    type(screen.getByRole("textbox", { name: "ΔT (°C)" }), "30");
    type(screen.getByRole("textbox", { name: "∂T/∂z (°C/m)" }), "5");
    expect(store.getState().project.loads.find((l) => l.id === "H1")).toMatchObject({ dT: 30, gradientZ: 5 });
    type(screen.getByRole("textbox", { name: "∂T/∂z (°C/m)" }), "");
    expect(store.getState().project.loads.find((l) => l.id === "H1")).not.toHaveProperty("gradientZ");

    act(() => { store.select({ loads: ["D1"] }); });
    type(screen.getByRole("textbox", { name: "uz (mm)" }), "-5");
    // A está restringido en uz por el apoyo: el desplazamiento impuesto es válido y se guarda en metros.
    expect((store.getState().project.loads.find((l) => l.id === "D1") as unknown as { d: number[] }).d[2]).toBeCloseTo(-0.005, 12);
    type(screen.getByRole("textbox", { name: "ux (mm)" }), "3");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((store.getState().project.loads.find((l) => l.id === "D1") as unknown as { d: number[] }).d[0]).toBeCloseTo(0.003, 12);

    act(() => { store.select({ loads: ["N1"] }); });
    type(screen.getByRole("textbox", { name: "Fz (kN)" }), "-12");
    type(screen.getByRole("textbox", { name: "My (kN·m)" }), "4");
    expect(store.getState().project.loads.find((l) => l.id === "N1")).toMatchObject({ f: [0, 0, -12], m: [0, 4, 0] });

    fireEvent.click(screen.getByRole("button", { name: "Borrar N1" }));
    expect(store.getState().project.loads.some((l) => l.id === "N1")).toBe(false);
  });
});

describe("Patrones, casos y combinaciones", () => {
  const openMenuItem = (menu: string, item: RegExp): void => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(menu) }));
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
  };

  it("crea patrones desde el menú, edita nombre/tipo/peso propio, cambia el activo y la visibilidad", () => {
    const { store } = mount(<CasesPanel />, createEditorStore({ storage: null, project: { ...beamE1Project(), patterns: [], loads: [], cases: [] } }));
    openMenuItem("Nuevo patrón", /Permanente \(D\)/);
    openMenuItem("Nuevo patrón", /Sobrecarga de uso/);
    openMenuItem("Nuevo patrón", /Nieve/);
    const p = store.getState().project.patterns;
    expect(p.map((x) => x.kind)).toEqual(["D", "L", "S"]);
    expect(p[0]?.selfWeightFactor).toBe(1);
    expect(store.getState().activePattern).toBe("P3");

    type(screen.getAllByRole("textbox", { name: "Nombre" })[0] as HTMLElement, "Peso propio y forjado");
    expect(store.getState().project.patterns[0]?.name).toBe("Peso propio y forjado");
    fireEvent.change(screen.getAllByRole("combobox", { name: "Tipo" })[1] as HTMLElement, { target: { value: "Lr" } });
    expect(store.getState().project.patterns[1]?.kind).toBe("Lr");
    type(screen.getAllByRole("textbox", { name: "Factor de peso propio" })[0] as HTMLElement, "0,5");
    expect(store.getState().project.patterns[0]?.selfWeightFactor).toBe(0.5);

    fireEvent.click(screen.getByRole("radio", { name: "Hacer activo el patrón P1" }));
    expect(store.getState().activePattern).toBe("P1");
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Visible" })[1] as HTMLElement);
    expect(store.getState().hiddenPatterns).toEqual(["P2"]);
  });

  it("un caso por patrón, términos con factor, y borrar un caso limpia las combinaciones que lo citan", () => {
    const { store } = mount(<CasesPanel />, createEditorStore({ storage: null, project: { ...beamE1Project(), cases: [] } }));
    fireEvent.click(screen.getByRole("button", { name: "Un caso por patrón" }));
    expect(store.getState().project.cases).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Nueva combinación" }));
    expect(store.getState().project.combinations).toHaveLength(1);
    const combo = store.getState().project.combinations[0];
    expect(combo?.terms).toEqual([{ ref: "C1", refType: "case", factor: 1.35 }]);
    type(screen.getAllByRole("textbox", { name: "Factor del término 1" })[0] as HTMLElement, "1");
    fireEvent.click(screen.getByRole("button", { name: "Borrar C1" }));
    expect(store.getState().project.cases).toHaveLength(0);
    expect(store.getState().project.combinations[0]?.terms).toEqual([]);
    expect(screen.getByText("Combinación sin términos.")).toBeTruthy();
    expect(store.undo()).toBe(true);
    expect(store.getState().project.cases).toHaveLength(1);
    expect(store.getState().project.combinations[0]?.terms).toHaveLength(1);
  });

  it("el botón de generación por norma está deshabilitado (M3) y se pueden añadir/quitar términos", () => {
    const { store } = mount(<CasesPanel />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Generar según EN 1990 (M3)" }).disabled).toBe(true);
    const n0 = store.getState().project.cases[0]?.terms.length ?? 0;
    fireEvent.click(screen.getAllByRole("button", { name: "+ Término" })[0] as HTMLElement);
    expect(store.getState().project.cases[0]?.terms).toHaveLength(n0 + 1);
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar término 1" })[0] as HTMLElement);
    expect(store.getState().project.cases[0]?.terms).toHaveLength(n0);
    // Un término con patrón inexistente no puede crearse desde la UI; la validación del modelo cubre el resto.
  });

  it("borrar un patrón borra sus cargas y se puede deshacer", () => {
    const { store } = mount(<CasesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Borrar G" }));
    expect(store.getState().project.patterns).toHaveLength(0);
    expect(store.getState().project.loads).toHaveLength(0);
    act(() => { store.undo(); });
    expect(store.getState().project.loads).toHaveLength(1);
  });
});

describe("Materiales y secciones", () => {
  it("edita E en MPa, crea desde catálogo y desde rectangular, y muestra el rechazo del modelo", () => {
    const { store } = mount(<MaterialsPanel />);
    type(screen.getByRole("textbox", { name: "E (MPa)" }), "200000");
    expect(store.getState().project.materials[0]?.E).toBe(200e6);
    type(screen.getByRole("textbox", { name: "E (MPa)" }), "0");
    expect(screen.getAllByRole("alert").some((a) => /positive|mayor|E/i.test(a.textContent))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Nuevo material/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Hormigón/ }));
    expect(store.getState().project.materials).toHaveLength(2);
    expect(store.getState().project.materials[1]?.E).toBe(33e6);
    fireEvent.click(screen.getByRole("button", { name: "Crear rectangular" }));
    expect(store.getState().project.sections).toHaveLength(2);
    expect(store.getState().project.sections[1]?.A).toBeCloseTo(0.09, 12);
    // El material por defecto está en uso: no se puede borrar y el motivo se muestra.
    fireEvent.change(screen.getAllByRole("combobox", { name: "Material" })[0] as HTMLElement, { target: { value: "MAT1" } });
    fireEvent.click(screen.getByRole("button", { name: "Borrar MAT1" }));
    expect(store.getState().project.materials).toHaveLength(2);
    expect(screen.getAllByRole("alert").some((a) => /no existe/.test(a.textContent))).toBe(true);
  });
});

describe("AssignPanel (herramienta Cargas)", () => {
  function twoMembers(): EditorStore {
    const store = createEditorStore({ storage: null, project: beamE1Project() });
    act(() => { store.dispatch({ type: "node.add", payload: { item: { id: "C", x: 9, y: 0, z: 0 } } }); });
    act(() => { store.dispatch({ type: "member.add", payload: { item: { id: "E2", i: "B", j: "C", material: "MAT1", section: "SEC1" } } }); });
    return store;
  }

  it("añade una carga uniforme a varias barras con un solo deshacer y luego reemplaza y elimina", () => {
    const store = twoMembers();
    mount(<AssignPanel />, store);
    act(() => { store.select({ members: ["E1", "E2"] }); });
    type(screen.getByRole("textbox", { name: "wz (kN/m)" }), "-4");
    const undoBefore = store.getState().history.undoCount;
    fireEvent.click(screen.getByRole("button", { name: "Añadir a la selección" }));
    expect(store.getState().project.loads).toHaveLength(3);
    expect(store.getState().history.undoCount).toBe(undoBefore + 1);
    expect(store.getState().history.undoLabel).toBe("Añadir cargas");

    fireEvent.click(screen.getByRole("radio", { name: "Reemplazar" }));
    type(screen.getByRole("textbox", { name: "wz (kN/m)" }), "-9");
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar en la selección" }));
    const loads = store.getState().project.loads;
    expect(loads).toHaveLength(2);
    expect(loads.every((l) => l.type === "member-uniform" && l.w[2] === -9)).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Eliminar" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar de la selección" }));
    expect(store.getState().project.loads).toHaveLength(0);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    act(() => { store.undo(); });
    expect(store.getState().project.loads).toHaveLength(2);
  });

  it("avisa si no hay selección adecuada y rechaza rangos inválidos sin tocar el modelo", () => {
    const store = twoMembers();
    mount(<AssignPanel />, store);
    fireEvent.click(screen.getByRole("button", { name: "Añadir a la selección" }));
    expect(screen.getAllByRole("alert")[0]?.textContent).toMatch(/No hay elementos seleccionados/);
    act(() => { store.select({ members: ["E1"] }); });
    type(screen.getByRole("textbox", { name: "a (m)" }), "5");
    type(screen.getByRole("textbox", { name: "b (m)" }), "2");
    fireEvent.click(screen.getByRole("button", { name: "Añadir a la selección" }));
    expect(screen.getAllByRole("alert")[0]?.textContent).toMatch(/a < b/);
    // b > L pasa el plan pero lo rechaza validateProject: el grupo se cancela por completo.
    type(screen.getByRole("textbox", { name: "a (m)" }), "0");
    type(screen.getByRole("textbox", { name: "b (m)" }), "50");
    const n = store.getState().project.loads.length;
    fireEvent.click(screen.getByRole("button", { name: "Añadir a la selección" }));
    expect(screen.getAllByRole("alert")[0]?.textContent).toMatch(/0 ≤ a < b ≤ L/);
    expect(store.getState().project.loads).toHaveLength(n);
    expect(store.isGrouping()).toBe(false);
  });

  it("cargas nodales con la selección de nudos", () => {
    const store = twoMembers();
    mount(<AssignPanel />, store);
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de carga" }), { target: { value: "nodal" } });
    act(() => { store.select({ nodes: ["A", "C"] }); });
    type(screen.getByRole("textbox", { name: "Fx (kN)" }), "5");
    fireEvent.click(screen.getByRole("button", { name: "Añadir a la selección" }));
    const nodal = store.getState().project.loads.flatMap((l) => (l.type === "nodal" ? [l] : []));
    expect(nodal.map((l) => l.node)).toEqual(["A", "C"]);
  });
});

describe("Árbol y tabla de datos sincronizados con la selección", () => {
  it("el árbol selecciona y refleja la selección del lienzo", () => {
    const { store } = mount(<ProjectTree onNavigate={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /^A \(/ }));
    expect(store.getState().selection.nodes).toEqual(["A"]);
    act(() => { store.select({ nodes: [], members: ["E1"] }); });
    expect(screen.getByRole("button", { name: /^E1 / }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^A \(/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("edita celdas, navega con las flechas y sincroniza la fila seleccionada", () => {
    const store = createEditorStore({ storage: null, project: beamE1Project() });
    act(() => { store.dispatch({ type: "node.add", payload: { item: { id: "C", x: 9, y: 0, z: 0 } } }); });
    mount(<DataTable />, store);
    const xs = screen.getAllByRole("textbox", { name: /^[ABC] x \(m\)$/ });
    expect(xs).toHaveLength(3);
    type(xs[2] as HTMLElement, "10");
    expect(store.getState().project.nodes.find((n) => n.id === "C")?.x).toBe(10);
    (xs[0] as HTMLElement).focus();
    fireEvent.keyDown(xs[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(xs[1]);
    fireEvent.keyDown(xs[1] as HTMLElement, { key: "Enter" });
    expect(document.activeElement).toBe(xs[2]);
    fireEvent.keyDown(xs[2] as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(xs[1]);

    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(store.getState().selection.nodes).toEqual(["B"]);
    expect(screen.getByRole("button", { name: "B" }).closest("tr")?.getAttribute("aria-selected")).toBe("true");
    act(() => { store.select({ nodes: ["A"] }); });
    expect(screen.getByRole("button", { name: "A" }).closest("tr")?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "B" }).closest("tr")?.getAttribute("aria-selected")).toBe("false");

    // Añadir nudo y barra desde la tabla.
    fireEvent.click(screen.getByRole("button", { name: "Añadir nudo" }));
    expect(store.getState().project.nodes).toHaveLength(4);
  });

  it("tabla de barras y cargas: rótulas, material y valores editables", () => {
    const store = createEditorStore({ storage: null, project: beamE1Project() });
    mount(<DataTable />, store);
    fireEvent.click(screen.getByRole("tab", { name: /Barras/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "E1 Rótula j" }));
    expect(store.getState().project.members[0]?.releases).toEqual({ j: { ry: true } });
    fireEvent.click(screen.getByRole("tab", { name: /Cargas/ }));
    type(screen.getByRole("textbox", { name: "wz (kN/m)" }), "-12");
    expect((store.getState().project.loads[0] as unknown as { w: number[] }).w[2]).toBe(-12);
    fireEvent.click(screen.getByRole("button", { name: "L1" }));
    expect(store.getState().selection.loads).toEqual(["L1"]);
  });
});

describe("Resultados y validación", () => {
  it("resuelve una combinación, muestra máximos y Σ de reacciones y permite volver a los casos", async () => {
    const store = createEditorStore({ storage: null, project: beamE1Project() });
    act(() => { store.dispatch({ type: "combination.add", payload: { item: { id: "U1", name: "ELU", kind: "ULS", terms: [{ ref: "C1", refType: "case", factor: 1.35 }] } } }); });
    mount(<ResultsPanel solver={solverClient()} />, store);
    fireEvent.change(screen.getByRole("combobox", { name: "Mostrar resultados de" }), { target: { value: "combo:U1" } });
    // wL/2 = 30 kN por apoyo; ×1.35 = 40,5 kN; Σ = 81 kN.
    await waitFor(() => { expect(screen.getByText("81 kN")).toBeTruthy(); }, { timeout: 3000 });
    expect(screen.getByText(/Resuelto correctamente/)).toBeTruthy();
    // M máx = 1.35·45 = 60,75 kN·m en x = 3 m
    expect(screen.getByText("60.75 kN·m")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Mostrar resultados de" }), { target: { value: "case:C1" } });
    expect(store.getState().results.caseId).toBe("C1");
  });

  it("diagrama y opciones de visualización actúan sobre el store", () => {
    const { store } = mount(<ResultsPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "V" }));
    expect(store.getState().display.diagram).toBe("V");
    fireEvent.click(screen.getByRole("checkbox", { name: "Deformada" }));
    expect(store.getState().display.deformed).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/Sin resultados todavía/);
  });

  it("mecanismo: avisos con acceso a los elementos; cambios rechazados visibles", () => {
    const { store } = mount(<ValidationPanel />);
    expect(screen.getByText(/Sin avisos/)).toBeTruthy();
    act(() => { store.dispatch({ type: "support.remove", payload: { id: "SB" } }); });
    expect(screen.getByText(/Posible mecanismo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
    expect(store.getState().selection.members).toEqual(["E1"]);
    act(() => { store.dispatch({ type: "member.update", payload: { id: "E1", patch: { material: "NOPE" } } }); });
    expect(screen.getByText("Cambio rechazado por la validación del modelo:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Descartar aviso" }));
    expect(screen.queryByText("Cambio rechazado por la validación del modelo:")).toBeNull();
  });

  it("la barra de aviso muestra el disclaimer y el aviso de datos no verificados", () => {
    mount(<NoticeBar />);
    expect(screen.getByRole("note").textContent).toMatch(/verificados por un técnico competente/);
    expect(screen.getByText(/unverified/)).toBeTruthy();
  });
});

describe("TopBar", () => {
  it("indica cambios sin guardar, etiqueta deshacer/rehacer y guarda (descarga) marcando como guardado", () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: (b: Blob) => { created.push(b); return "blob:x"; },
      revokeObjectURL: () => undefined,
    }));
    const { store } = mount(<TopBar />);
    expect(screen.getByText(/sin cambios/)).toBeTruthy();
    act(() => { store.dispatch({ type: "pattern.add", payload: { item: { id: "Q", name: "q", kind: "L", selfWeightFactor: 0 } } }); });
    expect(screen.getByText(/cambios sin guardar/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Deshacer: Crear patrón/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Archivo/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Guardar/ }));
    expect(created).toHaveLength(1);
    expect(screen.getByText(/sin cambios/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Deshacer: Crear patrón/ }));
    expect(store.getState().project.patterns.some((p) => p.id === "Q")).toBe(false);
    expect(screen.getByRole("button", { name: /Rehacer: Crear patrón/ })).toBeTruthy();
  });

  it("pide confirmación antes de descartar cambios al crear un proyecto nuevo", () => {
    const { store } = mount(<TopBar />);
    act(() => { store.dispatch({ type: "pattern.add", payload: { item: { id: "Q", name: "q", kind: "L", selfWeightFactor: 0 } } }); });
    fireEvent.click(screen.getByRole("button", { name: /Archivo/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Nuevo proyecto/ }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(store.getState().project.nodes).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(store.getState().project.nodes).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Archivo/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Nuevo proyecto/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(store.getState().project.nodes).toHaveLength(0);
  });

  it("abre un archivo .edscar.json válido y informa de uno inválido", async () => {
    const { store, container } = mount(<TopBar />);
    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    if (!input) throw new Error("sin input de archivo");
    const good = new File([publicText("examples/viga-biapoyada.edscar.json")], "viga.edscar.json");
    fireEvent.change(input, { target: { files: [good] } });
    await waitFor(() => { expect(store.getState().file.name).toBe("viga.edscar.json"); });
    expect(store.getState().project.cases).toHaveLength(3);
    const bad = new File(["{ no json"], "mal.edscar.json");
    fireEvent.change(input, { target: { files: [bad] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/No se pudo abrir/);
    expect(store.getState().file.name).toBe("viga.edscar.json");
  });

  it("idioma e unidades: cambia a inglés e imperial y los paneles lo reflejan", () => {
    mount(<><TopBar /><PropertiesPanel /></>);
    fireEvent.change(screen.getByRole("combobox", { name: "Idioma" }), { target: { value: "en" } });
    expect(screen.getByRole("button", { name: /File/ })).toBeTruthy();
    expect(screen.getByText(/Select a node, member or load/)).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    fireEvent.change(screen.getByRole("combobox", { name: "Units" }), { target: { value: "imperial" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), { target: { value: "dark" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("atajos: ? abre la ayuda, Esc la cierra, Ctrl+Z deshace fuera de campos de texto", () => {
    const { store } = mount(<TopBar />);
    fireEvent.keyDown(document.body, { key: "?" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText(/Ctrl\+S/)).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { store.dispatch({ type: "pattern.add", payload: { item: { id: "Q", name: "q", kind: "L", selfWeightFactor: 0 } } }); });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(store.getState().project.patterns.some((p) => p.id === "Q")).toBe(false);
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(store.getState().project.patterns.some((p) => p.id === "Q")).toBe(true);
  });
});

describe("EditorApp: arranque con ejemplos", () => {
  const stubFetch = (urls: string[]): void => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      return Promise.resolve(new Response(publicText(url.replace(/^.*?(examples\/)/, "$1")), { status: 200 }));
    });
  };

  it("sin borrador carga el pórtico, lo resuelve y muestra el caso CG automáticamente", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const { container } = render(<EditorApp solver={solverClient()} search="" />);
    await waitFor(() => { expect(container.querySelectorAll("[data-member]")).toHaveLength(10); }, { timeout: 5000 });
    expect(urls).toEqual(["/examples/portico-2-plantas.edscar.json"]);
    // Resultado automático: el estado del solver pasa a «resuelto» y el panel de resultados lo confirma.
    fireEvent.click(screen.getAllByRole("tab", { name: "Resultados" })[0] as HTMLElement);
    await waitFor(() => { expect(screen.getByText(/Resuelto correctamente/)).toBeTruthy(); }, { timeout: 5000 });
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Mostrar resultados de" }).value).toBe("case:CG");
    expect(screen.getByRole("note").textContent).toMatch(/técnico competente/);
  });

  it("?example= carga SIEMPRE el ejemplo aunque haya borrador y no pisa el borrador", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const draftStore = createEditorStore({ project: beamE1Project() });
    draftStore.saveDraft();
    const draft = localStorage.getItem("edscar.draft.v1");
    expect(draft).not.toBeNull();
    const { container } = render(<EditorApp search="?example=viga-biapoyada" />);
    await waitFor(() => { expect(urls).toEqual(["/examples/viga-biapoyada.edscar.json"]); });
    await waitFor(() => { expect(screen.getAllByText(/viga-biapoyada\.edscar\.json/).length).toBeGreaterThan(0); });
    expect(container.querySelectorAll("[data-member]")).toHaveLength(1);
    // Cargar un ejemplo no ensucia el proyecto: el borrador previo sigue intacto.
    await new Promise((r) => setTimeout(r, 1200));
    expect(localStorage.getItem("edscar.draft.v1")).toBe(draft);
  });

  it("con borrador previo y sin ?example= conserva el borrador y no pide ejemplos", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    createEditorStore({ project: beamE1Project() }).saveDraft();
    const { container } = render(<EditorApp search="" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(urls).toEqual([]);
    expect(container.querySelectorAll("[data-member]")).toHaveLength(1);
  });

  it("el menú Ejemplos carga cada ejemplo y un fallo de red se muestra", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const store = createEditorStore({ storage: null });
    render(<EditorApp store={store} search="" />);
    fireEvent.click(screen.getByRole("button", { name: /Ejemplos/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Pórtico/ }));
    await waitFor(() => { expect(store.getState().project.members).toHaveLength(10); });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("sin red")));
    fireEvent.click(screen.getByRole("button", { name: /Ejemplos/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Pórtico/ }));
    // Cargar un ejemplo no ensucia el proyecto: no hay diálogo y el fallo de red se muestra.
    expect((await screen.findAllByRole("alert")).some((x) => /sin red/.test(x.textContent))).toBe(true);
  });

  it("montaje completo: los paneles aparecen en sus slots y se pliegan", () => {
    const { container } = render(<EditorApp store={createEditorStore({ storage: null, project: beamE1Project() })} search="" />);
    for (const s of ["header", "toolbar", "left", "canvas", "right", "bottom"]) expect(container.querySelector(`[data-slot='${s}']`)).not.toBeNull();
    const collapse = screen.getByRole("button", { name: "Plegar panel Proyecto" });
    fireEvent.click(collapse);
    expect(container.querySelector(".pn-panel[data-side='left']")?.getAttribute("data-collapsed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Desplegar panel Proyecto" }));
    expect(container.querySelector(".pn-panel[data-side='left']")?.getAttribute("data-collapsed")).toBe("false");
  });
});
