/** Primitivas geométricas para SVG (cabezas de flecha, arcos de momento, listas de puntos). */
import type { Arc } from "./loadGlyphs";
import type { Point } from "./transform";

const r2 = (n: number): number => Math.round(n * 100) / 100;

export const pointsAttr = (pts: readonly Point[]): string => pts.map((p) => `${String(r2(p.x))},${String(r2(p.y))}`).join(" ");

/** Triángulo de cabeza de flecha con la punta en `head`, orientado de `tail` a `head`. */
export function arrowHead(tail: Point, head: Point, size = 7): string {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return "";
  const ux = dx / len;
  const uy = dy / len;
  const bx = head.x - ux * size;
  const by = head.y - uy * size;
  const w = size * 0.42;
  return pointsAttr([head, { x: bx - uy * w, y: by + ux * w }, { x: bx + uy * w, y: by - ux * w }]);
}

const ARC_SWEEP = (250 * Math.PI) / 180;

/**
 * Arco de momento: 250° con cabeza de flecha. `clockwise` es el sentido en pantalla.
 * Devuelve el trazo `d` y la cabeza (polígono) lista para `points`.
 */
export function arcGeometry(arc: Arc): { d: string; head: string } {
  const sgn = arc.clockwise ? 1 : -1;
  const a0 = arc.clockwise ? (200 * Math.PI) / 180 : (-20 * Math.PI) / 180;
  const a1 = a0 + sgn * ARC_SWEEP;
  const at = (a: number): Point => ({ x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) });
  const p0 = at(a0);
  const p1 = at(a1);
  const d = `M ${String(r2(p0.x))} ${String(r2(p0.y))} A ${String(arc.r)} ${String(arc.r)} 0 1 ${arc.clockwise ? "1" : "0"} ${String(r2(p1.x))} ${String(r2(p1.y))}`;
  // Tangente en el extremo, en el sentido del giro.
  const tan = { x: -Math.sin(a1) * sgn, y: Math.cos(a1) * sgn };
  const tip = { x: p1.x + tan.x * 4, y: p1.y + tan.y * 4 };
  return { d, head: arrowHead(p1, tip, 7) };
}
