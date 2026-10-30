/**
 * Ejes locales de barra (ADR-001 §3), escrito desde cero.
 * - x local: de i a j.
 * - z local de referencia: proyección de Z global sobre el plano perpendicular a x (normalizada). Si la barra es
 *   vertical (|x·Z| > 1 − 1e-9) se toma +X global (proyectado sobre el plano perpendicular a x, que para una barra
 *   exactamente vertical es +X).
 * - y = z × x. `rotation` ρ gira (y, z) alrededor de +x: y' = cos ρ·y + sin ρ·z, z' = −sin ρ·y + cos ρ·z.
 */

export type V3 = readonly [number, number, number];

export interface LocalAxes {
  x: V3;
  y: V3;
  z: V3;
  length: number;
}

/** Umbral de verticalidad de ADR-001 §3. */
export const VERTICAL_TOL = 1e-9;

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / norm(a));

/**
 * Ejes locales de la barra de `pi` a `pj` (longitud > 0, garantizada por validateProject).
 * `snapRotation`: en "2D-XZ" la rotación es 0 o π (ADR-001 §2.1); se usa cos ρ = ±1 y sin ρ = 0 exactos para no
 * introducir componentes fuera del plano por redondeo de sin(π).
 */
export function localAxes(pi: V3, pj: V3, rotation = 0, snapRotation = false): LocalAxes {
  const d = sub(pj, pi);
  const length = norm(d);
  const x = scale(d, 1 / length);
  const ref: V3 = Math.abs(x[2]) > 1 - VERTICAL_TOL ? [1, 0, 0] : [0, 0, 1];
  const z0 = unit(sub(ref, scale(x, dot(ref, x))));
  const y0 = cross(z0, x);
  let c = Math.cos(rotation);
  let s = Math.sin(rotation);
  if (snapRotation) {
    c = c >= 0 ? 1 : -1;
    s = 0;
  }
  const y: V3 = [c * y0[0] + s * z0[0], c * y0[1] + s * z0[1], c * y0[2] + s * z0[2]];
  const z: V3 = [-s * y0[0] + c * z0[0], -s * y0[1] + c * z0[1], -s * y0[2] + c * z0[2]];
  return { x, y, z, length };
}

/** Componentes locales (x, y, z) de un vector global. */
export const toLocal = (ax: LocalAxes, v: V3): V3 => [dot(ax.x, v), dot(ax.y, v), dot(ax.z, v)];
