import { describe, expect, it } from "vitest";
import { beamE1Project, createEditorStore, createEmptyProject, type EditorStore } from "@edscar/ui-state";
import { createInteraction, DRAG_THRESHOLD_PX, type Interaction, type PointerInfo, type Transient } from "./interaction";
import { worldToScreen, type Point } from "./transform";

// Vista fija: centro (3; 1.5) m, 100 px/m, lienzo de 800 x 600. El origen del modelo queda en (100, 450).
const VP = { width: 800, height: 600 };
function setup(project = createEmptyProject()): { store: EditorStore; ix: Interaction; seen: Transient[]; at: (x: number, z: number) => Point } {
  const store = createEditorStore({ project, storage: null });
  store.setView({ cx: 3, cz: 1.5, zoom: 100 });
  const seen: Transient[] = [];
  const ix = createInteraction(store, () => VP, (t) => seen.push(t));
  const at = (x: number, z: number): Point => worldToScreen({ view: store.getState().view, vp: VP }, x, z);
  return { store, ix, seen, at };
}
const down = (p: Point, extra: Partial<PointerInfo> = {}): PointerInfo => ({ p, button: 0, shift: false, ctrl: false, space: false, ...extra });
const key = (k: string, extra: { ctrl?: boolean; shift?: boolean } = {}) => ({ key: k, ctrl: false, shift: false, ...extra });

describe("herramienta nudo", () => {
  it("clic en vacío crea un nudo capturado a la rejilla (0.5 m a 100 px/m) y lo selecciona", () => {
    const { store, ix, at } = setup();
    store.setTool("node");
    ix.pointerDown(down(at(2.26, 1.1)));
    expect(store.getState().project.nodes).toEqual([{ id: "N1", x: 2.5, y: 0, z: 1 }]);
    expect(store.getState().selection.nodes).toEqual(["N1"]);
  });

  it("sin captura de rejilla, el nudo se crea en la posición libre", () => {
    const { store, ix, at } = setup();
    store.setTool("node");
    store.setDisplay({ snap: false });
    ix.pointerDown(down(at(2.26, 1.1)));
    expect(store.getState().project.nodes[0]?.x).toBeCloseTo(2.26, 9);
  });

  it("clic sobre un nudo existente lo selecciona en vez de duplicarlo", () => {
    const { store, ix, at } = setup(beamE1Project());
    store.setTool("node");
    ix.pointerDown(down(at(0.03, 0.03)));
    expect(store.getState().project.nodes).toHaveLength(2);
    expect(store.getState().selection.nodes).toEqual(["A"]);
  });
});

describe("herramienta barra", () => {
  it("dos clics crean los dos nudos y la barra; la cadena continúa; doble clic termina", () => {
    const { store, ix, at, seen } = setup();
    store.setTool("member");
    ix.pointerDown(down(at(0, 0)));
    expect(store.getState().project.nodes).toHaveLength(1);
    expect(seen[seen.length - 1]?.memberStart).toBe("N1");
    ix.pointerDown(down(at(4, 0)));
    let p = store.getState().project;
    expect(p.nodes.map((n) => [n.x, n.z])).toEqual([[0, 0], [4, 0]]);
    expect(p.members).toEqual([{ id: "B1", i: "N1", j: "N2", material: "MAT1", section: "SEC1" }]);
    expect(store.getState().selection.members).toEqual(["B1"]);
    // Continúa desde N2.
    ix.pointerDown(down(at(4, 3)));
    p = store.getState().project;
    expect(p.members.map((m) => [m.i, m.j])).toEqual([["N1", "N2"], ["N2", "N3"]]);
    ix.doubleClick();
    expect(ix.getTransient().memberStart).toBeNull();
  });

  it("deshacer quita la barra y su nudo final de una vez", () => {
    const { store, ix, at } = setup();
    store.setTool("member");
    ix.pointerDown(down(at(0, 0)));
    ix.pointerDown(down(at(4, 0)));
    store.undo();
    expect(store.getState().project.nodes.map((n) => n.id)).toEqual(["N1"]);
    expect(store.getState().project.members).toEqual([]);
  });

  it("unir dos nudos existentes no crea nudos; repetir la misma barra no la duplica; clic en el mismo nudo se ignora", () => {
    const base = beamE1Project();
    const { store, ix, at } = setup({ ...base, members: [], loads: [] });
    store.setTool("member");
    ix.pointerDown(down(at(0, 0)));
    ix.pointerDown(down(at(0, 0)));
    ix.pointerDown(down(at(6, 0)));
    expect(store.getState().project.members.map((m) => [m.i, m.j])).toEqual([["A", "B"]]);
    ix.pointerDown(down(at(0, 0))); // B -> A: ya existe en sentido contrario
    expect(store.getState().project.members).toHaveLength(1);
    expect(store.getState().project.nodes).toHaveLength(2);
  });

  it("Esc cancela la barra en curso; cambiar de herramienta también", () => {
    const { store, ix, at } = setup();
    store.setTool("member");
    ix.pointerDown(down(at(0, 0)));
    expect(ix.keyDown(key("Escape"))).toBe(true);
    expect(ix.getTransient().memberStart).toBeNull();
    ix.pointerDown(down(at(1, 0)));
    ix.reset();
    expect(ix.getTransient().memberStart).toBeNull();
    expect(store.getState().tool).toBe("member");
  });
});

describe("herramienta apoyo", () => {
  it("asigna el tipo elegido, lo quita al repetir y lo sustituye si es otro", () => {
    const { store, ix, at } = setup({ ...beamE1Project(), supports: [] });
    store.setTool("support");
    store.setSupportPreset("pinned");
    ix.pointerDown(down(at(0, 0)));
    expect(store.getState().project.supports).toEqual([{ id: "R1", node: "A", fixed: [true, true, true, false, false, false] }]);
    store.setSupportPreset("fixed");
    ix.pointerDown(down(at(0, 0)));
    expect(store.getState().project.supports[0]?.fixed).toEqual([true, true, true, true, true, true]);
    ix.pointerDown(down(at(0, 0)));
    expect(store.getState().project.supports).toEqual([]);
    ix.pointerDown(down(at(3, 3))); // vacío: nada
    expect(store.getState().history.undoCount).toBe(3);
  });
});

describe("herramienta seleccionar", () => {
  it("clic selecciona nudo, barra o carga; Mayús alterna; clic en vacío limpia", () => {
    const { store, ix, at } = setup(beamE1Project());
    ix.pointerDown(down(at(0, 0)));
    ix.pointerUp(at(0, 0));
    expect(store.getState().selection.nodes).toEqual(["A"]);
    ix.pointerDown(down(at(6, 0), { shift: true }));
    ix.pointerUp(at(6, 0));
    expect(store.getState().selection.nodes).toEqual(["A", "B"]);
    ix.pointerDown(down(at(6, 0), { shift: true }));
    expect(store.getState().selection.nodes).toEqual(["A"]);
    ix.pointerDown(down(at(3, 0)));
    ix.pointerUp(at(3, 0));
    expect(store.getState().selection).toEqual({ nodes: [], members: ["E1"], loads: [] });
    // Una flecha de la carga uniforme: 22 flechas repartidas en 600 px, la décima a 10·600/21 px del nudo A.
    const arrowX = at(0, 0).x + (10 * 600) / 21;
    ix.pointerDown(down({ x: arrowX, y: at(0, 0).y - 30 }));
    expect(store.getState().selection).toEqual({ nodes: [], members: [], loads: ["L1"] });
    ix.pointerDown(down({ x: 400, y: 20 }));
    ix.pointerUp({ x: 400, y: 20 });
    expect(store.getState().selection).toEqual({ nodes: [], members: [], loads: [] });
  });

  it("con las cargas ocultas, una flecha no se puede seleccionar", () => {
    const { store, ix, at } = setup(beamE1Project());
    store.setDisplay({ loads: false });
    const p = { x: at(0, 0).x + (10 * 600) / 21, y: at(0, 0).y - 30 };
    ix.pointerDown(down(p));
    ix.pointerUp(p);
    expect(store.getState().selection.loads).toEqual([]);
  });

  it("selección por caja (reemplaza) y con Mayús (añade); la caja se publica mientras se arrastra", () => {
    const { store, ix, at, seen } = setup(beamE1Project());
    ix.pointerDown(down({ x: 40, y: 400 }));
    ix.pointerMove({ x: 460, y: 500 });
    expect(seen[seen.length - 1]?.box).toEqual({ a: { x: 40, y: 400 }, b: { x: 460, y: 500 } });
    ix.pointerUp({ x: 460, y: 500 });
    expect(seen[seen.length - 1]?.box).toBeNull();
    expect(store.getState().selection).toEqual({ nodes: ["A"], members: [], loads: [] }); // B queda fuera de la caja
    ix.pointerDown(down({ x: 760, y: 520 }, { shift: true }));
    ix.pointerMove({ x: 640, y: 400 });
    ix.pointerUp({ x: 640, y: 400 });
    expect(store.getState().selection.nodes).toEqual(["A", "B"]);
    expect(at(0, 0).x).toBe(100);
  });

  it("una caja diminuta con Mayús no limpia la selección", () => {
    const { store, ix } = setup(beamE1Project());
    store.select({ nodes: ["A"] });
    ix.pointerDown(down({ x: 500, y: 100 }, { shift: true }));
    ix.pointerUp({ x: 501, y: 100 });
    expect(store.getState().selection.nodes).toEqual(["A"]);
  });

  it("arrastrar un nudo: un solo undo, snap a rejilla y los demás nudos seleccionados lo acompañan", () => {
    const { store, ix, at } = setup(beamE1Project());
    store.select({ nodes: ["A", "B"] });
    ix.pointerDown(down(at(0, 0)));
    ix.pointerMove({ x: at(0, 0).x + 1, y: at(0, 0).y }); // por debajo del umbral
    expect(store.isGrouping()).toBe(false);
    for (let k = 1; k <= 5; k++) ix.pointerMove(at(0, 0.5 * k)); // sube de 0.5 en 0.5 m hasta 2.5 m
    ix.pointerUp(at(0, 2.5));
    expect(store.isGrouping()).toBe(false);
    const p = store.getState().project;
    expect(p.nodes.find((n) => n.id === "A")?.z).toBeCloseTo(2.5, 9);
    expect(p.nodes.find((n) => n.id === "B")?.z).toBeCloseTo(2.5, 9); // se mueve igual
    expect(p.nodes.find((n) => n.id === "B")?.x).toBe(6);
    expect(store.getState().history.undoCount).toBe(1);
    store.undo();
    expect(store.getState().project).toEqual(beamE1Project());
  });

  it("arrastrar un nudo no seleccionado lo selecciona y mueve solo ese", () => {
    const { store, ix, at } = setup(beamE1Project());
    ix.pointerDown(down(at(6, 0)));
    ix.pointerMove({ x: at(6, 0).x + DRAG_THRESHOLD_PX + 37, y: at(6, 0).y }); // 6.4 m -> rejilla 6.5 m
    ix.pointerUp(at(6.4, 0));
    expect(store.getState().selection.nodes).toEqual(["B"]);
    expect(store.getState().project.nodes.find((n) => n.id === "A")?.x).toBe(0);
    expect(store.getState().project.nodes.find((n) => n.id === "B")?.x).not.toBe(6);
  });

  it("Esc durante el arrastre lo revierte sin dejar historial", () => {
    const { store, ix, at } = setup(beamE1Project());
    ix.pointerDown(down(at(6, 0)));
    ix.pointerMove(at(7, 1));
    expect(store.getState().project.nodes.find((n) => n.id === "B")?.x).toBe(7);
    expect(ix.keyDown(key("Escape"))).toBe(true);
    expect(store.getState().project).toEqual(beamE1Project());
    expect(store.getState().history.undoCount).toBe(0);
    ix.pointerUp(at(7, 1)); // sin arrastre activo: no hace nada
    expect(store.getState().history.undoCount).toBe(0);
  });

  it("mover un nudo que invalidaría el modelo se rechaza y muestra el error", () => {
    // Llevar B sobre A deja una barra de longitud 0.
    const { store, ix, at } = setup(beamE1Project());
    ix.pointerDown(down(at(6, 0)));
    ix.pointerMove({ x: at(6, 0).x + 20, y: at(6, 0).y });
    ix.pointerMove(at(0.01, 0.01));
    ix.pointerUp(at(0.01, 0.01));
    expect(store.getState().project.nodes.find((n) => n.id === "B")?.x).not.toBe(0);
    expect(store.getState().lastErrors).not.toBeNull();
  });
});

describe("vista", () => {
  it("la rueda hace zoom alrededor del cursor; el arrastre central y Espacio+arrastre hacen pan", () => {
    const { store, ix } = setup();
    const before = store.getState().view;
    ix.wheel({ x: 400, y: 300 }, -100);
    expect(store.getState().view.zoom).toBeCloseTo(before.zoom * Math.exp(0.15), 9);
    ix.wheel({ x: 400, y: 300 }, 100);
    expect(store.getState().view.zoom).toBeCloseTo(before.zoom, 9);

    ix.pointerDown(down({ x: 300, y: 300 }, { button: 1 }));
    ix.pointerMove({ x: 400, y: 350 });
    ix.pointerUp({ x: 400, y: 350 });
    expect(store.getState().view.cx).toBeCloseTo(before.cx - 1, 9);
    expect(store.getState().view.cz).toBeCloseTo(before.cz + 0.5, 9);

    const v = store.getState().view;
    ix.pointerDown(down({ x: 0, y: 0 }, { space: true }));
    ix.pointerMove({ x: -100, y: 0 });
    ix.pointerUp({ x: -100, y: 0 });
    expect(store.getState().view.cx).toBeCloseTo(v.cx + 1, 9);
    ix.pointerDown(down({ x: 0, y: 0 }, { button: 2 }));
    ix.pointerUp({ x: 0, y: 0 });
    ix.pointerDown(down({ x: 0, y: 0 }, { button: 5 })); // botones no gestionados
    expect(store.getState().history.undoCount).toBe(0);
  });

  it("el puntero fuera del lienzo borra el cursor", () => {
    const { ix } = setup();
    ix.pointerMove({ x: 10, y: 10 });
    expect(ix.getTransient().cursor).not.toBeNull();
    ix.pointerLeave();
    expect(ix.getTransient().cursor).toBeNull();
  });

  it("encuadrar (F) centra el modelo", () => {
    const { store, ix } = setup(beamE1Project());
    expect(ix.keyDown(key("f"))).toBe(true);
    expect(store.getState().view.cx).toBe(3);
    expect(store.getState().view.zoom).toBeCloseTo(Math.min(640 / 6, 200), 9);
  });
});

describe("teclado", () => {
  it("Supr borra la selección; Ctrl+Z deshace; Ctrl+Y y Ctrl+Mayús+Z rehacen; Ctrl+A selecciona todo", () => {
    const { store, ix } = setup(beamE1Project());
    expect(ix.keyDown(key("a", { ctrl: true }))).toBe(true);
    expect(store.getState().selection.nodes).toEqual(["A", "B"]);
    expect(ix.keyDown(key("Delete"))).toBe(true);
    expect(store.getState().project.nodes).toEqual([]);
    expect(ix.keyDown(key("z", { ctrl: true }))).toBe(true);
    expect(store.getState().project).toEqual(beamE1Project());
    expect(ix.keyDown(key("y", { ctrl: true }))).toBe(true);
    expect(store.getState().project.nodes).toEqual([]);
    ix.keyDown(key("z", { ctrl: true }));
    ix.keyDown(key("Z", { ctrl: true, shift: true }));
    expect(store.getState().project.nodes).toEqual([]);
    ix.keyDown(key("z", { ctrl: true }));
    expect(ix.keyDown(key("Backspace"))).toBe(true);
  });

  it("Esc: cancela, luego limpia la selección y por último vuelve a la herramienta Seleccionar", () => {
    const { store, ix } = setup(beamE1Project());
    store.setTool("node");
    store.select({ nodes: ["A"] });
    ix.keyDown(key("Escape"));
    expect(store.getState().selection.nodes).toEqual([]);
    expect(store.getState().tool).toBe("node");
    ix.keyDown(key("Escape"));
    expect(store.getState().tool).toBe("select");
  });

  it("letras de herramienta, zoom y flechas; teclas desconocidas no se consumen", () => {
    const { store, ix } = setup();
    for (const [k, tool] of [["n", "node"], ["B", "member"], ["s", "support"], ["v", "select"]] as const) {
      expect(ix.keyDown(key(k))).toBe(true);
      expect(store.getState().tool).toBe(tool);
    }
    const z0 = store.getState().view.zoom;
    ix.keyDown(key("+"));
    expect(store.getState().view.zoom).toBeCloseTo(z0 * 1.25, 9);
    ix.keyDown(key("-"));
    ix.keyDown(key("="));
    ix.keyDown(key("-"));
    expect(store.getState().view.zoom).toBeCloseTo(z0, 9);
    const c0 = store.getState().view;
    ix.keyDown(key("ArrowRight"));
    expect(store.getState().view.cx).toBeCloseTo(c0.cx + 0.4 * (100 / z0), 9);
    ix.keyDown(key("ArrowLeft"));
    ix.keyDown(key("ArrowUp"));
    ix.keyDown(key("ArrowDown"));
    expect(store.getState().view.cz).toBeCloseTo(c0.cz, 9);
    expect(ix.keyDown(key("q"))).toBe(false);
    expect(ix.keyDown(key("c", { ctrl: true }))).toBe(false);
  });
});
