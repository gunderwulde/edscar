/**
 * Herramienta 'Cargas': asigna una carga del patrón activo a la selección (varias barras o nudos a la vez) con los
 * modos añadir / reemplazar / eliminar. Todo el efecto es un único paso de deshacer (grupo del store).
 */
import { useState } from "react";
import { patternColor } from "../canvas/format";
import { useEditorSelector, useEditorStore } from "../store";
import { describeErrors } from "./validation";
import { useT, type MessageKey } from "./i18n";
import {
  DEFAULT_SPEC, isMemberKind, planAssign, type AssignError, type AssignKind, type AssignMode, type AssignSpec, type RemoveFilter,
} from "./loadAssign";
import { ErrorLine, NumberField, SelectField, CheckField } from "./ui";
import type { Quantity } from "./units";

const KIND_LABEL: Record<AssignKind, MessageKey> = {
  "member-uniform": "load.type.uniform",
  "member-trapezoid": "load.type.trapezoid",
  "member-point": "load.type.point",
  "member-moment": "load.type.moment",
  thermal: "load.type.thermal",
  nodal: "load.type.nodal",
  "support-displacement": "load.type.displacement",
};
const KINDS = Object.keys(KIND_LABEL) as AssignKind[];
const ERROR_KEY: Record<AssignError, MessageKey> = {
  "no-pattern": "assign.err.noPattern", "no-targets": "assign.err.noTargets", "bad-range": "assign.err.badRange",
  "bad-position": "assign.err.badPosition", "no-length": "assign.err.noLength", "nothing-to-remove": "assign.err.nothingToRemove",
};

export function AssignPanel() {
  const t = useT();
  const store = useEditorStore();
  const patterns = useEditorSelector((s) => s.project.patterns);
  const activePattern = useEditorSelector((s) => s.activePattern);
  const selection = useEditorSelector((s) => s.selection);
  const [mode, setMode] = useState<AssignMode>("add");
  const [spec, setSpec] = useState<AssignSpec>(DEFAULT_SPEC);
  const [filter, setFilter] = useState<RemoveFilter>("any");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const memberKind = isMemberKind(spec.kind);
  const nTargets = memberKind ? selection.members.length : selection.nodes.length;
  const idx = patterns.findIndex((p) => p.id === activePattern);

  const num = (
    key: keyof AssignSpec, label: string, quantity: Quantity, optional = false,
  ) => (
    <NumberField
      label={label}
      quantity={quantity}
      optional={optional}
      value={spec[key] as number | null}
      onCommit={(v) => {
        setSpec((s) => ({ ...s, [key]: optional ? v : (v ?? 0) }));
        return null;
      }}
    />
  );

  const apply = (): void => {
    const project = store.getState().project;
    const plan = planAssign(project, { mode, pattern: activePattern, spec, selection, removeFilter: filter });
    if (!plan.ok) {
      setFeedback({ kind: "error", text: t(ERROR_KEY[plan.error]) });
      return;
    }
    store.beginGroup(t(`assign.group.${mode}`));
    let failure: string | null = null;
    for (const c of plan.commands) {
      const r = store.dispatch(c);
      if (!r.ok) {
        failure = describeErrors(r.errors);
        break;
      }
    }
    if (failure) {
      store.cancelGroup();
      setFeedback({ kind: "error", text: failure });
      return;
    }
    store.endGroup();
    setFeedback({ kind: "ok", text: t("assign.done", { added: plan.added, removed: plan.removed, pattern: activePattern ?? "" }) });
  };

  const removeKinds: { value: RemoveFilter; label: string }[] = [{ value: "any", label: t("assign.anyType") }, ...KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))];

  return (
    <div className="pn-assign">
      <div className="pn-row">
        <span className="pn-swatch" style={{ background: patternColor(idx) }} aria-hidden="true" />
        <SelectField
          label={t("assign.pattern")}
          value={activePattern ?? ""}
          options={patterns.length === 0 ? [{ value: "", label: t("assign.noPatterns") }] : patterns.map((p) => ({ value: p.id, label: `${p.id} · ${p.name}` }))}
          onChange={(v) => { store.setActivePattern(v === "" ? null : v); }}
        />
      </div>

      <fieldset className="pn-fieldset" role="radiogroup" aria-label={t("assign.mode")}>
        <legend>{t("assign.mode")}</legend>
        {(["add", "replace", "remove"] as const).map((m) => (
          <label key={m} className="pn-radio">
            <input type="radio" name="assign-mode" checked={mode === m} onChange={() => { setMode(m); setFeedback(null); }} />
            <span>{t(`assign.mode.${m}`)}</span>
          </label>
        ))}
      </fieldset>
      <p className="pn-hint">{t(`assign.modeHint.${mode}`)}</p>

      {mode === "remove" ? (
        <SelectField label={t("assign.removeType")} value={filter} options={removeKinds} onChange={(v) => { setFilter(v as RemoveFilter); }} />
      ) : (
        <>
          <SelectField label={t("assign.type")} value={spec.kind} options={KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} onChange={(v) => { setSpec({ ...spec, kind: v as AssignKind }); }} />
          {spec.kind === "member-uniform" && (<>{num("vx", "wx", "distributed")}{num("vz", "wz", "distributed")}{num("a", "a", "length", true)}{num("b", "b", "length", true)}</>)}
          {spec.kind === "member-trapezoid" && (<>{num("vx", "w1x", "distributed")}{num("vz", "w1z", "distributed")}{num("vx2", "w2x", "distributed")}{num("vz2", "w2z", "distributed")}{num("a", "a", "length", true)}{num("b", "b", "length", true)}</>)}
          {spec.kind === "member-point" && (<>{num("vx", "Px", "force")}{num("vz", "Pz", "force")}</>)}
          {spec.kind === "member-moment" && num("my", "My", "moment")}
          {(spec.kind === "member-point" || spec.kind === "member-moment") && (
            <>
              {num("at", t("assign.at"), spec.relative ? "factor" : "length")}
              <CheckField label={t("load.relative")} checked={spec.relative} onChange={(v) => { setSpec({ ...spec, relative: v, at: v ? 0.5 : spec.at }); }} />
            </>
          )}
          {spec.kind === "thermal" && (<>{num("dT", "ΔT", "tempDelta")}{num("gradientZ", "∂T/∂z", "gradient", true)}</>)}
          {spec.kind === "nodal" && (<>{num("vx", "Fx", "force")}{num("vz", "Fz", "force")}{num("my", "My", "moment")}</>)}
          {spec.kind === "support-displacement" && (<>{num("vx", "ux", "smallLength")}{num("vz", "uz", "smallLength")}{num("dRy", "ry", "angle")}</>)}
          {(spec.kind === "member-uniform" || spec.kind === "member-trapezoid" || spec.kind === "member-point" || spec.kind === "member-moment") && (
            <SelectField
              label={t("load.frame")}
              value={spec.frame}
              options={[{ value: "global", label: t("load.frame.global") }, { value: "local", label: t("load.frame.local") }]}
              onChange={(v) => { setSpec({ ...spec, frame: v === "local" ? "local" : "global" }); }}
            />
          )}
        </>
      )}

      <p className="pn-hint" role="status">
        {mode === "remove"
          ? t("assign.targetsAll", { members: selection.members.length, nodes: selection.nodes.length })
          : t(memberKind ? "assign.targetsMembers" : "assign.targetsNodes", { n: nTargets })}
      </p>
      <div className="pn-row">
        <button type="button" disabled={patterns.length === 0} onClick={apply}>{t(`assign.apply.${mode}`)}</button>
        <button type="button" onClick={() => { store.selectAll(); }}>{t("assign.selectAll")}</button>
      </div>
      {feedback?.kind === "ok" && <p role="status" className="pn-ok">{feedback.text}</p>}
      <ErrorLine message={feedback?.kind === "error" ? feedback.text : null} />
    </div>
  );
}
