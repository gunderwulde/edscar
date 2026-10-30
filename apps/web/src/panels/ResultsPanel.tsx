/**
 * Resultados: selector de caso/combinación, qué mostrar (deformada, reacciones, N, V, M), mensajes del solver con
 * ubicación, y resumen de máximos. Las combinaciones se resuelven aplanándolas a un caso virtual (lineal, exacto).
 */
import { useEffect, useMemo, useState } from "react";
import type { SolveResult } from "@edscar/solver";
import { visibleResult, type DiagramChoice } from "@edscar/ui-state";
import { useEditorSelector, useEditorStore, useSolveController } from "../store";
import type { SolverClient } from "../worker/client";
import { useT, type MessageKey } from "./i18n";
import { usePrefs } from "./prefs";
import { parseSolverMessage, projectWithCombination, summarizeResult, type Extreme } from "./results";
import { CheckField } from "./ui";
import { formatPlain, toDisplay, unitLabel, type Quantity, type UnitSystem } from "./units";

type ComboState =
  | { phase: "idle" }
  | { phase: "solving" }
  | { phase: "done"; result: SolveResult; revision: number }
  | { phase: "error"; message: string };

/** Resuelve una combinación en el Worker cada vez que cambia el modelo. */
function useCombinationResult(solver: SolverClient | undefined, comboId: string | null): ComboState {
  const store = useEditorStore();
  const revision = useEditorSelector((s) => s.revision);
  const [state, setState] = useState<ComboState>({ phase: "idle" });
  useEffect(() => {
    if (comboId === null) {
      setState({ phase: "idle" });
      return;
    }
    if (!solver) {
      setState({ phase: "error", message: "solver" });
      return;
    }
    const built = projectWithCombination(store.getState().project, comboId);
    if ("error" in built) {
      setState({ phase: "error", message: built.error });
      return;
    }
    let live = true;
    setState({ phase: "solving" });
    const timer = setTimeout(() => {
      solver.solve({ project: built.project, caseId: built.caseId }).then(
        (result) => { if (live) setState({ phase: "done", result, revision }); },
        (e: unknown) => { if (live) setState({ phase: "error", message: e instanceof Error ? e.message : String(e) }); },
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [solver, comboId, revision, store]);
  return state;
}

const STATUS_KEY: Record<string, MessageKey> = {
  singular: "results.status.singular",
  "invalid-model": "results.status.invalid-model",
  unsupported: "results.status.unsupported",
};

const fmt = (q: Quantity, v: number, sys: UnitSystem): string => `${formatPlain(Number(toDisplay(q, v, sys).toPrecision(5)))} ${unitLabel(q, sys)}`;

function ExtremeLine({ label, e, q, sys, at }: { label: string; e: Extreme | null; q: Quantity; sys: UnitSystem; at: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{e ? fmt(q, e.value, sys) : "–"}</td>
      <td>{e ? `${e.member}, ${at} ${fmt("length", e.x, sys)}` : ""}</td>
    </tr>
  );
}

export function ResultsPanel({ solver }: { solver?: SolverClient | undefined }) {
  const t = useT();
  const store = useEditorStore();
  const controller = useSolveController();
  const { units } = usePrefs();
  const cases = useEditorSelector((s) => s.project.cases);
  const combos = useEditorSelector((s) => s.project.combinations);
  const caseId = useEditorSelector((s) => s.results.caseId);
  const display = useEditorSelector((s) => s.display);
  const solverState = useEditorSelector((s) => s.solver);
  const shownState = useEditorSelector((s) => s);
  const [comboId, setComboId] = useState<string | null>(null);
  const combo = useCombinationResult(solver, comboId);

  // Si la combinación elegida se borra, vuelve a los casos.
  useEffect(() => {
    if (comboId !== null && !combos.some((c) => c.id === comboId)) setComboId(null);
  }, [combos, comboId]);

  const caseView = visibleResult(shownState);
  const active: { result: SolveResult | null; stale: boolean; status: string | null; message: string | null; busy: boolean; error: string | null } =
    comboId !== null
      ? {
          result: combo.phase === "done" ? combo.result : null,
          stale: combo.phase === "done" && combo.revision !== shownState.revision,
          status: combo.phase === "done" ? combo.result.status : null,
          message: combo.phase === "done" ? (combo.result.message ?? null) : null,
          busy: combo.phase === "solving",
          error: combo.phase === "error" ? (combo.message === "solver" ? t("results.noSolver") : combo.message) : null,
        }
      : {
          result: caseView?.result ?? null,
          stale: caseView?.stale ?? false,
          status: solverState.status,
          message: solverState.message,
          busy: solverState.phase === "solving",
          error: solverState.phase === "failed" ? solverState.message : null,
        };

  const summary = useMemo(() => (active.result?.status === "ok" ? summarizeResult(active.result) : null), [active.result]);
  const notes = parseSolverMessage(active.error ? null : active.message, active.status);
  const indeterminate = active.result?.indeterminateDofs ? Object.entries(active.result.indeterminateDofs) : [];
  const DOF_NAMES = ["ux", "uy", "uz", "rx", "ry", "rz"];

  const value = comboId !== null ? `combo:${comboId}` : `case:${caseId ?? ""}`;
  const diagrams: DiagramChoice[] = ["none", "N", "V", "M"];

  return (
    <div className="pn-results">
      <div className="pn-results-controls">
        <label className="pn-field">
          <span className="pn-label">{t("results.show")}</span>
          <select
            aria-label={t("results.show")}
            value={value}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(":");
              const id = rest.join(":");
              if (kind === "combo") setComboId(id);
              else {
                setComboId(null);
                store.setResultCase(id === "" ? null : id);
              }
            }}
          >
            {cases.length + combos.length === 0 && <option value="case:">{t("results.noCases")}</option>}
            {cases.length > 0 && (
              <optgroup label={t("tree.cases")}>
                {cases.map((c) => <option key={c.id} value={`case:${c.id}`}>{c.id} · {c.name}</option>)}
              </optgroup>
            )}
            {combos.length > 0 && (
              <optgroup label={t("tree.combinations")}>
                {combos.map((c) => <option key={c.id} value={`combo:${c.id}`}>{c.id} · {c.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <button type="button" disabled={!controller || active.busy || comboId !== null} onClick={() => void controller?.solveNow()}>
          {t("results.calculate")}
        </button>
        <fieldset className="pn-fieldset pn-inline-fieldset" role="radiogroup" aria-label={t("results.diagram")}>
          <legend>{t("results.diagram")}</legend>
          {diagrams.map((d) => (
            <label key={d} className="pn-radio">
              <input type="radio" name="diagram" checked={display.diagram === d} onChange={() => { store.setDisplay({ diagram: d }); }} />
              <span>{d === "none" ? t("results.none") : d}</span>
            </label>
          ))}
        </fieldset>
        <CheckField label={t("results.deformed")} checked={display.deformed} onChange={(v) => { store.setDisplay({ deformed: v }); }} />
        <CheckField label={t("results.reactions")} checked={display.reactions} onChange={(v) => { store.setDisplay({ reactions: v }); }} />
        <CheckField label={t("results.loads")} checked={display.loads} onChange={(v) => { store.setDisplay({ loads: v }); }} />
      </div>
      {comboId !== null && <p className="pn-hint">{t("results.comboNote")}</p>}

      <p role="status" className={`pn-status pn-status-${active.error || (active.status && active.status !== "ok") ? "bad" : "ok"}`}>
        {active.busy ? t("results.solving") : active.error ? active.error : active.status === null ? t("results.none.yet") : active.status === "ok" ? t("results.ok") : t(STATUS_KEY[active.status] ?? "results.status.invalid-model")}
        {active.stale && !active.busy && <> · {t("results.stale")}</>}
      </p>

      {active.status !== null && active.status !== "ok" && active.message && (
        <p className="pn-error pn-error-line" role="alert">{active.message}</p>
      )}

      {(notes.length > 0 && active.status === "ok") || indeterminate.length > 0 ? (
        <ul className="pn-notes" aria-label={t("results.notes")}>
          {notes.map((n, k) => (
            <li key={k} className="pn-note">
              <span className="pn-tag pn-tag-warn">{n.kind === "ill-conditioned" ? t("results.illConditioned") : n.kind === "mechanism" ? t("results.mechanism") : t("results.warning")}</span>{" "}
              {n.text}
              {n.members.map((id) => <button key={`m${id}`} type="button" className="pn-link" onClick={() => { store.select({ members: [id] }); }}>{t("results.goMember", { id })}</button>)}
              {n.nodes.map((id) => <button key={`n${id}`} type="button" className="pn-link" onClick={() => { store.select({ nodes: [id] }); }}>{t("results.goNode", { id })}</button>)}
            </li>
          ))}
          {indeterminate.map(([node, dofs]) => (
            <li key={node} className="pn-note">
              <span className="pn-tag pn-tag-warn">{t("results.indeterminate")}</span> {t("results.indeterminateText", { node, dofs: dofs.map((d) => DOF_NAMES[d] ?? String(d)).join(", ") })}
              <button type="button" className="pn-link" onClick={() => { store.select({ nodes: [node] }); }}>{t("results.goNode", { id: node })}</button>
            </li>
          ))}
        </ul>
      ) : null}

      {summary && (
        <div className="pn-summary">
          <table className="pn-table">
            <caption>{t("results.summary")}</caption>
            <thead><tr><th scope="col" /><th scope="col">{t("results.max")}</th><th scope="col">{t("results.where")}</th></tr></thead>
            <tbody>
              <ExtremeLine label="N" e={summary.N} q="force" sys={units} at="x =" />
              <ExtremeLine label="V" e={summary.V} q="force" sys={units} at="x =" />
              <ExtremeLine label="M" e={summary.M} q="moment" sys={units} at="x =" />
              <tr>
                <th scope="row">{t("results.maxDisp")}</th>
                <td>{summary.maxDisplacement ? fmt("smallLength", summary.maxDisplacement.value, units) : "–"}</td>
                <td>{summary.maxDisplacement ? `${t("tree.nodes")} ${summary.maxDisplacement.node}` : ""}</td>
              </tr>
            </tbody>
          </table>
          <table className="pn-table">
            <caption>{t("results.reactionsTable")}</caption>
            <thead><tr><th scope="col">{t("table.id")}</th><th scope="col">Rx</th><th scope="col">Rz</th><th scope="col">My</th></tr></thead>
            <tbody>
              {summary.reactions.map((r) => (
                <tr key={r.node}>
                  <th scope="row">{r.node}</th>
                  <td>{fmt("force", r.rx, units)}</td><td>{fmt("force", r.rz, units)}</td><td>{fmt("moment", r.my, units)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Σ</th>
                <td>{fmt("force", summary.sumRx, units)}</td><td>{fmt("force", summary.sumRz, units)}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
