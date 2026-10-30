/** Hit-testing, captura (snap) y selección por caja en coordenadas de pantalla (funciones puras). */
import type { Id, Project } from "@edscar/model";
import { gridStep, screenToWorld, snapToGrid, worldToScreen, type Frame, type Point, type WorldPoint } from "./transform";

export const NODE_TOLERANCE_PX = 9;
export const MEMBER_TOLERANCE_PX = 6;

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Nudo más cercano a `p` dentro de la tolerancia (px), o null. `exclude` omite ids. */
export function hitNode(project: Project, f: Frame, p: Point, tol = NODE_TOLERANCE_PX, exclude?: ReadonlySet<Id>): Id | null {
  let best: Id | null = null;
  let bestD = tol;
  for (const n of project.nodes) {
    if (exclude?.has(n.id)) continue;
    const s = worldToScreen(f, n.x, n.z);
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d <= bestD) {
      best = n.id;
      bestD = d;
    }
  }
  return best;
}

/** Barra más cercana a `p` dentro de la tolerancia (px), o null. */
export function hitMember(project: Project, f: Frame, p: Point, tol = MEMBER_TOLERANCE_PX): Id | null {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  let best: Id | null = null;
  let bestD = tol;
  for (const m of project.members) {
    const a = nodes.get(m.i);
    const b = nodes.get(m.j);
    if (!a || !b) continue;
    const d = distToSegment(p, worldToScreen(f, a.x, a.z), worldToScreen(f, b.x, b.z));
    if (d <= bestD) {
      best = m.id;
      bestD = d;
    }
  }
  return best;
}

/**
 * Selección por caja (ventana): nudos dentro de la caja y barras con AMBOS extremos dentro.
 * Las esquinas de la caja se dan en píxeles en cualquier orden.
 */
export function boxSelect(project: Project, f: Frame, p0: Point, p1: Point): { nodes: Id[]; members: Id[] } {
  const x0 = Math.min(p0.x, p1.x);
  const x1 = Math.max(p0.x, p1.x);
  const y0 = Math.min(p0.y, p1.y);
  const y1 = Math.max(p0.y, p1.y);
  const inside = new Set<Id>();
  for (const n of project.nodes) {
    const s = worldToScreen(f, n.x, n.z);
    if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) inside.add(n.id);
  }
  return {
    nodes: [...inside],
    members: project.members.filter((m) => inside.has(m.i) && inside.has(m.j)).map((m) => m.id),
  };
}

export type SnapKind = "node" | "grid" | "free";
export interface SnapResult extends WorldPoint { kind: SnapKind; nodeId: Id | null }

export interface SnapOptions {
  grid: boolean;
  /** Ids de nudos que no atraen (p. ej. los que se están arrastrando). */
  exclude?: ReadonlySet<Id>;
}

/** Captura prioritaria a nudos cercanos (tolerancia en px); si no, a la rejilla; si no, libre. */
export function snapPoint(project: Project, f: Frame, p: Point, opts: SnapOptions): SnapResult {
  const nodeId = hitNode(project, f, p, NODE_TOLERANCE_PX, opts.exclude);
  if (nodeId !== null) {
    const n = project.nodes.find((q) => q.id === nodeId);
    if (n) return { x: n.x, z: n.z, kind: "node", nodeId };
  }
  const w = screenToWorld(f, p);
  if (opts.grid) {
    const step = gridStep(f.view.zoom);
    return { x: snapToGrid(w.x, step), z: snapToGrid(w.z, step), kind: "grid", nodeId: null };
  }
  return { ...w, kind: "free", nodeId: null };
}
