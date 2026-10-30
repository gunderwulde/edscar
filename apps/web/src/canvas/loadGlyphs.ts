/**
 * Geometría de los símbolos de carga (en coordenadas de pantalla). Funciones puras, sin React.
 * - Cargas puntuales/nodales: flecha con cabeza en el punto de aplicación, longitud proporcional al módulo.
 * - Distribuidas: flechas repartidas + relleno (polígono) entre la barra y las colas; trapezoidales con w1 en `a`
 *   y w2 en `b` (ADR-001 §5).
 * - Momentos: arco con sentido (My > 0 = giro de +x hacia −z = sentido horario en pantalla con Z arriba).
 * Los vectores se pasan siempre a ejes globales con los ejes locales de la barra (nunca por nombre de eje).
 */
import type { Id, Load, LoadFrame, Project, Vec3 } from "@edscar/model";
import { localToGlobal, memberAxes, type LocalAxes } from "@edscar/ui-state";
import { formatNumber } from "./format";
import { worldToScreen, type Frame, type Point } from "./transform";

export const ARROW_MAX_PX = 56;
export const ARROW_MIN_PX = 8;
export const ARROW_SPACING_PX = 28;
const STANDOFF_PX = 4;
const ARC_RADIUS_PX = 14;

/** Longitud en px de una flecha de módulo `value` si la mayor (`max`) mide `maxPx`; mínimo `minPx` para valores no nulos. */
export function arrowLength(value: number, max: number, maxPx = ARROW_MAX_PX, minPx = ARROW_MIN_PX): number {
  const v = Math.abs(value);
  if (!(v > 0) || !(max > 0)) return 0;
  return Math.max(minPx, (maxPx * v) / max);
}

export interface Arrow { tail: Point; head: Point }
export interface Arc { cx: number; cy: number; r: number; clockwise: boolean }
export interface LoadGlyph {
  loadId: Id;
  patternId: Id;
  type: Load["type"];
  arrows: Arrow[];
  /** Polígono de relleno de una distribuida. */
  fill: Point[] | null;
  arc: Arc | null;
  label: { x: number; y: number; text: string };
  /** Punto de captura para seleccionar la carga con el ratón. */
  anchor: Point;
  dashed: boolean;
}

export interface LoadScale { maxForce: number; maxLine: number }

interface MemberGeo { a: Point; b: Point; L: number; axes: LocalAxes }

/** Vector global (x, z) de un vector de carga dado en el marco indicado. */
export function globalXZ(v: Vec3, frame: LoadFrame, axes: LocalAxes | null): [number, number] {
  if (frame === "global" || !axes) return [v[0], v[2]];
  const g = localToGlobal(axes, v);
  return [g[0], g[2]];
}

function memberGeometry(project: Project, f: Frame): Map<Id, MemberGeo> {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const out = new Map<Id, MemberGeo>();
  for (const m of project.members) {
    const ni = nodes.get(m.i);
    const nj = nodes.get(m.j);
    if (!ni || !nj) continue;
    const axes = memberAxes(ni, nj, m.rotation ?? 0);
    if (!axes) continue;
    out.set(m.id, { a: worldToScreen(f, ni.x, ni.z), b: worldToScreen(f, nj.x, nj.z), L: axes.length, axes });
  }
  return out;
}

/** Máximos de fuerza (kN, cargas nodales y puntuales) y de carga lineal (kN/m) entre las cargas visibles. */
export function computeLoadScale(project: Project, hidden: ReadonlySet<Id>): LoadScale {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const axesOf = new Map<Id, LocalAxes | null>();
  for (const m of project.members) {
    const ni = nodes.get(m.i);
    const nj = nodes.get(m.j);
    axesOf.set(m.id, ni && nj ? memberAxes(ni, nj, m.rotation ?? 0) : null);
  }
  let maxForce = 0;
  let maxLine = 0;
  for (const l of project.loads) {
    if (hidden.has(l.pattern)) continue;
    switch (l.type) {
      case "nodal":
        maxForce = Math.max(maxForce, Math.hypot(l.f[0], l.f[2]));
        break;
      case "member-point":
        maxForce = Math.max(maxForce, Math.hypot(...globalXZ(l.p, l.frame, axesOf.get(l.member) ?? null)));
        break;
      case "member-uniform":
        maxLine = Math.max(maxLine, Math.hypot(...globalXZ(l.w, l.frame, axesOf.get(l.member) ?? null)));
        break;
      case "member-trapezoid": {
        const ax = axesOf.get(l.member) ?? null;
        maxLine = Math.max(maxLine, Math.hypot(...globalXZ(l.w1, l.frame, ax)), Math.hypot(...globalXZ(l.w2, l.frame, ax)));
        break;
      }
      default:
        break;
    }
  }
  return { maxForce, maxLine };
}

const unitScreen = (gx: number, gz: number): Point => {
  const m = Math.hypot(gx, gz);
  return { x: gx / m, y: -gz / m };
};

function comps(v: Vec3, frame: LoadFrame, name: string): string {
  const tick = frame === "local" ? "'" : "";
  const parts: string[] = [];
  if (v[0] !== 0) parts.push(`${name}x${tick}=${formatNumber(v[0])}`);
  if (v[1] !== 0) parts.push(`${name}y${tick}=${formatNumber(v[1])}`);
  if (v[2] !== 0) parts.push(`${name}z${tick}=${formatNumber(v[2])}`);
  return parts.join(", ");
}

function rangeComps(v1: Vec3, v2: Vec3, frame: LoadFrame, name: string): string {
  const tick = frame === "local" ? "'" : "";
  const parts: string[] = [];
  (["x", "y", "z"] as const).forEach((ax, k) => {
    const a = v1[k] ?? 0;
    const b = v2[k] ?? 0;
    if (a !== 0 || b !== 0) parts.push(`${name}${ax}${tick}=${formatNumber(a)}→${formatNumber(b)}`);
  });
  return parts.join(", ");
}

const add = (p: Point, d: Point, s: number): Point => ({ x: p.x + d.x * s, y: p.y + d.y * s });

function singleArrow(head: Point, dir: Point, len: number): Arrow {
  const h = add(head, dir, -STANDOFF_PX);
  return { head: h, tail: add(h, dir, -len) };
}

/** Momento (vector) de un marco cualquiera a ejes globales. */
function momentGlobal(v: Vec3, frame: LoadFrame, axes: LocalAxes): Vec3 {
  return frame === "global" ? v : localToGlobal(axes, v);
}

/** Símbolos de todas las cargas de patrones visibles. `hidden` = ids de patrones ocultos. */
export function loadGlyphs(project: Project, f: Frame, hidden: ReadonlySet<Id>, scale?: LoadScale): LoadGlyph[] {
  const sc = scale ?? computeLoadScale(project, hidden);
  const geo = memberGeometry(project, f);
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const stack = new Map<string, number>();
  const out: LoadGlyph[] = [];

  for (const l of project.loads) {
    if (hidden.has(l.pattern)) continue;
    const base = { loadId: l.id, patternId: l.pattern, type: l.type, fill: null, arc: null, dashed: false } as const;
    const tag = `${l.pattern}: `;

    if (l.type === "nodal" || l.type === "support-displacement") {
      const n = nodes.get(l.node);
      if (!n) continue;
      const s = worldToScreen(f, n.x, n.z);
      if (l.type === "support-displacement") {
        const dx = l.d[0];
        const dz = l.d[2];
        const ry = l.d[4];
        const arrows: Arrow[] = [];
        if (dx !== 0 || dz !== 0) arrows.push(singleArrow(s, unitScreen(dx, dz), 26));
        const text = [dx !== 0 ? `δx=${formatNumber(dx)}` : "", dz !== 0 ? `δz=${formatNumber(dz)}` : "", ry !== 0 ? `θy=${formatNumber(ry)}` : ""]
          .filter(Boolean).join(", ");
        out.push({
          ...base, arrows, dashed: true,
          arc: ry !== 0 ? { cx: s.x, cy: s.y, r: ARC_RADIUS_PX, clockwise: ry > 0 } : null,
          label: { x: s.x + 8, y: s.y + 22, text: `${tag}${text} m` }, anchor: { x: s.x, y: s.y + 14 },
        });
        continue;
      }
      const mag = Math.hypot(l.f[0], l.f[2]);
      const arrows: Arrow[] = [];
      let anchor: Point = { x: s.x, y: s.y - 14 };
      let lx = s.x + 8;
      let ly = s.y - 18;
      if (mag > 0) {
        const ar = singleArrow(s, unitScreen(l.f[0], l.f[2]), arrowLength(mag, sc.maxForce));
        arrows.push(ar);
        anchor = { x: (ar.head.x + ar.tail.x) / 2, y: (ar.head.y + ar.tail.y) / 2 };
        lx = ar.tail.x + 6;
        ly = ar.tail.y - 4;
      }
      const my = l.m[1];
      const text = [comps(l.f, "global", "F"), my !== 0 ? `My=${formatNumber(my)}` : ""].filter(Boolean).join("; ");
      const unit = my !== 0 && mag > 0 ? " kN | kN·m" : my !== 0 ? " kN·m" : " kN";
      out.push({
        ...base, arrows, label: { x: lx, y: ly, text: `${tag}${text}${unit}` }, anchor,
        arc: my !== 0 ? { cx: s.x, cy: s.y, r: ARC_RADIUS_PX, clockwise: my > 0 } : null,
      });
      continue;
    }

    const g = geo.get(l.member);
    if (!g) continue;
    const axes = g.axes;

    if (l.type === "thermal") {
      const mid = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      const key = `${l.member}|t`;
      const off = stack.get(key) ?? 0;
      stack.set(key, off + 14);
      const text = `${tag}ΔT=${formatNumber(l.dT)} °C${l.gradientZ ? `, ∇z=${formatNumber(l.gradientZ)} °C/m` : ""}`;
      out.push({ ...base, arrows: [], label: { x: mid.x + 6, y: mid.y - 10 - off, text }, anchor: { x: mid.x, y: mid.y - 10 - off }, dashed: true });
      continue;
    }

    if (l.type === "member-point") {
      const t = Math.min(1, Math.max(0, l.relative ? l.at : l.at / g.L));
      const s = { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
      const [gx, gz] = globalXZ(l.p, l.frame, axes);
      const mag = Math.hypot(gx, gz);
      const arrows: Arrow[] = [];
      let anchor: Point = { x: s.x, y: s.y - 14 };
      let lx = s.x + 8;
      let ly = s.y - 18;
      if (mag > 0) {
        const ar = singleArrow(s, unitScreen(gx, gz), arrowLength(mag, sc.maxForce));
        arrows.push(ar);
        anchor = { x: (ar.head.x + ar.tail.x) / 2, y: (ar.head.y + ar.tail.y) / 2 };
        lx = ar.tail.x + 6;
        ly = ar.tail.y - 4;
      }
      const mY = l.m ? momentGlobal(l.m, l.frame, axes)[1] : 0;
      const text = [comps(l.p, l.frame, "P"), mY !== 0 ? `My=${formatNumber(mY)}` : ""].filter(Boolean).join("; ");
      out.push({
        ...base, arrows, label: { x: lx, y: ly, text: `${tag}${text}${mY !== 0 ? " kN | kN·m" : " kN"}` }, anchor,
        arc: mY !== 0 ? { cx: s.x, cy: s.y, r: ARC_RADIUS_PX, clockwise: mY > 0 } : null,
      });
      continue;
    }

    // Distribuidas: uniforme (w1 = w2) y trapezoidal.
    const w1 = l.type === "member-uniform" ? l.w : l.w1;
    const w2 = l.type === "member-uniform" ? l.w : l.w2;
    const a = l.type === "member-uniform" ? (l.a ?? 0) : l.a;
    const b = l.type === "member-uniform" ? (l.b ?? g.L) : l.b;
    const [x1, z1] = globalXZ(w1, l.frame, axes);
    const [x2, z2] = globalXZ(w2, l.frame, axes);
    const m1 = Math.hypot(x1, z1);
    const m2 = Math.hypot(x2, z2);
    if (m1 === 0 && m2 === 0) continue;
    const ta = Math.min(1, Math.max(0, a / g.L));
    const tb = Math.min(1, Math.max(0, b / g.L));
    const P = (t: number): Point => ({ x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t });
    const pa = P(ta);
    const pb = P(tb);
    const lenPx = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const dirAt = (s: number): Point => {
      const gx = x1 + (x2 - x1) * s;
      const gz = z1 + (z2 - z1) * s;
      return Math.hypot(gx, gz) > 0 ? unitScreen(gx, gz) : unitScreen(m1 > 0 ? x1 : x2, m1 > 0 ? z1 : z2);
    };
    const magAt = (s: number): number => Math.hypot(x1 + (x2 - x1) * s, z1 + (z2 - z1) * s);

    // Apilado: las cargas de distintos patrones sobre la misma cara de la barra se alejan unas de otras.
    const dirMid = dirAt(0.5);
    const nrm = { x: -(g.b.y - g.a.y), y: g.b.x - g.a.x };
    const side = dirMid.x * nrm.x + dirMid.y * nrm.y >= 0 ? "+" : "-";
    const key = `${l.member}|${side}`;
    const offset = stack.get(key) ?? 0;
    stack.set(key, offset + Math.max(arrowLength(m1, sc.maxLine), arrowLength(m2, sc.maxLine)) + 10);

    const n = Math.max(2, Math.round(lenPx / ARROW_SPACING_PX) + 1);
    const arrows: Arrow[] = [];
    for (let k = 0; k < n; k++) {
      const s = k / (n - 1);
      const len = arrowLength(magAt(s), sc.maxLine);
      if (len < 1) continue;
      const dir = dirAt(s);
      const head = add(P(ta + (tb - ta) * s), dir, -(offset + STANDOFF_PX));
      arrows.push({ head, tail: add(head, dir, -len) });
    }
    const d0 = dirAt(0);
    const d1 = dirAt(1);
    const h0 = add(pa, d0, -(offset + STANDOFF_PX));
    const h1 = add(pb, d1, -(offset + STANDOFF_PX));
    const t0 = add(h0, d0, -arrowLength(m1, sc.maxLine));
    const t1 = add(h1, d1, -arrowLength(m2, sc.maxLine));
    const tailMid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
    const text = l.type === "member-uniform" ? comps(w1, l.frame, "w") : rangeComps(w1, w2, l.frame, "w");
    out.push({
      ...base, arrows, fill: [h0, t0, t1, h1],
      label: { x: tailMid.x, y: tailMid.y + (dirMid.y > 0 ? 14 : -6), text: `${tag}${text} kN/m` },
      anchor: tailMid,
    });
  }
  return out;
}

/** Carga cuyo símbolo (flechas, relleno o ancla) está más cerca de `p` dentro de `tol` px, o null. */
export function hitLoad(glyphs: readonly LoadGlyph[], p: Point, tol = 8): Id | null {
  let best: Id | null = null;
  let bestD = tol;
  const seg = (a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  for (const g of glyphs) {
    let d = Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y);
    for (const ar of g.arrows) d = Math.min(d, seg(ar.tail, ar.head));
    if (g.arc) d = Math.min(d, Math.abs(Math.hypot(p.x - g.arc.cx, p.y - g.arc.cy) - g.arc.r));
    if (d <= bestD) {
      best = g.loadId;
      bestD = d;
    }
  }
  return best;
}
