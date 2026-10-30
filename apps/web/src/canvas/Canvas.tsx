/**
 * Lienzo 2D del editor (SVG propio). Plano X–Z con Z arriba (ADR-001).
 *
 * Contrato de integración (ver README.md): se monta dentro de <EditorProvider>, ocupa el 100 % de su contenedor
 * (que debe tener tamaño) y solo habla con el store: lee estado y emite comandos/acciones.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { describeSelection, visibleResult } from "@edscar/ui-state";
import { useEditorSelector, useEditorStore } from "../store";
import "./canvas.css";
import { createInteraction, type Interaction, type Transient } from "./interaction";
import { computeLoadScale, loadGlyphs } from "./loadGlyphs";
import { AxisGizmo, GridLayer, LoadsLayer, ModelLayer, ResultsLayer } from "./Layers";
import { Legend } from "./Legend";
import { formatNumber } from "./format";
import { autoDeformScale, maxDisplacement } from "./results";
import { modelBounds, fitView, worldToScreen, type Frame, type Point, type Viewport } from "./transform";

export interface CanvasProps {
  /** Al cambiar este número, el lienzo encuadra el modelo (p. ej. tras abrir un proyecto). */
  fitSignal?: number;
}

const DEFAULT_VP: Viewport = { width: 800, height: 520 };
const NODE_LABEL_LIMIT = 80;

const TOOL_HINT: Record<string, string> = {
  select: "Seleccionar: clic o caja; arrastra un nudo para moverlo",
  node: "Nudo: clic para crear (captura a rejilla y nudos)",
  member: "Barra: clic en dos nudos (o puntos); doble clic o Esc para terminar",
  support: "Apoyo: clic en un nudo para asignar o quitar el apoyo",
};

export function Canvas({ fitSignal = 0 }: CanvasProps) {
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const selection = useEditorSelector((s) => s.selection);
  const view = useEditorSelector((s) => s.view);
  const tool = useEditorSelector((s) => s.tool);
  const display = useEditorSelector((s) => s.display);
  const hiddenPatterns = useEditorSelector((s) => s.hiddenPatterns);
  const lastErrors = useEditorSelector((s) => s.lastErrors);
  const results = useEditorSelector((s) => s.results);
  const revision = useEditorSelector((s) => s.revision);
  const solver = useEditorSelector((s) => s.solver);

  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>(DEFAULT_VP);
  const [measured, setMeasured] = useState(false);
  const [transient, setTransient] = useState<Transient>({ cursor: null, box: null, memberStart: null });
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const spaceRef = useRef(false);

  const interaction: Interaction = useMemo(
    () => createInteraction(store, () => vpRef.current, setTransient),
    [store],
  );

  // Tamaño del lienzo.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setVp((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
      }
      setMeasured(true);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Encuadre inicial y bajo demanda (fitSignal).
  const lastFit = useRef<number | null>(null);
  useEffect(() => {
    if (!measured || lastFit.current === fitSignal) return;
    lastFit.current = fitSignal;
    store.setView(fitView(modelBounds(store.getState().project), vpRef.current));
  }, [measured, fitSignal, store]);

  // Rueda: listener nativo no pasivo para poder impedir el desplazamiento de la página.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      interaction.wheel({ x: e.clientX - r.left, y: e.clientY - r.top }, e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [interaction]);

  // Cambiar de herramienta cancela el dibujo en curso.
  useEffect(() => {
    interaction.reset();
  }, [tool, interaction]);

  const pos = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    ref.current?.focus();
    if (e.button !== 0) e.preventDefault();
    (e.currentTarget as Partial<HTMLDivElement>).setPointerCapture?.(e.pointerId);
    interaction.pointerDown({ p: pos(e), button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, space: spaceRef.current });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    (e.currentTarget as Partial<HTMLDivElement>).releasePointerCapture?.(e.pointerId);
    interaction.pointerUp(pos(e));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === " ") {
      spaceRef.current = true;
      e.preventDefault();
      return;
    }
    if (interaction.keyDown({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === " ") spaceRef.current = false;
  };

  const frame: Frame = useMemo(() => ({ view, vp }), [view, vp]);
  const hidden = useMemo(() => new Set(hiddenPatterns), [hiddenPatterns]);
  const glyphs = useMemo(
    () => (display.loads ? loadGlyphs(project, frame, hidden, computeLoadScale(project, hidden)) : []),
    [display.loads, project, frame, hidden],
  );
  const selectedLoads = useMemo(() => new Set(selection.loads), [selection.loads]);
  const shown = useMemo(() => visibleResult({ results, revision }), [results, revision]);
  const okResult = shown && shown.result.status === "ok" ? shown : null;
  const gridPoints = display.grid;

  const startNode = transient.memberStart ? project.nodes.find((n) => n.id === transient.memberStart) : undefined;
  const startPt = startNode ? worldToScreen(frame, startNode.x, startNode.z) : null;
  const cur = transient.cursor;
  const curPt = cur ? worldToScreen(frame, cur.x, cur.z) : null;
  const drawing = tool === "node" || tool === "member";

  const notes: string[] = [];
  if (okResult && display.deformed && !okResult.result.deflections) {
    notes.push("Deformada aproximada: el solver no entrega `deflections`; se interpola con los desplazamientos nodales (no incluye cargas intermedias).");
  }
  if (okResult?.stale) notes.push("Resultados desactualizados: el modelo cambió desde el último cálculo.");
  if (okResult && display.deformed) {
    const scale = display.deformScale ?? autoDeformScale(project, okResult.result);
    notes.push(`Deformada ×${formatNumber(scale)} (máx. ${formatNumber(maxDisplacement(okResult.result) * 1000)} mm)`);
  }

  const solverText =
    solver.phase === "solving" ? "Calculando…"
    : solver.phase === "failed" ? `Error del solver: ${solver.message ?? ""}`
    : shown && shown.result.status !== "ok" ? `Sin resultados (${shown.result.status}): ${shown.result.message ?? ""}`
    : solver.message ? `Solver: ${solver.message}` : "";

  return (
    <div
      ref={ref}
      className="edscar-canvas"
      role="application"
      aria-label="Lienzo del modelo estructural, plano X-Z"
      aria-describedby="ec-help"
      aria-busy={solver.phase === "solving"}
      tabIndex={0}
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        interaction.pointerMove(pos(e));
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        interaction.reset();
      }}
      onPointerLeave={() => {
        interaction.pointerLeave();
      }}
      onDoubleClick={() => {
        interaction.doubleClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <svg className="ec-svg" width={vp.width} height={vp.height} viewBox={`0 0 ${String(vp.width)} ${String(vp.height)}`} focusable="false">
        {gridPoints && <GridLayer frame={frame} />}
        <ModelLayer project={project} frame={frame} selection={selection} showNodeLabels={project.nodes.length <= NODE_LABEL_LIMIT} />
        {okResult && (
          <ResultsLayer
            project={project}
            result={okResult.result}
            frame={frame}
            stale={okResult.stale}
            diagram={display.diagram}
            deformed={display.deformed}
            deformScale={display.deformScale}
            reactions={display.reactions}
          />
        )}
        {display.loads && <LoadsLayer glyphs={glyphs} project={project} selected={selectedLoads} />}
        {startPt && curPt && <line className="ec-rubber" x1={startPt.x} y1={startPt.y} x2={curPt.x} y2={curPt.y} />}
        {drawing && curPt && cur && (
          <g className={`ec-cursor ${cur.kind}`} aria-hidden="true">
            <circle cx={curPt.x} cy={curPt.y} r={cur.kind === "node" ? 8 : 5} />
          </g>
        )}
        {transient.box && (
          <rect
            className="ec-box"
            x={Math.min(transient.box.a.x, transient.box.b.x)}
            y={Math.min(transient.box.a.y, transient.box.b.y)}
            width={Math.abs(transient.box.a.x - transient.box.b.x)}
            height={Math.abs(transient.box.a.y - transient.box.b.y)}
          />
        )}
        <AxisGizmo height={vp.height} />
      </svg>

      <Legend />

      <div className="ec-hud" aria-hidden="true">
        <span>{TOOL_HINT[tool]}</span>
        {cur && (
          <span className="coords">
            x = {formatNumber(cur.x)} m · z = {formatNumber(cur.z)} m{cur.kind === "node" ? " · nudo" : ""}
          </span>
        )}
      </div>
      {(notes.length > 0 || solverText) && (
        <div className="ec-notes">
          {solverText && <p className={solver.phase === "failed" ? "err" : undefined}>{solverText}</p>}
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <p id="ec-help" className="ec-sr">
        Atajos: V seleccionar, N nudo, B barra, S apoyo, F encuadrar, Supr borrar, Ctrl+Z deshacer, Ctrl+Y rehacer,
        Ctrl+A seleccionar todo, flechas desplazar, más y menos para zoom, Esc cancelar.
      </p>
      <p className="ec-sr" role="status" aria-live="polite">
        {describeSelection(selection)}
      </p>
      {lastErrors && lastErrors.length > 0 && (
        <div className="ec-errors" role="alert">
          <strong>No se pudo aplicar el cambio:</strong>
          <ul>
            {lastErrors.slice(0, 3).map((er, k) => (
              <li key={k}>{er.message}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              store.clearErrors();
            }}
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
