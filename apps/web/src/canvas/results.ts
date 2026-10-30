/**
 * Geometría de resultados del solver en pantalla (funciones puras): diagramas N/V/M, deformada y reacciones.
 * Presentación de esfuerzos: ADR-001 §7 (N tracción +, V = −Vz, M = −My; M se dibuja del lado de la fibra
 * traccionada). La conversión de signos vive en @edscar/ui-state (`presentedValue`, `diagramSide`).
 */
import type { Id, Node, Project } from "@edscar/model";
import { diagramSide, DIAGRAM_UNIT, memberAxes, presentedValue, type DiagramKind } from "@edscar/ui-state";
import type { SectionForces, SolveResult } from "@edscar/solver";
import { formatNumber } from "./format";
import { arrowLength, type Arc, type Arrow } from "./loadGlyphs";
import { modelBounds, worldToScreen, type Frame, type Point } from "./transform";

export const DIAGRAM_MAX_PX = 70;
export const DEFORM_TARGET_FRACTION = 0.08;

/** Píxeles por unidad de esfuerzo para que el valor máximo mida `targetPx`. 0 si no hay valores. */
export function diagramScale(maxAbs: number, targetPx = DIAGRAM_MAX_PX): number {
  return maxAbs > 1e-12 ? targetPx / maxAbs : 0;
}

/** Mayor valor absoluto (de presentación) del diagrama `kind` en todas las barras del resultado. */
export function maxAbsDiagram(result: SolveResult, kind: DiagramKind): number {
  let m = 0;
  for (const mr of result.members) for (const s of mr.stations) m = Math.max(m, Math.abs(presentedValue(kind, s)));
  return m;
}

export interface DiagramLabel { x: number; y: number; text: string; value: number }
export interface DiagramShape {
  memberId: Id;
  /** Polígono cerrado: baseline → ordenadas → baseline. */
  polygon: Point[];
  /** Solo la línea de ordenadas (sin cierre). */
  outline: Point[];
  labels: DiagramLabel[];
}

function nodesById(project: Project): Map<Id, Node> {
  return new Map(project.nodes.map((n) => [n.id, n]));
}

/**
 * Diagrama de una barra. Las estaciones duplicadas (misma x, left/right) generan un salto vertical: no se
 * deduplican. Ordenada positiva: N y V hacia +z local, M hacia −z local.
 */
export function memberDiagram(
  project: Project,
  result: SolveResult,
  memberId: Id,
  kind: DiagramKind,
  f: Frame,
  pxPerUnit: number,
): DiagramShape | null {
  const member = project.members.find((m) => m.id === memberId);
  const mr = result.members.find((m) => m.member === memberId);
  if (!member || !mr || mr.stations.length < 2) return null;
  const nodes = nodesById(project);
  const ni = nodes.get(member.i);
  const nj = nodes.get(member.j);
  if (!ni || !nj) return null;
  const axes = memberAxes(ni, nj, member.rotation ?? 0);
  if (!axes) return null;
  const a = worldToScreen(f, ni.x, ni.z);
  const b = worldToScreen(f, nj.x, nj.z);
  const zs: Point = { x: axes.z[0], y: -axes.z[2] }; // +z local en pantalla
  const side = diagramSide(kind);

  const base = (s: SectionForces): Point => {
    const t = s.x / axes.length;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const outline: Point[] = mr.stations.map((s) => {
    const p = base(s);
    const o = presentedValue(kind, s) * side * pxPerUnit;
    return { x: p.x + zs.x * o, y: p.y + zs.y * o };
  });
  const first = mr.stations[0];
  const last = mr.stations[mr.stations.length - 1];
  if (!first || !last) return null;
  const polygon = [base(first), ...outline, base(last)];

  // Rótulos: valor de mayor módulo y, si es relevante, el extremo de signo contrario.
  const vals = mr.stations.map((s) => presentedValue(kind, s));
  let iMax = 0;
  let iPos = -1;
  let iNeg = -1;
  vals.forEach((v, k) => {
    if (Math.abs(v) > Math.abs(vals[iMax] ?? 0)) iMax = k;
    if (v > 0 && (iPos < 0 || v > (vals[iPos] ?? 0))) iPos = k;
    if (v < 0 && (iNeg < 0 || v < (vals[iNeg] ?? 0))) iNeg = k;
  });
  const peak = Math.abs(vals[iMax] ?? 0);
  const picks = new Set<number>();
  if (peak > 1e-9) {
    picks.add(iMax);
    const other = (vals[iMax] ?? 0) > 0 ? iNeg : iPos;
    if (other >= 0 && Math.abs(vals[other] ?? 0) >= 0.25 * peak) picks.add(other);
  }
  const labels: DiagramLabel[] = [...picks].map((k) => {
    const v = vals[k] ?? 0;
    const p = outline[k] ?? a;
    const dirSign = Math.sign(v * side) || 1;
    return {
      x: p.x + zs.x * dirSign * 10,
      y: p.y + zs.y * dirSign * 10 + 4,
      text: `${formatNumber(v)} ${DIAGRAM_UNIT[kind]}`,
      value: v,
    };
  });
  return { memberId, polygon, outline, labels };
}

// --- deformada ---------------------------------------------------------------------------------------

/**
 * Polinomio cúbico de Hermite: flecha w(ξ·L) con flechas w0, w1 y pendientes s0, s1 (dw/dx) en los extremos,
 * ξ ∈ [0, 1]. Es exacta para una barra sin cargas intermedias.
 */
export function hermite(L: number, w0: number, s0: number, w1: number, s1: number, xi: number): number {
  const x2 = xi * xi;
  const x3 = x2 * xi;
  return (2 * x3 - 3 * x2 + 1) * w0 + (x3 - 2 * x2 + xi) * L * s0 + (-2 * x3 + 3 * x2) * w1 + (x3 - x2) * L * s1;
}

/** Mayor traslación (m) del resultado, mirando desplazamientos nodales y la deformada discretizada. */
export function maxDisplacement(result: SolveResult): number {
  let m = 0;
  for (const d of Object.values(result.displacements)) m = Math.max(m, Math.hypot(d[0], d[2]));
  for (const st of Object.values(result.deflections ?? {})) for (const s of st) m = Math.max(m, Math.hypot(s.d[0], s.d[2]));
  return m;
}

/** Factor de amplificación automático: el mayor desplazamiento se dibuja como el 8 % de la dimensión del modelo. */
export function autoDeformScale(project: Project, result: SolveResult): number {
  const b = modelBounds(project);
  const size = b ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1) : 1;
  const m = maxDisplacement(result);
  return m > 1e-12 ? (DEFORM_TARGET_FRACTION * size) / m : 1;
}

export interface DeformedShape { memberId: Id; points: Point[]; approximate: boolean }

const SAMPLES = 24;

/**
 * Deformada de una barra a escala `scale`. Usa `result.deflections` si el solver las entrega (exacta, ADR-006 §3).
 * Si no, interpola con un cúbico de Hermite usando los desplazamientos y giros nodales (aproximada: ignora las cargas
 * intermedias); con liberaciones en la barra o GDL indeterminados en sus nudos, dibuja la cuerda (`approximate`).
 */
export function deformedMember(project: Project, result: SolveResult, memberId: Id, scale: number, f: Frame): DeformedShape | null {
  const member = project.members.find((m) => m.id === memberId);
  if (!member) return null;
  const nodes = nodesById(project);
  const ni = nodes.get(member.i);
  const nj = nodes.get(member.j);
  const di = result.displacements[member.i];
  const dj = result.displacements[member.j];
  if (!ni || !nj) return null;
  const dx = nj.x - ni.x;
  const dz = nj.z - ni.z;
  const L = Math.hypot(dx, dz);
  if (!(L > 0)) return null;
  const to = (x: number, z: number): Point => worldToScreen(f, x, z);

  const defl = result.deflections?.[memberId];
  if (defl && defl.length >= 2) {
    return {
      memberId, approximate: false,
      points: defl.map((s) => {
        const t = s.x / L;
        return to(ni.x + dx * t + scale * s.d[0], ni.z + dz * t + scale * s.d[2]);
      }),
    };
  }
  if (!di || !dj) return null;
  const tx = dx / L;
  const tz = dz / L;
  const nx = -tz;
  const nz = tx;
  const rel = member.releases;
  const hasRelease = [rel?.i, rel?.j].some((r) => r !== undefined && Object.values(r).some(Boolean));
  const indet = (result.indeterminateDofs?.[member.i]?.length ?? 0) > 0 || (result.indeterminateDofs?.[member.j]?.length ?? 0) > 0;
  const axial0 = di[0] * tx + di[2] * tz;
  const axial1 = dj[0] * tx + dj[2] * tz;
  const w0 = di[0] * nx + di[2] * nz;
  const w1 = dj[0] * nx + dj[2] * nz;
  const exact = !hasRelease && !indet;
  const n = exact ? SAMPLES : 1;
  const points: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const xi = k / n;
    const a = axial0 + (axial1 - axial0) * xi;
    // Giro ry > 0 inclina la tangente hacia −z (ADR-001 §4): la pendiente transversal es −ry.
    const w = exact ? hermite(L, w0, -di[4], w1, -dj[4], xi) : w0 + (w1 - w0) * xi;
    points.push(to(ni.x + dx * xi + scale * (a * tx + w * nx), ni.z + dz * xi + scale * (a * tz + w * nz)));
  }
  return { memberId, points, approximate: true };
}

// --- reacciones --------------------------------------------------------------------------------------

export interface ReactionGlyph { node: Id; arrow: Arrow | null; arc: Arc | null; label: { x: number; y: number; text: string } }

export const REACTION_STANDOFF_PX = 18;
const EPS = 1e-6;

export function reactionGlyphs(project: Project, result: SolveResult, f: Frame): ReactionGlyph[] {
  const entries = Object.entries(result.reactions);
  let maxF = 0;
  for (const [, r] of entries) maxF = Math.max(maxF, Math.hypot(r[0], r[2]));
  const out: ReactionGlyph[] = [];
  for (const [id, r] of entries) {
    const n = project.nodes.find((q) => q.id === id);
    if (!n) continue;
    const s = worldToScreen(f, n.x, n.z);
    const mag = Math.hypot(r[0], r[2]);
    const parts: string[] = [];
    let arrow: Arrow | null = null;
    let lx = s.x + 22;
    let ly = s.y + 22;
    if (mag > EPS) {
      const dir = { x: r[0] / mag, y: -r[2] / mag };
      const head = { x: s.x - dir.x * REACTION_STANDOFF_PX, y: s.y - dir.y * REACTION_STANDOFF_PX };
      const len = arrowLength(mag, maxF, 50, 14);
      arrow = { head, tail: { x: head.x - dir.x * len, y: head.y - dir.y * len } };
      lx = arrow.tail.x + 6;
      ly = arrow.tail.y + (dir.y < 0 ? 14 : -4);
      if (Math.abs(r[0]) > EPS) parts.push(`Rx=${formatNumber(r[0])}`);
      if (Math.abs(r[2]) > EPS) parts.push(`Rz=${formatNumber(r[2])}`);
    }
    const my = r[4];
    const hasM = Math.abs(my) > EPS;
    let text = parts.join(", ");
    if (text) text += hasM ? " kN | " : " kN";
    if (hasM) text += `My=${formatNumber(my)} kN·m`;
    if (!text) continue;
    out.push({
      node: id, arrow, label: { x: lx, y: ly, text },
      arc: hasM ? { cx: s.x, cy: s.y, r: 22, clockwise: my > 0 } : null,
    });
  }
  return out;
}
