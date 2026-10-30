/**
 * Transformaciones mundo ↔ pantalla del lienzo 2D (funciones puras).
 * Mundo: plano X–Z en metros, Z hacia arriba (ADR-001). Pantalla: píxeles SVG, y hacia abajo.
 * La vista guarda el punto del modelo en el centro del lienzo (cx, cz) y el zoom en px/m.
 */
import type { Project } from "@edscar/model";
import { MAX_ZOOM, MIN_ZOOM, type ViewState } from "@edscar/ui-state";

export interface Viewport { width: number; height: number }
export interface Point { x: number; y: number }
export interface WorldPoint { x: number; z: number }
export interface Frame { view: ViewState; vp: Viewport }

export function worldToScreen(f: Frame, x: number, z: number): Point {
  return { x: f.vp.width / 2 + (x - f.view.cx) * f.view.zoom, y: f.vp.height / 2 - (z - f.view.cz) * f.view.zoom };
}

export function screenToWorld(f: Frame, p: Point): WorldPoint {
  return { x: f.view.cx + (p.x - f.vp.width / 2) / f.view.zoom, z: f.view.cz - (p.y - f.vp.height / 2) / f.view.zoom };
}

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoom multiplicativo manteniendo fijo el punto del modelo que está bajo `at` (en píxeles). */
export function zoomAt(f: Frame, at: Point, factor: number): ViewState {
  const zoom = clampZoom(f.view.zoom * factor);
  const w = screenToWorld(f, at);
  return {
    zoom,
    cx: w.x - (at.x - f.vp.width / 2) / zoom,
    cz: w.z + (at.y - f.vp.height / 2) / zoom,
  };
}

/** Arrastre del contenido (dxPx, dyPx) píxeles: el modelo sigue al puntero. */
export function panBy(view: ViewState, dxPx: number, dyPx: number): ViewState {
  return { ...view, cx: view.cx - dxPx / view.zoom, cz: view.cz + dyPx / view.zoom };
}

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export function modelBounds(project: Pick<Project, "nodes">): Bounds | null {
  if (project.nodes.length === 0) return null;
  let b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const n of project.nodes) {
    b = { minX: Math.min(b.minX, n.x), maxX: Math.max(b.maxX, n.x), minZ: Math.min(b.minZ, n.z), maxZ: Math.max(b.maxZ, n.z) };
  }
  return b;
}

/** Encuadra `bounds` en el lienzo con un margen en píxeles; el zoom no supera `maxZoom` (un solo nudo no se ampliaría sin fin). */
export function fitView(bounds: Bounds | null, vp: Viewport, padPx = 80, maxZoom = 200): ViewState {
  if (!bounds) return { cx: 3, cz: 1.5, zoom: 60 };
  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxZ - bounds.minZ, 1e-6);
  const zx = (vp.width - 2 * padPx) / w;
  const zz = (vp.height - 2 * padPx) / h;
  const zoom = clampZoom(Math.min(zx, zz, maxZoom));
  return { cx: (bounds.minX + bounds.maxX) / 2, cz: (bounds.minZ + bounds.maxZ) / 2, zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 60 };
}

/** Paso de rejilla (m) de la serie 1-2-5 tal que dos líneas queden al menos `minPx` píxeles separadas. */
export const GRID_MIN_PX = 24;

export function gridStep(zoom: number, minPx = GRID_MIN_PX): number {
  const raw = minPx / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw * (1 - 1e-12)) return m * pow;
  return 10 * pow;
}

/** Redondea a múltiplos de `step` (sin -0). */
export function snapToGrid(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  return r === 0 ? 0 : Number(r.toPrecision(12));
}
