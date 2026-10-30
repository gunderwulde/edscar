/** Capas SVG del lienzo. Cada una recibe datos ya calculados y solo dibuja; sin acceso al store. */
import { memo, useMemo } from "react";
import type { Id, Project } from "@edscar/model";
import type { SolveResult } from "@edscar/solver";
import type { DiagramKind, Selection } from "@edscar/ui-state";
import { patternColor } from "./format";
import type { LoadGlyph } from "./loadGlyphs";
import {
  autoDeformScale, deformedMember, diagramScale, maxAbsDiagram, memberDiagram, reactionGlyphs,
} from "./results";
import { arcGeometry, arrowHead, pointsAttr } from "./svg";
import { releaseMarks, supportOutward, supportShape } from "./supports";
import { gridStep, screenToWorld, worldToScreen, type Frame } from "./transform";

const MAX_GRID_LINES = 300;

export const GridLayer = memo(function GridLayer({ frame }: { frame: Frame }) {
  const { vp } = frame;
  const step = gridStep(frame.view.zoom);
  const lines = useMemo(() => {
    const w0 = screenToWorld(frame, { x: 0, y: vp.height });
    const w1 = screenToWorld(frame, { x: vp.width, y: 0 });
    const out: { key: string; x1: number; y1: number; x2: number; y2: number; cls: string }[] = [];
    const kx0 = Math.floor(w0.x / step);
    const kx1 = Math.ceil(w1.x / step);
    const kz0 = Math.floor(w0.z / step);
    const kz1 = Math.ceil(w1.z / step);
    if (kx1 - kx0 > MAX_GRID_LINES || kz1 - kz0 > MAX_GRID_LINES) return out;
    for (let k = kx0; k <= kx1; k++) {
      const sx = worldToScreen(frame, k * step, 0).x;
      out.push({ key: `x${String(k)}`, x1: sx, y1: 0, x2: sx, y2: vp.height, cls: k === 0 ? "axis" : k % 5 === 0 ? "major" : "minor" });
    }
    for (let k = kz0; k <= kz1; k++) {
      const sy = worldToScreen(frame, 0, k * step).y;
      out.push({ key: `z${String(k)}`, x1: 0, y1: sy, x2: vp.width, y2: sy, cls: k === 0 ? "axis" : k % 5 === 0 ? "major" : "minor" });
    }
    return out;
  }, [frame, vp.width, vp.height, step]);
  return (
    <g className="ec-grid" aria-hidden="true">
      {lines.map((l) => (
        <line key={l.key} className={l.cls} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </g>
  );
});

/** Pequeño indicador de ejes X (derecha) y Z (arriba) en la esquina inferior izquierda. */
export function AxisGizmo({ height }: { height: number }) {
  const o = { x: 34, y: height - 34 };
  return (
    <g className="ec-gizmo" aria-hidden="true">
      <line x1={o.x} y1={o.y} x2={o.x + 28} y2={o.y} />
      <polygon points={arrowHead(o, { x: o.x + 28, y: o.y }, 7)} />
      <text x={o.x + 32} y={o.y + 4}>X</text>
      <line x1={o.x} y1={o.y} x2={o.x} y2={o.y - 28} />
      <polygon points={arrowHead(o, { x: o.x, y: o.y - 28 }, 7)} />
      <text x={o.x - 4} y={o.y - 34}>Z</text>
    </g>
  );
}

interface ModelProps { project: Project; frame: Frame; selection: Selection; showNodeLabels: boolean }

export const ModelLayer = memo(function ModelLayer({ project, frame, selection, showNodeLabels }: ModelProps) {
  const selNodes = useMemo(() => new Set(selection.nodes), [selection.nodes]);
  const selMembers = useMemo(() => new Set(selection.members), [selection.members]);
  const nodeScreen = useMemo(
    () => new Map(project.nodes.map((n) => [n.id, worldToScreen(frame, n.x, n.z)])),
    [project.nodes, frame],
  );
  return (
    <g className="ec-model">
      <g className="ec-members">
        {project.members.map((m) => {
          const a = nodeScreen.get(m.i);
          const b = nodeScreen.get(m.j);
          if (!a || !b) return null;
          const sel = selMembers.has(m.id);
          return (
            <g key={m.id} role="img" aria-label={`Barra ${m.id}, del nudo ${m.i} al nudo ${m.j}${sel ? ", seleccionada" : ""}`}>
              {sel && <line className="ec-sel-halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
              <line className={sel ? "ec-member selected" : "ec-member"} data-member={m.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {releaseMarks(m, a, b).map((r) =>
                r.kind === "rotation" ? (
                  <circle key={r.end + r.kind} className="ec-release" cx={r.at.x} cy={r.at.y} r={4} data-release={`${m.id}.${r.end}`}>
                    <title>{r.title}</title>
                  </circle>
                ) : (
                  <rect key={r.end + r.kind} className="ec-release" x={r.at.x - 3.5} y={r.at.y - 3.5} width={7} height={7} data-release={`${m.id}.${r.end}`}>
                    <title>{r.title}</title>
                  </rect>
                ),
              )}
            </g>
          );
        })}
      </g>
      <g className="ec-supports">
        {project.supports.map((s) => {
          const at = nodeScreen.get(s.node);
          if (!at) return null;
          const shape = supportShape(s, at, supportOutward(project, frame, s.node, s));
          return (
            <g key={s.id} role="img" aria-label={`Nudo ${s.node}: ${shape.title}`} data-support={s.id}>
              <title>{shape.title}</title>
              {shape.paths.map((d, k) => (
                <path key={k} d={d} />
              ))}
              {shape.circles.map((c, k) => (
                <circle key={k} cx={c.cx} cy={c.cy} r={c.r} />
              ))}
            </g>
          );
        })}
      </g>
      <g className="ec-nodes">
        {project.nodes.map((n) => {
          const p = nodeScreen.get(n.id);
          if (!p) return null;
          const sel = selNodes.has(n.id);
          return (
            <g key={n.id} role="img" aria-label={`Nudo ${n.id}, x = ${String(n.x)} m, z = ${String(n.z)} m${sel ? ", seleccionado" : ""}`}>
              <circle className={sel ? "ec-node selected" : "ec-node"} data-node={n.id} cx={p.x} cy={p.y} r={sel ? 6 : 4} />
              {showNodeLabels && (
                <text className="ec-node-label" x={p.x + 7} y={p.y - 7}>
                  {n.id}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
});

interface LoadsProps {
  glyphs: readonly LoadGlyph[];
  project: Project;
  selected: ReadonlySet<Id>;
}

export const LoadsLayer = memo(function LoadsLayer({ glyphs, project, selected }: LoadsProps) {
  const index = useMemo(() => new Map(project.patterns.map((p, k) => [p.id, k])), [project.patterns]);
  return (
    <g className="ec-loads">
      {glyphs.map((g) => {
        const sel = selected.has(g.loadId);
        const arc = g.arc ? arcGeometry(g.arc) : null;
        return (
          <g
            key={g.loadId}
            className={`ec-load${sel ? " selected" : ""}${g.dashed ? " dashed" : ""}`}
            style={{ color: patternColor(index.get(g.patternId) ?? 0) }}
            data-load={g.loadId}
            data-pattern={g.patternId}
            role="img"
            aria-label={`Carga ${g.loadId}: ${g.label.text}${sel ? ", seleccionada" : ""}`}
          >
            {g.fill && <polygon className="ec-load-fill" points={pointsAttr(g.fill)} />}
            {g.arrows.map((a, k) => (
              <g key={k}>
                <line x1={a.tail.x} y1={a.tail.y} x2={a.head.x} y2={a.head.y} />
                <polygon className="ec-head" points={arrowHead(a.tail, a.head)} />
              </g>
            ))}
            {arc && (
              <g>
                <path className="ec-arc" d={arc.d} />
                <polygon className="ec-head" points={arc.head} />
              </g>
            )}
            <text className="ec-label" x={g.label.x} y={g.label.y}>
              {g.label.text}
            </text>
          </g>
        );
      })}
    </g>
  );
});

interface ResultsProps {
  project: Project;
  result: SolveResult;
  frame: Frame;
  stale: boolean;
  diagram: DiagramKind | "none";
  deformed: boolean;
  deformScale: number | null;
  reactions: boolean;
}

/** Resultados del solver: diagramas, deformada y reacciones (atenuados si están desactualizados). */
export const ResultsLayer = memo(function ResultsLayer(p: ResultsProps) {
  const { project, result, frame } = p;
  const shapes = useMemo(() => {
    if (p.diagram === "none") return [];
    const px = diagramScale(maxAbsDiagram(result, p.diagram));
    if (px === 0) return [];
    const kind = p.diagram;
    return project.members.flatMap((m) => {
      const s = memberDiagram(project, result, m.id, kind, frame, px);
      return s ? [s] : [];
    });
  }, [project, result, frame, p.diagram]);
  const scale = p.deformScale ?? autoDeformScale(project, result);
  const defo = useMemo(
    () => (p.deformed ? project.members.flatMap((m) => {
      const s = deformedMember(project, result, m.id, scale, frame);
      return s ? [s] : [];
    }) : []),
    [project, result, frame, p.deformed, scale],
  );
  const reacts = useMemo(() => (p.reactions ? reactionGlyphs(project, result, frame) : []), [project, result, frame, p.reactions]);

  return (
    <g className={`ec-results${p.stale ? " stale" : ""}`} data-stale={p.stale ? "true" : "false"}>
      {shapes.map((s) => (
        <g key={s.memberId} className={`ec-diagram ec-diagram-${p.diagram}`} data-diagram={s.memberId}>
          <polygon points={pointsAttr(s.polygon)} />
          <polyline points={pointsAttr(s.outline)} />
          {s.labels.map((l, k) => (
            <text key={k} className="ec-label" x={l.x} y={l.y} textAnchor="middle">
              {l.text}
            </text>
          ))}
        </g>
      ))}
      {defo.map((d) => (
        <polyline key={d.memberId} className="ec-deformed" points={pointsAttr(d.points)} data-deformed={d.memberId} />
      ))}
      {reacts.map((r) => (
        <g key={r.node} className="ec-reaction" data-reaction={r.node} role="img" aria-label={`Reacción en ${r.node}: ${r.label.text}`}>
          {r.arrow && (
            <g>
              <line x1={r.arrow.tail.x} y1={r.arrow.tail.y} x2={r.arrow.head.x} y2={r.arrow.head.y} />
              <polygon className="ec-head" points={arrowHead(r.arrow.tail, r.arrow.head)} />
            </g>
          )}
          {r.arc &&
            (() => {
              const a = arcGeometry(r.arc);
              return (
                <g>
                  <path className="ec-arc" d={a.d} />
                  <polygon className="ec-head" points={a.head} />
                </g>
              );
            })()}
          <text className="ec-label" x={r.label.x} y={r.label.y}>
            {r.label.text}
          </text>
        </g>
      ))}
    </g>
  );
});

