import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@edscar/model";
import type { SolveResult } from "@edscar/solver";
import {
  addNodeCommand, autosaveDraft, beamE1Commands, beamE1Project, createEditorStore, createEmptyProject,
  describeSelection, DRAFT_KEY, isDirty, MAX_ZOOM, MIN_ZOOM, visibleResult, type Command, type StorageLike,
} from "./index";

afterEach(() => {
  vi.useRealTimers();
});

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const okResult = (extra: Partial<SolveResult> = {}): SolveResult => ({
  status: "ok", displacements: {}, reactions: {}, members: [], ...extra,
});

function storeE1(): ReturnType<typeof createEditorStore> {
  return createEditorStore({ project: beamE1Project(), storage: null });
}

describe("dispatch y suscripción", () => {
  it("notifica, cambia el estado de forma inmutable y sube la revisión", () => {
    const s = createEditorStore({ storage: null });
    const calls: number[] = [];
    const unsub = s.subscribe(() => calls.push(s.getState().revision));
    const before = s.getState();
    expect(s.dispatch(addNodeCommand(before.project, 1, 0))).toEqual({ ok: true });
    expect(s.getState()).not.toBe(before);
    expect(before.project.nodes).toHaveLength(0);
    expect(calls).toEqual([1]);
    unsub();
    s.dispatch(addNodeCommand(s.getState().project, 2, 0));
    expect(calls).toEqual([1]);
  });

  it("un comando inválido deja el estado intacto y guarda los errores", () => {
    const s = storeE1();
    const before = s.getState();
    const r = s.dispatch({ type: "member.add", payload: { item: { id: "X", i: "A", j: "ZZ", material: "MAT1", section: "SEC1" } } });
    expect(r.ok).toBe(false);
    const after = s.getState();
    expect(after.project).toBe(before.project);
    expect(after.revision).toBe(before.revision);
    expect(after.history.undoCount).toBe(0);
    expect(after.lastErrors?.some((e) => e.code === "dangling-ref")).toBe(true);
    s.clearErrors();
    expect(s.getState().lastErrors).toBeNull();
    s.clearErrors(); // idempotente
    s.dispatch(addNodeCommand(s.getState().project, 1, 1));
    expect(s.getState().lastErrors).toBeNull();
  });
});

describe("historial", () => {
  it("undo/redo ilimitado: 300 nudos, deshacer todo y rehacer todo", () => {
    const s = createEditorStore({ storage: null });
    const initial = s.getState().project;
    for (let k = 0; k < 300; k++) s.dispatch(addNodeCommand(s.getState().project, k, 0));
    const full = s.getState().project;
    expect(s.getState().history.undoCount).toBe(300);
    let n = 0;
    while (s.undo()) n++;
    expect(n).toBe(300);
    expect(s.getState().project).toEqual(initial);
    expect(s.undo()).toBe(false);
    n = 0;
    while (s.redo()) n++;
    expect(n).toBe(300);
    expect(s.getState().project).toEqual(full);
    expect(s.redo()).toBe(false);
  });

  it("un comando nuevo vacía la pila de rehacer; etiquetas del historial", () => {
    const s = createEditorStore({ storage: null });
    s.dispatch(addNodeCommand(s.getState().project, 0, 0));
    s.undo();
    expect(s.getState().history).toMatchObject({ undoCount: 0, redoCount: 1, redoLabel: "Añadir nudo", undoLabel: null });
    s.dispatch(addNodeCommand(s.getState().project, 5, 0));
    expect(s.getState().history).toMatchObject({ undoCount: 1, redoCount: 0, undoLabel: "Añadir nudo" });
  });

  it("construir E1 con comandos, deshacer todo y rehacer da el mismo proyecto", () => {
    const s = createEditorStore({ storage: null });
    for (const c of beamE1Commands()) expect(s.dispatch(c).ok).toBe(true);
    const done = s.getState().project;
    while (s.undo()) { /* hasta vaciar */ }
    expect(s.getState().project).toEqual(createEmptyProject());
    while (s.redo()) { /* hasta el final */ }
    expect(s.getState().project).toEqual(done);
  });

  it("el historial es serializable y se puede reproducir desde JSON", () => {
    const s = createEditorStore({ storage: null });
    for (const c of beamE1Commands()) s.dispatch(c);
    const h = JSON.parse(JSON.stringify(s.getHistory())) as ReturnType<typeof s.getHistory>;
    const replay = createEditorStore({ storage: null });
    for (const e of h.undo) expect(replay.dispatch(e.forward).ok).toBe(true);
    expect(replay.getState().project).toEqual(s.getState().project);
  });

  it("agrupar: 50 movimientos de arrastre = un solo undo con un node.move por nudo", () => {
    const s = storeE1();
    s.beginGroup("Mover nudos");
    for (let k = 1; k <= 50; k++) {
      s.dispatch({ type: "node.move", payload: { id: "B", x: 6 + k * 0.1, z: 0 } });
      s.dispatch({ type: "node.move", payload: { id: "A", x: -k * 0.1, z: 0 } });
    }
    expect(s.isGrouping()).toBe(true);
    expect(s.undo()).toBe(false); // no se deshace a mitad de grupo
    s.endGroup();
    expect(s.isGrouping()).toBe(false);
    const st = s.getState();
    expect(st.history.undoCount).toBe(1);
    expect(st.history.undoLabel).toBe("Mover nudos");
    const entry = s.getHistory().undo[0];
    expect(entry?.forward.type).toBe("batch");
    const forward = entry?.forward as Extract<Command, { type: "batch" }>;
    expect(forward.payload.commands).toHaveLength(2);
    expect(st.project.nodes.find((n) => n.id === "B")?.x).toBeCloseTo(11, 12);
    s.undo();
    expect(s.getState().project).toEqual(beamE1Project());
    s.redo();
    expect(s.getState().project.nodes.find((n) => n.id === "A")?.x).toBeCloseTo(-5, 12);
  });

  it("un grupo con un solo movimiento conserva la etiqueta; un grupo vacío no deja rastro", () => {
    const s = storeE1();
    s.beginGroup();
    s.endGroup();
    expect(s.getState().history.undoCount).toBe(0);
    s.beginGroup("Una cosa");
    s.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } });
    s.endGroup();
    expect(s.getState().history).toMatchObject({ undoCount: 1, undoLabel: "Una cosa" });
    s.endGroup(); // sin grupo abierto: sin efecto
    expect(s.getState().history.undoCount).toBe(1);
  });

  it("grupos anidados cuentan como uno; grupo con comandos distintos forma un batch", () => {
    const s = storeE1();
    s.beginGroup("Externo");
    s.beginGroup("Interno");
    s.dispatch(addNodeCommand(s.getState().project, 3, 0, "M"));
    s.dispatch({ type: "node.remove", payload: { id: "M" } });
    s.endGroup();
    expect(s.isGrouping()).toBe(true);
    s.endGroup();
    expect(s.getState().history.undoCount).toBe(1);
    s.undo();
    expect(s.getState().project).toEqual(beamE1Project());
  });

  it("un comando rechazado dentro de un grupo no se registra", () => {
    const s = storeE1();
    s.beginGroup();
    expect(s.dispatch(addNodeCommand(s.getState().project, 3, 0, "A")).ok).toBe(false);
    s.endGroup();
    expect(s.getState().history.undoCount).toBe(0);
  });

  it("cancelGroup revierte el arrastre y no deja historial", () => {
    const s = storeE1();
    s.beginGroup("Mover");
    s.dispatch({ type: "node.move", payload: { id: "B", x: 9, z: 0 } });
    s.dispatch({ type: "node.move", payload: { id: "A", x: -1, z: 0 } });
    s.cancelGroup();
    expect(s.isGrouping()).toBe(false);
    expect(s.getState().project).toEqual(beamE1Project());
    expect(s.getState().history.undoCount).toBe(0);
    s.cancelGroup(); // sin grupo: nada
    s.beginGroup();
    s.cancelGroup(); // grupo vacío
    expect(s.isGrouping()).toBe(false);
  });
});

describe("selección", () => {
  it("modos replace/add/toggle/remove, deduplica y descarta ids inexistentes", () => {
    const s = storeE1();
    s.select({ nodes: ["A", "A", "ZZ"], members: ["E1"] });
    expect(s.getState().selection).toEqual({ nodes: ["A"], members: ["E1"], loads: [] });
    s.select({ nodes: ["B"] }, "add");
    expect(s.getState().selection.nodes).toEqual(["A", "B"]);
    s.select({ nodes: ["A"] }, "toggle");
    expect(s.getState().selection.nodes).toEqual(["B"]);
    s.select({ nodes: ["A"] }, "toggle");
    expect(s.getState().selection.nodes).toEqual(["B", "A"]);
    s.select({ nodes: ["B"] }, "remove");
    expect(s.getState().selection.nodes).toEqual(["A"]);
    s.select({ loads: ["L1"] }, "replace");
    expect(s.getState().selection).toEqual({ nodes: [], members: [], loads: ["L1"] });
    s.selectAll();
    expect(s.getState().selection).toEqual({ nodes: ["A", "B"], members: ["E1"], loads: [] });
    s.clearSelection();
    const cleared = s.getState().selection;
    s.clearSelection();
    expect(s.getState().selection).toBe(cleared);
  });

  it("la selección se poda al borrar y deleteSelection es un único undo", () => {
    const s = storeE1();
    s.select({ nodes: ["A"], members: ["E1"], loads: ["L1"] });
    expect(s.deleteSelection().ok).toBe(true);
    expect(s.getState().project.nodes.map((n) => n.id)).toEqual(["B"]);
    expect(s.getState().selection).toEqual({ nodes: [], members: [], loads: [] });
    expect(s.getState().history.undoCount).toBe(1);
    s.undo();
    expect(s.getState().project).toEqual(beamE1Project());
    expect(s.deleteSelection()).toEqual({ ok: true }); // nada seleccionado
  });

  it("describeSelection", () => {
    expect(describeSelection({ nodes: [], members: [], loads: [] })).toBe("Sin selección");
    expect(describeSelection({ nodes: ["a", "b"], members: ["m"], loads: ["x", "y", "z"] })).toBe("2 nudos, 1 barra, 3 cargas");
  });
});

describe("herramienta, patrones, vista y visualización", () => {
  it("herramienta, tipo de apoyo y visualización", () => {
    const s = storeE1();
    s.setTool("member");
    s.setSupportPreset("fixed");
    s.setDisplay({ diagram: "V", grid: false });
    expect(s.getState()).toMatchObject({ tool: "member", supportPreset: "fixed", display: { diagram: "V", grid: false, snap: true } });
  });

  it("patrón activo y visibilidad; se actualizan al borrar el patrón", () => {
    const s = storeE1();
    expect(s.getState().activePattern).toBe("G");
    s.setActivePattern("NOPE");
    expect(s.getState().activePattern).toBe("G");
    s.setActivePattern(null);
    expect(s.getState().activePattern).toBeNull();
    s.setActivePattern("G");
    s.setPatternVisible("G", false);
    s.setPatternVisible("G", false);
    expect(s.getState().hiddenPatterns).toEqual(["G"]);
    s.setPatternVisible("G", true);
    expect(s.getState().hiddenPatterns).toEqual([]);
    s.setPatternVisible("G", false);
    s.dispatch({ type: "pattern.remove", payload: { id: "G" } });
    expect(s.getState().activePattern).toBeNull();
    expect(s.getState().hiddenPatterns).toEqual([]);
    expect(s.getState().results.caseId).toBe("C1");
  });

  it("vista: limita el zoom e ignora valores no finitos", () => {
    const s = storeE1();
    s.setView({ zoom: 1e9 });
    expect(s.getState().view.zoom).toBe(MAX_ZOOM);
    s.setView({ zoom: 0 });
    expect(s.getState().view.zoom).toBe(MIN_ZOOM);
    const v = s.getState().view;
    s.setView({ cx: NaN });
    expect(s.getState().view).toBe(v);
    s.setView({ cx: 10, cz: -2 });
    expect(s.getState().view).toMatchObject({ cx: 10, cz: -2 });
  });
});

describe("resultados del solver", () => {
  it("solveCancelled devuelve a reposo solo si se estaba calculando", () => {
    const s = storeE1();
    s.solveCancelled();
    expect(s.getState().solver.phase).toBe("idle");
    s.solveStarted();
    s.solveCancelled();
    expect(s.getState().solver.phase).toBe("idle");
    s.solveFailed("x");
    s.solveCancelled();
    expect(s.getState().solver.phase).toBe("failed");
  });

  it("guarda el resultado, lo marca obsoleto al cambiar el proyecto y refleja el estado del solver", () => {
    const s = storeE1();
    expect(visibleResult(s.getState())).toBeNull();
    s.solveStarted();
    expect(s.getState().solver.phase).toBe("solving");
    s.solveFinished("C1", s.getState().revision, okResult({ message: "aviso" }));
    expect(s.getState().solver).toEqual({ phase: "done", ok: true, status: "ok", message: "aviso" });
    expect(visibleResult(s.getState())?.stale).toBe(false);
    s.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } });
    expect(visibleResult(s.getState())?.stale).toBe(true);
    s.solveFinished("C1", s.getState().revision, { ...okResult(), status: "singular", message: "mecanismo" });
    expect(s.getState().solver).toMatchObject({ ok: false, status: "singular", message: "mecanismo" });
    s.solveFailed("canal roto");
    expect(s.getState().solver).toEqual({ phase: "failed", ok: false, status: null, message: "canal roto" });
    s.clearResults();
    expect(s.getState().results.result).toBeNull();
    expect(s.getState().solver.phase).toBe("idle");
  });

  it("solveFinished sin message deja message null; un resultado de otro caso no es visible", () => {
    const s = storeE1();
    s.dispatch({ type: "case.add", payload: { item: { id: "C2", name: "otro", type: "static-linear", terms: [] } } });
    s.solveFinished("C1", 0, okResult());
    expect(s.getState().solver.message).toBeNull();
    s.setResultCase("C2");
    expect(visibleResult(s.getState())).toBeNull();
    s.setResultCase("NOPE");
    expect(s.getState().results.caseId).toBe("C2");
    s.setResultCase(null);
    expect(s.getState().results.caseId).toBeNull();
  });
});

describe("proyecto: nuevo, abrir, guardar, borrador", () => {
  it("newProject reinicia todo; replaceProject valida", () => {
    const s = storeE1();
    s.select({ nodes: ["A"] });
    s.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } });
    s.newProject();
    expect(s.getState().project).toEqual(createEmptyProject());
    expect(s.getState().history.undoCount).toBe(0);
    expect(s.getState().selection.nodes).toEqual([]);
    s.newProject("3D");
    expect(s.getState().project.analysis).toBe("3D");
    const bad = { ...createEmptyProject(), nodes: [{ id: "N", x: 0, y: 5, z: 0 }] } as Project;
    expect(s.replaceProject(bad).ok).toBe(false);
    expect(s.replaceProject(beamE1Project(), "viga.edscar.json").ok).toBe(true);
    expect(s.getState().file.name).toBe("viga.edscar.json");
    expect(s.getState().activePattern).toBe("G");
  });

  it("exportar y abrir un .edscar.json devuelve el mismo proyecto; dirty/markSaved", () => {
    const s = storeE1();
    const text = s.exportProjectText();
    const s2 = createEditorStore({ storage: null });
    expect(s2.openProjectText(text, "x.edscar.json").ok).toBe(true);
    expect(s2.getState().project).toEqual(beamE1Project());
    expect(isDirty(s2.getState())).toBe(false);
    s2.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } });
    expect(isDirty(s2.getState())).toBe(true);
    s2.markSaved();
    expect(isDirty(s2.getState())).toBe(false);
    expect(s2.getState().file.name).toBe("x.edscar.json");
    s2.markSaved("y.edscar.json");
    expect(s2.getState().file.name).toBe("y.edscar.json");
  });

  it("abrir un texto inválido no cambia el proyecto y devuelve errores", () => {
    const s = storeE1();
    const before = s.getState().project;
    const r1 = s.openProjectText("{ no es json");
    expect(r1.ok).toBe(false);
    const r2 = s.openProjectText(JSON.stringify({ schemaVersion: 1 }));
    expect(r2.ok).toBe(false);
    expect(s.getState().project).toBe(before);
    expect(s.getState().lastErrors).not.toBeNull();
  });

  it("borrador: guardar, restaurar, descartar", () => {
    const storage = memoryStorage();
    const s = createEditorStore({ project: beamE1Project(), storage });
    expect(s.saveDraft()).toEqual({ ok: true });
    expect(storage.data.has(DRAFT_KEY)).toBe(true);
    const s2 = createEditorStore({ storage });
    expect(s2.restoreDraft().ok).toBe(true);
    expect(s2.getState().project).toEqual(beamE1Project());
    s2.discardDraft();
    expect(storage.data.has(DRAFT_KEY)).toBe(false);
    expect(s2.restoreDraft().ok).toBe(false);
    expect(s2.getState().lastErrors).toBeNull(); // sin borrador no es un error que mostrar
  });

  it("borrador: sin almacenamiento o con almacenamiento que lanza, nunca lanza", () => {
    const none = createEditorStore({ storage: null });
    expect(none.saveDraft().ok).toBe(false);
    expect(none.restoreDraft().ok).toBe(false);
    none.discardDraft();
    const boom: StorageLike = {
      getItem: () => { throw new Error("denegado"); },
      setItem: () => { throw new Error("cuota"); },
      removeItem: () => { throw new Error("denegado"); },
    };
    const s = createEditorStore({ storage: boom });
    expect(s.saveDraft()).toEqual({ ok: false, reason: "cuota" });
    expect(s.restoreDraft().ok).toBe(false);
    s.discardDraft();
  });

  it("borrador corrupto o inválido se rechaza", () => {
    const storage = memoryStorage();
    const s = createEditorStore({ storage });
    storage.data.set(DRAFT_KEY, "{{{");
    expect(s.restoreDraft().ok).toBe(false);
    expect(s.getState().lastErrors?.[0]?.code).toBe("draft");
    storage.data.set(DRAFT_KEY, JSON.stringify({ x: 1 }));
    expect(s.restoreDraft().ok).toBe(false);
    storage.data.set(DRAFT_KEY, JSON.stringify({ savedAt: "t", project: { schemaVersion: 1 } }));
    expect(s.restoreDraft().ok).toBe(false);
  });

  it("autosaveDraft guarda tras un tiempo de calma y se puede detener", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const s = createEditorStore({ storage });
    const stop = autosaveDraft(s, 500);
    s.dispatch(addNodeCommand(s.getState().project, 1, 0));
    vi.advanceTimersByTime(300);
    s.dispatch(addNodeCommand(s.getState().project, 2, 0));
    s.setTool("node"); // cambio sin revisión: no reinicia ni dispara
    vi.advanceTimersByTime(499);
    expect(storage.data.size).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.data.size).toBe(1);
    s.dispatch(addNodeCommand(s.getState().project, 3, 0));
    stop();
    vi.advanceTimersByTime(5000);
    const saved = JSON.parse(storage.data.get(DRAFT_KEY) ?? "{}") as { project: Project };
    expect(saved.project.nodes).toHaveLength(2);
  });
});
