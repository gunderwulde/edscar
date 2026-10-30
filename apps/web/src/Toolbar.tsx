/**
 * Barra de herramientas mínima del lienzo (herramientas, deshacer/rehacer, vista, resultados). Solo despacha acciones
 * del store. UX/Paneles puede ampliarla o sustituirla con el slot `toolbarExtra` de <App> sin reescribir este fichero.
 */
import { beamE1Project, type DiagramChoice, type SupportPreset, type Tool } from "@edscar/ui-state";
import { useT, type MessageKey } from "./panels/i18n";
import { useEditorSelector, useEditorStore, useSolveController } from "./store";

const TOOLS: { id: Tool; label: MessageKey; key: string }[] = [
  { id: "select", label: "tool.select", key: "V" },
  { id: "node", label: "tool.node", key: "N" },
  { id: "member", label: "tool.member", key: "B" },
  { id: "support", label: "tool.support", key: "S" },
];

const PRESETS: { id: SupportPreset; label: MessageKey }[] = [
  { id: "pinned", label: "support.pinned" },
  { id: "roller-x", label: "support.rollerX" },
  { id: "roller-z", label: "support.rollerZ" },
  { id: "fixed", label: "support.fixed" },
];

const DIAGRAMS: { id: DiagramChoice; label: MessageKey }[] = [
  { id: "none", label: "diagram.none" },
  { id: "N", label: "diagram.N" },
  { id: "V", label: "diagram.V" },
  { id: "M", label: "diagram.M" },
];

export interface ToolbarProps {
  onFit: () => void;
  /** Se llama tras sustituir el proyecto (nuevo / ejemplo) para que el lienzo lo encuadre. */
  onProjectReplaced: () => void;
  /** Mostrar Nuevo y Ejemplo viga E1 (por defecto sí). */
  showProject?: boolean;
}

export function Toolbar({ onFit, onProjectReplaced, showProject = true }: ToolbarProps) {
  const t = useT();
  const store = useEditorStore();
  const controller = useSolveController();
  const tool = useEditorSelector((s) => s.tool);
  const preset = useEditorSelector((s) => s.supportPreset);
  const history = useEditorSelector((s) => s.history);
  const display = useEditorSelector((s) => s.display);
  const cases = useEditorSelector((s) => s.project.cases);
  const caseId = useEditorSelector((s) => s.results.caseId);
  const selection = useEditorSelector((s) => s.selection);
  const solver = useEditorSelector((s) => s.solver);
  const hasSelection = selection.nodes.length + selection.members.length + selection.loads.length > 0;

  const toggle = (key: "grid" | "snap" | "loads" | "deformed" | "reactions", label: string) => (
    <label className="tb-check">
      <input
        type="checkbox"
        checked={display[key]}
        onChange={(e) => {
          store.setDisplay({ [key]: e.target.checked });
        }}
      />
      {label}
    </label>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label={t("tb.canvasTools")}>
      <div className="tb-group" role="group" aria-label={t("tb.tool")}>
        {TOOLS.map((tl) => (
          <button
            key={tl.id}
            type="button"
            aria-pressed={tool === tl.id}
            title={`${t(tl.label)} (${tl.key})`}
            onClick={() => {
              store.setTool(tl.id);
            }}
          >
            {t(tl.label)}
          </button>
        ))}
        {tool === "support" && (
          <select
            aria-label={t("tb.supportType")}
            value={preset}
            onChange={(e) => {
              store.setSupportPreset(e.target.value as SupportPreset);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.label)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="tb-group" role="group" aria-label={t("tb.edit")}>
        <button type="button" disabled={history.undoCount === 0} title={history.undoLabel ? `${t("history.undoLabel", { label: history.undoLabel })} (Ctrl+Z)` : `${t("history.undo")} (Ctrl+Z)`} onClick={() => void store.undo()}>
          {t("history.undo")}
        </button>
        <button type="button" disabled={history.redoCount === 0} title={history.redoLabel ? `${t("history.redoLabel", { label: history.redoLabel })} (Ctrl+Y)` : `${t("history.redo")} (Ctrl+Y)`} onClick={() => void store.redo()}>
          {t("history.redo")}
        </button>
        <button type="button" disabled={!hasSelection} title={t("tb.deleteHint")} onClick={() => void store.deleteSelection()}>
          {t("tb.delete")}
        </button>
      </div>

      <div className="tb-group" role="group" aria-label={t("tb.view")}>
        <button type="button" title={t("tb.fitHint")} onClick={onFit}>
          {t("tb.fit")}
        </button>
        {toggle("grid", t("tb.grid"))}
        {toggle("snap", t("tb.snap"))}
        {toggle("loads", t("tb.loads"))}
      </div>

      <div className="tb-group" role="group" aria-label={t("tb.results")}>
        <select
          aria-label={t("tb.case")}
          value={caseId ?? ""}
          onChange={(e) => {
            store.setResultCase(e.target.value === "" ? null : e.target.value);
          }}
        >
          {cases.length === 0 && <option value="">{t("results.noCases")}</option>}
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={controller === null || solver.phase === "solving"} onClick={() => void controller?.solveNow()}>
          {t("results.calculate")}
        </button>
        <select
          aria-label={t("results.diagram")}
          value={display.diagram}
          onChange={(e) => {
            store.setDisplay({ diagram: e.target.value as DiagramChoice });
          }}
        >
          {DIAGRAMS.map((d) => (
            <option key={d.id} value={d.id}>
              {t(d.label)}
            </option>
          ))}
        </select>
        {toggle("deformed", t("results.deformed"))}
        {toggle("reactions", t("results.reactions"))}
      </div>

      {showProject && (
      <div className="tb-group" role="group" aria-label={t("tb.project")}>
        <button
          type="button"
          onClick={() => {
            store.newProject();
            onProjectReplaced();
          }}
        >
          {t("action.new")}
        </button>
        <button
          type="button"
          title={t("tb.exampleHint")}
          onClick={() => {
            store.replaceProject(beamE1Project());
            onProjectReplaced();
          }}
        >
          {t("tb.exampleE1")}
        </button>
      </div>
      )}
    </div>
  );
}
