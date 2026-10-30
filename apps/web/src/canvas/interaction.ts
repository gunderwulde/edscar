/**
 * Lógica de interacción del lienzo (sin React ni DOM): herramientas, selección, arrastre de nudos, pan/zoom y
 * atajos. Lee el estado del store y solo emite comandos / acciones del store; nunca toca el modelo directamente.
 * Los eventos llegan ya traducidos a coordenadas de pantalla del lienzo.
 */
import type { Id } from "@edscar/model";
import {
  addMemberCommand, addNodeCommand, classifySupport, combine, nextId, setSupportCommand,
  type Command, type EditorStore,
} from "@edscar/ui-state";
import { boxSelect, hitMember, hitNode, snapPoint, type SnapResult } from "./hit";
import { computeLoadScale, hitLoad, loadGlyphs } from "./loadGlyphs";
import { fitView, modelBounds, panBy, zoomAt, type Frame, type Point, type Viewport } from "./transform";

export interface Transient {
  /** Posición del puntero con la captura aplicada (null si el puntero está fuera). */
  cursor: SnapResult | null;
  /** Caja de selección en curso (esquinas en píxeles). */
  box: { a: Point; b: Point } | null;
  /** Nudo inicial de la barra que se está dibujando. */
  memberStart: Id | null;
}

export interface PointerInfo {
  p: Point;
  /** 0 = principal, 1 = central, 2 = secundario. */
  button: number;
  shift: boolean;
  ctrl: boolean;
  /** Barra espaciadora mantenida: el arrastre hace pan. */
  space: boolean;
}

export interface KeyInfo { key: string; ctrl: boolean; shift: boolean }

type Drag =
  | { kind: "pan"; last: Point }
  | { kind: "box"; start: Point; cur: Point; additive: boolean }
  | {
      kind: "move";
      anchor: Id;
      startPx: Point;
      started: boolean;
      origin: Map<Id, { x: number; z: number }>;
      lastDelta: { dx: number; dz: number } | null;
    };

/** Umbral (px) para considerar un arrastre. */
export const DRAG_THRESHOLD_PX = 3;
export const WHEEL_ZOOM_RATE = 0.0015;
const KEY_PAN_PX = 40;
const KEY_ZOOM = 1.25;

export interface Interaction {
  pointerDown(i: PointerInfo): void;
  pointerMove(p: Point): void;
  pointerUp(p: Point): void;
  pointerLeave(): void;
  doubleClick(): void;
  wheel(p: Point, deltaY: number): void;
  /** Devuelve true si la tecla se ha tratado (el llamador hace preventDefault). */
  keyDown(k: KeyInfo): boolean;
  fit(): void;
  /** Cancela arrastres y el dibujo de barra en curso (cambio de herramienta, desmontaje). */
  reset(): void;
  getTransient(): Transient;
}

export function createInteraction(
  store: EditorStore,
  getViewport: () => Viewport,
  onTransient: (t: Transient) => void = () => undefined,
): Interaction {
  let drag: Drag | null = null;
  let memberStart: Id | null = null;
  let cursor: SnapResult | null = null;
  let transient: Transient = { cursor: null, box: null, memberStart: null };

  const frame = (): Frame => ({ view: store.getState().view, vp: getViewport() });

  const publish = (): void => {
    const box = drag?.kind === "box" ? { a: drag.start, b: drag.cur } : null;
    transient = { cursor, box, memberStart };
    onTransient(transient);
  };

  const snap = (p: Point, exclude?: ReadonlySet<Id>): SnapResult => {
    const st = store.getState();
    return snapPoint(st.project, frame(), p, { grid: st.display.snap, ...(exclude ? { exclude } : {}) });
  };

  const endMoveGroup = (cancel: boolean): void => {
    if (drag?.kind === "move" && drag.started) {
      if (cancel) store.cancelGroup();
      else store.endGroup();
    }
  };

  const cancelAll = (): void => {
    endMoveGroup(true);
    drag = null;
    memberStart = null;
    publish();
  };

  const fit = (): void => {
    store.setView(fitView(modelBounds(store.getState().project), getViewport()));
  };

  const memberToolClick = (p: Point): void => {
    const st = store.getState();
    const s = snap(p);
    const cmds: Command[] = [];
    let id = s.nodeId;
    if (id === null) {
      id = nextId(st.project, "node");
      cmds.push(addNodeCommand(st.project, s.x, s.z, id));
    }
    if (memberStart === null) {
      if (cmds.length > 0 && !store.dispatch(combine(cmds)).ok) return;
      memberStart = id;
      return;
    }
    if (id === memberStart) return;
    const start = memberStart;
    const exists = st.project.members.some((m) => (m.i === start && m.j === id) || (m.i === id && m.j === start));
    if (!exists) {
      const mid = nextId(st.project, "member");
      cmds.push(addMemberCommand(st.project, start, id, { id: mid }));
      if (!store.dispatch(combine(cmds, "Dibujar barra")).ok) return;
      store.select({ members: [mid] });
    } else if (cmds.length > 0 && !store.dispatch(combine(cmds)).ok) {
      return;
    }
    memberStart = id;
  };

  const supportToolClick = (p: Point): void => {
    const st = store.getState();
    const node = hitNode(st.project, frame(), p);
    if (node === null) return;
    const existing = st.project.supports.find((s) => s.node === node);
    if (existing && classifySupport(existing.fixed) === st.supportPreset) {
      store.dispatch({ type: "support.remove", payload: { id: existing.id } });
    } else {
      store.dispatch(setSupportCommand(st.project, node, st.supportPreset));
    }
    store.select({ nodes: [node] });
  };

  const selectToolDown = (i: PointerInfo): void => {
    const st = store.getState();
    const f = frame();
    const additive = i.shift || i.ctrl;
    const node = hitNode(st.project, f, i.p);
    if (node !== null) {
      if (additive) {
        store.select({ nodes: [node] }, "toggle");
        return;
      }
      if (!st.selection.nodes.includes(node)) store.select({ nodes: [node] });
      const origin = new Map<Id, { x: number; z: number }>();
      for (const id of store.getState().selection.nodes) {
        const n = st.project.nodes.find((q) => q.id === id);
        if (n) origin.set(id, { x: n.x, z: n.z });
      }
      drag = { kind: "move", anchor: node, startPx: i.p, started: false, origin, lastDelta: null };
      return;
    }
    const hidden = new Set(st.hiddenPatterns);
    const load = st.display.loads
      ? hitLoad(loadGlyphs(st.project, f, hidden, computeLoadScale(st.project, hidden)), i.p)
      : null;
    if (load !== null) {
      store.select({ loads: [load] }, additive ? "toggle" : "replace");
      return;
    }
    const member = hitMember(st.project, f, i.p);
    if (member !== null) {
      store.select({ members: [member] }, additive ? "toggle" : "replace");
      return;
    }
    drag = { kind: "box", start: i.p, cur: i.p, additive };
  };

  return {
    pointerDown(i) {
      if (i.button === 1 || i.button === 2 || (i.button === 0 && i.space)) {
        drag = { kind: "pan", last: i.p };
        publish();
        return;
      }
      if (i.button !== 0) return;
      const st = store.getState();
      switch (st.tool) {
        case "select":
          selectToolDown(i);
          break;
        case "node": {
          const s = snap(i.p);
          if (s.nodeId !== null) {
            store.select({ nodes: [s.nodeId] });
          } else {
            const id = nextId(st.project, "node");
            if (store.dispatch(addNodeCommand(st.project, s.x, s.z, id)).ok) store.select({ nodes: [id] });
          }
          break;
        }
        case "member":
          memberToolClick(i.p);
          break;
        case "support":
          supportToolClick(i.p);
          break;
      }
      publish();
    },

    pointerMove(p) {
      const st = store.getState();
      const moving = drag?.kind === "move" && drag.started ? new Set(drag.origin.keys()) : undefined;
      cursor = snap(p, moving);
      if (drag?.kind === "pan") {
        store.setView(panBy(st.view, p.x - drag.last.x, p.y - drag.last.y));
        drag.last = p;
      } else if (drag?.kind === "box") {
        drag.cur = p;
      } else if (drag?.kind === "move") {
        if (!drag.started) {
          if (Math.hypot(p.x - drag.startPx.x, p.y - drag.startPx.y) < DRAG_THRESHOLD_PX) {
            publish();
            return;
          }
          drag.started = true;
          store.beginGroup("Mover nudos");
          cursor = snap(p, new Set(drag.origin.keys()));
        }
        const a = drag.origin.get(drag.anchor);
        if (a) {
          const dx = cursor.x - a.x;
          const dz = cursor.z - a.z;
          if (!drag.lastDelta || drag.lastDelta.dx !== dx || drag.lastDelta.dz !== dz) {
            drag.lastDelta = { dx, dz };
            for (const [id, o] of drag.origin) {
              store.dispatch({ type: "node.move", payload: { id, x: o.x + dx, z: o.z + dz } });
            }
          }
        }
      }
      publish();
    },

    pointerUp(p) {
      if (drag?.kind === "box") {
        const st = store.getState();
        const moved = Math.hypot(p.x - drag.start.x, p.y - drag.start.y) >= DRAG_THRESHOLD_PX + 1;
        if (!moved) {
          if (!drag.additive) store.clearSelection();
        } else {
          const sel = boxSelect(st.project, frame(), drag.start, p);
          store.select(sel, drag.additive ? "add" : "replace");
        }
      } else {
        endMoveGroup(false);
      }
      drag = null;
      publish();
    },

    pointerLeave() {
      cursor = null;
      publish();
    },

    doubleClick() {
      memberStart = null;
      publish();
    },

    wheel(p, deltaY) {
      store.setView(zoomAt(frame(), p, Math.exp(-deltaY * WHEEL_ZOOM_RATE)));
    },

    keyDown(k) {
      const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
      const mod = k.ctrl;
      if (mod && key === "z") {
        if (k.shift) store.redo();
        else store.undo();
        return true;
      }
      if (mod && key === "y") {
        store.redo();
        return true;
      }
      if (mod && key === "a") {
        store.selectAll();
        return true;
      }
      if (mod) return false;
      switch (key) {
        case "Delete":
        case "Backspace":
          store.deleteSelection();
          return true;
        case "Escape": {
          const st = store.getState();
          if (drag || memberStart !== null) cancelAll();
          else if (st.selection.nodes.length + st.selection.members.length + st.selection.loads.length > 0) store.clearSelection();
          else store.setTool("select");
          return true;
        }
        case "v": store.setTool("select"); cancelAll(); return true;
        case "n": store.setTool("node"); cancelAll(); return true;
        case "b": store.setTool("member"); cancelAll(); return true;
        case "s": store.setTool("support"); cancelAll(); return true;
        case "f":
          fit();
          return true;
        case "+":
        case "=": {
          const f = frame();
          store.setView(zoomAt(f, { x: f.vp.width / 2, y: f.vp.height / 2 }, KEY_ZOOM));
          return true;
        }
        case "-": {
          const f = frame();
          store.setView(zoomAt(f, { x: f.vp.width / 2, y: f.vp.height / 2 }, 1 / KEY_ZOOM));
          return true;
        }
        case "ArrowLeft": store.setView(panBy(store.getState().view, KEY_PAN_PX, 0)); return true;
        case "ArrowRight": store.setView(panBy(store.getState().view, -KEY_PAN_PX, 0)); return true;
        case "ArrowUp": store.setView(panBy(store.getState().view, 0, KEY_PAN_PX)); return true;
        case "ArrowDown": store.setView(panBy(store.getState().view, 0, -KEY_PAN_PX)); return true;
        default:
          return false;
      }
    },

    fit,
    reset: cancelAll,
    getTransient: () => transient,
  };
}
