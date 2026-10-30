/**
 * Símbolos de apoyos y articulaciones (geometría en píxeles, funciones puras).
 * Cada símbolo se construye en un marco local: `u` = dirección "hacia fuera" del apoyo (desde el nudo hacia el
 * suelo) y `v` = perpendicular. El vértice del símbolo está en el nudo.
 */
import type { Id, Member, Project, Support } from "@edscar/model";
import { classifySupport, type SupportPreset } from "@edscar/ui-state";
import { worldToScreen, type Frame, type Point } from "./transform";

export interface SupportShape {
  /** Trazos (atributo `d` de SVG). */
  paths: string[];
  circles: { cx: number; cy: number; r: number }[];
  /** Descripción accesible. */
  title: string;
}

export const SUPPORT_SIZE_PX = 10;

const TITLES: Record<SupportPreset, string> = {
  pinned: "apoyo articulado fijo",
  "roller-x": "apoyo móvil horizontal (impide el movimiento vertical)",
  "roller-z": "apoyo móvil vertical (impide el movimiento horizontal)",
  fixed: "empotramiento",
};

const num = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Forma del apoyo `support` en el punto de pantalla `at`; `out` = vector unitario hacia fuera (pantalla). */
export function supportShape(support: Support, at: Point, out: Point, s = SUPPORT_SIZE_PX): SupportShape {
  const preset = classifySupport(support.fixed);
  const P = (a: number, b: number): string => {
    // a a lo largo de `out`, b a lo largo de la perpendicular.
    const x = at.x + out.x * a + -out.y * b;
    const y = at.y + out.y * a + out.x * b;
    return `${num(x)} ${num(y)}`;
  };
  const C = (a: number, b: number): Point => ({ x: at.x + out.x * a - out.y * b, y: at.y + out.y * a + out.x * b });
  const hatch = (a: number, from: number, to: number, n: number, dir: number): string[] => {
    const out2: string[] = [];
    for (let k = 0; k <= n; k++) {
      const b = from + ((to - from) * k) / n;
      out2.push(`M ${P(a, b)} L ${P(a + dir * 0.6 * s, b - 0.6 * s)}`);
    }
    return out2;
  };

  switch (preset) {
    case "pinned":
      return {
        title: TITLES.pinned,
        paths: [
          `M ${P(0, 0)} L ${P(1.3 * s, -s)} L ${P(1.3 * s, s)} Z`,
          `M ${P(1.3 * s, -1.5 * s)} L ${P(1.3 * s, 1.5 * s)}`,
          ...hatch(1.3 * s, -1.5 * s, 1.5 * s, 5, 1),
        ],
        circles: [],
      };
    case "roller-x":
    case "roller-z": {
      const r = 0.32 * s;
      const a0 = 1.0 * s;
      return {
        title: preset === "roller-x" ? TITLES["roller-x"] : TITLES["roller-z"],
        paths: [
          `M ${P(0, 0)} L ${P(a0, -0.8 * s)} L ${P(a0, 0.8 * s)} Z`,
          `M ${P(a0 + 2 * r, -1.5 * s)} L ${P(a0 + 2 * r, 1.5 * s)}`,
        ],
        circles: [-0.4, 0.4].map((b) => {
          const c = C(a0 + r, b * s * 1.2);
          return { cx: c.x, cy: c.y, r };
        }),
      };
    }
    case "fixed":
      return {
        title: TITLES.fixed,
        paths: [`M ${P(0, -1.6 * s)} L ${P(0, 1.6 * s)}`, ...hatch(0, -1.6 * s, 1.6 * s, 6, 1)],
        circles: [],
      };
    default:
      return {
        title: "apoyo personalizado",
        paths: [`M ${P(0, -0.7 * s)} L ${P(1.4 * s, -0.7 * s)} L ${P(1.4 * s, 0.7 * s)} L ${P(0, 0.7 * s)} Z`],
        circles: [],
      };
  }
}

/**
 * Dirección "hacia fuera" (pantalla) de un apoyo. Apoyos con restricción vertical (articulado, móvil horizontal):
 * hacia abajo. Empotramientos y móviles verticales: alejándose de las barras que llegan al nudo (si no hay barras,
 * hacia la izquierda).
 */
export function supportOutward(project: Project, f: Frame, node: Id, support: Support): Point {
  const preset = classifySupport(support.fixed);
  if (preset === "pinned" || preset === "roller-x") return { x: 0, y: 1 };
  const n = project.nodes.find((q) => q.id === node);
  if (!n) return { x: -1, y: 0 };
  const here = worldToScreen(f, n.x, n.z);
  let sx = 0;
  let sy = 0;
  for (const m of project.members) {
    const other = m.i === node ? m.j : m.j === node ? m.i : null;
    if (other === null) continue;
    const o = project.nodes.find((q) => q.id === other);
    if (!o) continue;
    const p = worldToScreen(f, o.x, o.z);
    const d = Math.hypot(p.x - here.x, p.y - here.y);
    if (d > 0) {
      sx += (p.x - here.x) / d;
      sy += (p.y - here.y) / d;
    }
  }
  const len = Math.hypot(sx, sy);
  if (len < 1e-9) return { x: -1, y: 0 };
  // Eje dominante (horizontal o vertical): los apoyos se dibujan alineados con los ejes.
  return Math.abs(sx) >= Math.abs(sy) ? { x: -Math.sign(sx), y: 0 } : { x: 0, y: -Math.sign(sy) };
}

export interface ReleaseMark { at: Point; kind: "rotation" | "translation"; end: "i" | "j"; title: string }

/** Marcas de liberaciones (articulaciones) de una barra, situadas a `offsetPx` del nudo sobre la barra. */
export function releaseMarks(member: Member, a: Point, b: Point, offsetPx = 11): ReleaseMark[] {
  const rel = member.releases;
  if (!rel) return [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return [];
  const t = Math.min(0.45, offsetPx / len);
  const out: ReleaseMark[] = [];
  for (const end of ["i", "j"] as const) {
    const r = rel[end];
    if (!r) continue;
    const at = end === "i"
      ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      : { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
    if (r.ry === true) out.push({ at, kind: "rotation", end, title: `articulación (momento liberado) en el extremo ${end}` });
    if (r.ux === true || r.uz === true) {
      out.push({ at, kind: "translation", end, title: `traslación liberada en el extremo ${end}` });
    }
  }
  return out;
}
