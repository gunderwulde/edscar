/**
 * Geometría de barra compartida por UI e informes (ADR-001 §3 y §7). Escrito desde cero.
 * - Ejes locales de barra: x de i a j; z de referencia = proyección de +Z global (si la barra es vertical, +X);
 *   y = z × x; `rotation` gira (y, z) alrededor de +x.
 * - Presentación de esfuerzos: N tracción positiva, V = −Vz, M = −My; las ordenadas de N y V se dibujan hacia
 *   +z local y las de M hacia −z local (lado de la fibra traccionada).
 * Toda conversión local↔global de la UI pasa por aquí: nunca se asume que un My local sea un momento global.
 */
import type { Node } from "@edscar/model";
import type { SectionForces } from "@edscar/solver";

export type V3 = readonly [number, number, number];

export interface LocalAxes { x: V3; y: V3; z: V3; length: number }

/** Umbral de verticalidad de ADR-001 §3. */
const VERTICAL_TOL = 1e-9;

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Ejes locales de la barra de `ni` a `nj`. Devuelve null si los nudos coinciden (barra de longitud 0). */
export function memberAxes(ni: Pick<Node, "x" | "y" | "z">, nj: Pick<Node, "x" | "y" | "z">, rotation = 0): LocalAxes | null {
  const d: V3 = [nj.x - ni.x, nj.y - ni.y, nj.z - ni.z];
  const length = Math.hypot(d[0], d[1], d[2]);
  if (!(length > 0)) return null;
  const x: V3 = [d[0] / length, d[1] / length, d[2] / length];
  const ref: V3 = Math.abs(x[2]) > 1 - VERTICAL_TOL ? [1, 0, 0] : [0, 0, 1];
  const k = dot(ref, x);
  const zr: V3 = [ref[0] - k * x[0], ref[1] - k * x[1], ref[2] - k * x[2]];
  const zl = Math.hypot(zr[0], zr[1], zr[2]);
  const z0: V3 = [zr[0] / zl, zr[1] / zl, zr[2] / zl];
  const y0 = cross(z0, x);
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const y: V3 = [c * y0[0] + s * z0[0], c * y0[1] + s * z0[1], c * y0[2] + s * z0[2]];
  const z: V3 = [-s * y0[0] + c * z0[0], -s * y0[1] + c * z0[1], -s * y0[2] + c * z0[2]];
  return { x, y, z, length };
}

/** Vector local (x, y, z) → global. */
export function localToGlobal(ax: LocalAxes, v: V3): V3 {
  return [
    v[0] * ax.x[0] + v[1] * ax.y[0] + v[2] * ax.z[0],
    v[0] * ax.x[1] + v[1] * ax.y[1] + v[2] * ax.z[1],
    v[0] * ax.x[2] + v[1] * ax.y[2] + v[2] * ax.z[2],
  ];
}

export type DiagramKind = "N" | "V" | "M";

/** Valor de presentación de ADR-001 §7 (plano x–z): N, V = −Vz, M = −My. */
export function presentedValue(kind: DiagramKind, s: Pick<SectionForces, "N" | "Vz" | "My">): number {
  if (kind === "N") return s.N;
  return kind === "V" ? -s.Vz : -s.My;
}

/** Signo con el que la ordenada de presentación se aplica a +z local: N y V hacia +z, M hacia −z (fibra traccionada). */
export function diagramSide(kind: DiagramKind): 1 | -1 {
  return kind === "M" ? -1 : 1;
}

/** Unidad de cada diagrama. */
export const DIAGRAM_UNIT: Record<DiagramKind, string> = { N: "kN", V: "kN", M: "kN·m" };
