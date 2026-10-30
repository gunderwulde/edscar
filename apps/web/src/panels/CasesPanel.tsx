/** Gestión de patrones, casos y combinaciones: crear, editar, borrar, visibilidad y patrón activo. */
import { useState } from "react";
import type { CombinationKind, Id, LoadCase, LoadCombination, LoadPattern, PatternKind, Project } from "@edscar/model";
import { addCaseCommand, addPatternCommand, combine, nextId, type Command } from "@edscar/ui-state";
import { patternColor } from "../canvas/format";
import { useEditorSelector, useEditorStore } from "../store";
import { run } from "./edits";
import { useT, type MessageKey } from "./i18n";
import { CheckField, ErrorLine, MenuButton, NumberField, SelectField, Section, TextField, type Option } from "./ui";

const PATTERN_KINDS: readonly PatternKind[] = ["D", "SD", "L", "Lr", "S", "W", "E", "T", "Other"];
const PATTERN_PRESETS: { kind: PatternKind; nameKey: MessageKey; selfWeight: number }[] = [
  { kind: "D", nameKey: "preset.D", selfWeight: 1 },
  { kind: "SD", nameKey: "preset.SD", selfWeight: 0 },
  { kind: "L", nameKey: "preset.L", selfWeight: 0 },
  { kind: "S", nameKey: "preset.S", selfWeight: 0 },
  { kind: "W", nameKey: "preset.W", selfWeight: 0 },
  { kind: "E", nameKey: "preset.E", selfWeight: 0 },
  { kind: "T", nameKey: "preset.T", selfWeight: 0 },
  { kind: "Other", nameKey: "preset.Other", selfWeight: 0 },
];
const COMBINATION_KINDS: readonly CombinationKind[] = ["ULS", "SLS", "ACCIDENTAL", "ENVELOPE", "CUSTOM"];

/** Quita de las combinaciones los términos que citan un caso o combinación que se va a borrar. */
function detachRefs(project: Project, refType: "case" | "combination", id: Id): Command[] {
  return project.combinations.flatMap((c): Command[] =>
    c.terms.some((t) => t.refType === refType && t.ref === id)
      ? [{ type: "combination.update", payload: { id: c.id, patch: { terms: c.terms.filter((t) => !(t.refType === refType && t.ref === id)) } } }]
      : [],
  );
}

// --- patrones ---------------------------------------------------------------------------------------------------

function PatternRow({ pattern, index }: { pattern: LoadPattern; index: number }) {
  const t = useT();
  const store = useEditorStore();
  const active = useEditorSelector((s) => s.activePattern === pattern.id);
  const hidden = useEditorSelector((s) => s.hiddenPatterns.includes(pattern.id));
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Record<string, unknown>): string | null => {
    const e = run(store, { type: "pattern.update", payload: { id: pattern.id, patch } });
    setError(e);
    return e;
  };
  return (
    <li className={`pn-card${active ? " pn-active" : ""}`}>
      <div className="pn-row">
        <span className="pn-swatch" style={{ background: patternColor(index) }} title={t("pattern.colorNote")} aria-hidden="true" />
        <b className="pn-id">{pattern.id}</b>
        <label className="pn-radio">
          <input type="radio" name="active-pattern" checked={active} onChange={() => { store.setActivePattern(pattern.id); }} aria-label={t("pattern.makeActive", { id: pattern.id })} />
          <span>{t("pattern.active")}</span>
        </label>
        <CheckField label={t("pattern.visible")} checked={!hidden} onChange={(v) => { store.setPatternVisible(pattern.id, v); }} />
        <button
          type="button"
          className="pn-iconbtn"
          aria-label={t("common.deleteItem", { id: pattern.id })}
          title={t("pattern.deleteHint")}
          onClick={() => { setError(run(store, { type: "pattern.remove", payload: { id: pattern.id } })); }}
        >
          🗑
        </button>
      </div>
      <TextField label={t("common.name")} value={pattern.name} onCommit={(v) => update({ name: v })} />
      <div className="pn-row">
        <SelectField
          label={t("pattern.kind")}
          value={pattern.kind}
          options={PATTERN_KINDS.map((k): Option => ({ value: k, label: k }))}
          onChange={(v) => { update({ kind: v }); }}
        />
        <NumberField
          label={t("pattern.selfWeight")}
          quantity="factor"
          value={pattern.selfWeightFactor}
          onCommit={(v) => update({ selfWeightFactor: v ?? 0 })}
        />
      </div>
      <ErrorLine message={error} />
    </li>
  );
}

function PatternsSection() {
  const t = useT();
  const store = useEditorStore();
  const patterns = useEditorSelector((s) => s.project.patterns);
  const [error, setError] = useState<string | null>(null);
  const create = (kind: PatternKind, name: string, selfWeight: number): void => {
    const project = store.getState().project;
    const cmd = addPatternCommand(project, { name, kind, selfWeightFactor: selfWeight });
    const e = run(store, cmd);
    setError(e);
    if (!e && cmd.type === "pattern.add") store.setActivePattern(cmd.payload.item.id);
  };
  return (
    <Section
      title={t("tree.patterns")}
      count={patterns.length}
      actions={
        <MenuButton
          label={t("pattern.new")}
          items={PATTERN_PRESETS.map((p) => ({ id: p.kind, label: `${t(p.nameKey)} (${p.kind})`, onSelect: () => { create(p.kind, t(p.nameKey), p.selfWeight); } }))}
        />
      }
    >
      {patterns.length === 0 && <p className="pn-empty">{t("pattern.empty")}</p>}
      <ul className="pn-cards">
        {patterns.map((p, k) => <PatternRow key={p.id} pattern={p} index={k} />)}
      </ul>
      <p className="pn-hint">{t("pattern.colorNote")}</p>
      <ErrorLine message={error} />
    </Section>
  );
}

// --- casos --------------------------------------------------------------------------------------------------------

function CaseCard({ lc, patterns }: { lc: LoadCase; patterns: readonly LoadPattern[] }) {
  const t = useT();
  const store = useEditorStore();
  const shown = useEditorSelector((s) => s.results.caseId === lc.id);
  const [error, setError] = useState<string | null>(null);
  const setTerms = (terms: LoadCase["terms"]): string | null => {
    const e = run(store, { type: "case.update", payload: { id: lc.id, patch: { terms } } });
    setError(e);
    return e;
  };
  const patternOptions: Option[] = patterns.map((p) => ({ value: p.id, label: `${p.id} · ${p.name}` }));
  const unused = patterns.find((p) => !lc.terms.some((x) => x.pattern === p.id)) ?? patterns[0];
  return (
    <li className={`pn-card${shown ? " pn-active" : ""}`}>
      <div className="pn-row">
        <b className="pn-id">{lc.id}</b>
        <button type="button" aria-pressed={shown} onClick={() => { store.setResultCase(lc.id); }}>{shown ? t("case.shown") : t("case.show")}</button>
        <button
          type="button"
          className="pn-iconbtn"
          aria-label={t("common.deleteItem", { id: lc.id })}
          onClick={() => {
            const project = store.getState().project;
            const cmds = [...detachRefs(project, "case", lc.id), { type: "case.remove", payload: { id: lc.id } } as Command];
            setError(run(store, combine(cmds, "Borrar caso")));
          }}
        >
          🗑
        </button>
      </div>
      <TextField label={t("common.name")} value={lc.name} onCommit={(v) => run(store, { type: "case.update", payload: { id: lc.id, patch: { name: v } } })} />
      <ul className="pn-terms">
        {lc.terms.map((term, k) => (
          <li key={`${term.pattern}-${String(k)}`} className="pn-row">
            <SelectField
              label={t("case.term.pattern", { n: k + 1 })}
              value={term.pattern}
              options={patternOptions}
              onChange={(v) => { setTerms(lc.terms.map((x, q) => (q === k ? { ...x, pattern: v } : x))); }}
            />
            <NumberField
              label={t("term.factor", { n: k + 1 })}
              quantity="factor"
              value={term.factor}
              onCommit={(v) => setTerms(lc.terms.map((x, q) => (q === k ? { ...x, factor: v ?? 0 } : x)))}
            />
            <button type="button" className="pn-iconbtn" aria-label={t("term.remove", { n: k + 1 })} onClick={() => { setTerms(lc.terms.filter((_, q) => q !== k)); }}>×</button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={!unused} onClick={() => { if (unused) setTerms([...lc.terms, { pattern: unused.id, factor: 1 }]); }}>{t("term.add")}</button>
      <ErrorLine message={error} />
    </li>
  );
}

function CasesSection() {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const create = (): void => {
    const first = project.patterns[0];
    const cmd = addCaseCommand(project, { name: t("case.newName", { n: project.cases.length + 1 }), terms: first ? [{ pattern: first.id, factor: 1 }] : [] });
    setError(run(store, cmd));
    if (cmd.type === "case.add") store.setResultCase(cmd.payload.item.id);
  };
  /** Un caso con factor 1 por cada patrón que aún no aparece en ningún caso. */
  const perPattern = (): void => {
    const used = new Set(project.cases.flatMap((c) => c.terms.map((x) => x.pattern)));
    const missing = project.patterns.filter((p) => !used.has(p.id));
    const reserved = new Set<Id>();
    const cmds = missing.map((p): Command => {
      const id = nextId(project, "case", reserved);
      reserved.add(id);
      return addCaseCommand(project, { id, name: `${p.id} - ${p.name}`, terms: [{ pattern: p.id, factor: 1 }] });
    });
    if (cmds.length > 0) setError(run(store, combine(cmds, "Crear casos")));
  };
  const hasMissing = project.patterns.some((p) => !project.cases.some((c) => c.terms.some((x) => x.pattern === p.id)));
  return (
    <Section title={t("tree.cases")} count={project.cases.length}>
      <div className="pn-row">
        <button type="button" onClick={create}>{t("case.new")}</button>
        <button type="button" disabled={!hasMissing} title={t("case.perPatternHint")} onClick={perPattern}>{t("case.perPattern")}</button>
      </div>
      {project.cases.length === 0 && <p className="pn-empty">{t("case.empty")}</p>}
      <ul className="pn-cards">
        {project.cases.map((c) => <CaseCard key={c.id} lc={c} patterns={project.patterns} />)}
      </ul>
      <ErrorLine message={error} />
    </Section>
  );
}

// --- combinaciones -------------------------------------------------------------------------------------------------

function CombinationCard({ combo, project }: { combo: LoadCombination; project: Project }) {
  const t = useT();
  const store = useEditorStore();
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Record<string, unknown>): string | null => {
    const e = run(store, { type: "combination.update", payload: { id: combo.id, patch } });
    setError(e);
    return e;
  };
  const setTerms = (terms: LoadCombination["terms"]): string | null => update({ terms });
  const refOptions = (refType: "case" | "combination"): Option[] =>
    refType === "case"
      ? project.cases.map((c) => ({ value: c.id, label: `${c.id} · ${c.name}` }))
      : project.combinations.filter((c) => c.id !== combo.id).map((c) => ({ value: c.id, label: `${c.id} · ${c.name}` }));
  return (
    <li className="pn-card">
      <div className="pn-row">
        <b className="pn-id">{combo.id}</b>
        <SelectField
          label={t("combo.kind")}
          value={combo.kind}
          options={COMBINATION_KINDS.map((k): Option => ({ value: k, label: k }))}
          onChange={(v) => { update({ kind: v }); }}
        />
        <button
          type="button"
          className="pn-iconbtn"
          aria-label={t("common.deleteItem", { id: combo.id })}
          onClick={() => {
            const cmds = [...detachRefs(project, "combination", combo.id), { type: "combination.remove", payload: { id: combo.id } } as Command];
            setError(run(store, combine(cmds, "Borrar combinación")));
          }}
        >
          🗑
        </button>
      </div>
      <TextField label={t("common.name")} value={combo.name} onCommit={(v) => update({ name: v })} />
      {combo.terms.length === 0 && <p className="pn-warn">{t("combo.emptyWarn")}</p>}
      <ul className="pn-terms">
        {combo.terms.map((term, k) => (
          <li key={`${term.ref}-${String(k)}`} className="pn-row">
            <SelectField
              label={t("combo.term.type", { n: k + 1 })}
              value={term.refType}
              options={[{ value: "case", label: t("combo.type.case") }, { value: "combination", label: t("combo.type.combination") }]}
              onChange={(v) => {
                const refType = v === "combination" ? "combination" : "case";
                const first = refOptions(refType)[0];
                if (first) setTerms(combo.terms.map((x, q) => (q === k ? { ...x, refType, ref: first.value } : x)));
              }}
            />
            <SelectField
              label={t("combo.term.ref", { n: k + 1 })}
              value={term.ref}
              options={refOptions(term.refType)}
              onChange={(v) => { setTerms(combo.terms.map((x, q) => (q === k ? { ...x, ref: v } : x))); }}
            />
            <NumberField
              label={t("term.factor", { n: k + 1 })}
              quantity="factor"
              value={term.factor}
              onCommit={(v) => setTerms(combo.terms.map((x, q) => (q === k ? { ...x, factor: v ?? 0 } : x)))}
            />
            <button type="button" className="pn-iconbtn" aria-label={t("term.remove", { n: k + 1 })} onClick={() => { setTerms(combo.terms.filter((_, q) => q !== k)); }}>×</button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={project.cases.length === 0}
        onClick={() => {
          const c = project.cases[0];
          if (c) setTerms([...combo.terms, { ref: c.id, refType: "case", factor: 1 }]);
        }}
      >
        {t("term.add")}
      </button>
      <ErrorLine message={error} />
    </li>
  );
}

function CombinationsSection() {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const create = (): void => {
    const id = nextId(project, "combination");
    setError(run(store, {
      type: "combination.add",
      payload: { item: { id, name: t("combo.newName", { n: project.combinations.length + 1 }), kind: "ULS", terms: project.cases[0] ? [{ ref: project.cases[0].id, refType: "case", factor: 1.35 }] : [] } },
    }));
  };
  return (
    <Section title={t("tree.combinations")} count={project.combinations.length}>
      <div className="pn-row">
        <button type="button" onClick={create}>{t("combo.new")}</button>
        <button type="button" disabled title={t("combo.generateHint")}>{t("combo.generate")}</button>
      </div>
      {project.combinations.length === 0 && <p className="pn-empty">{t("combo.empty")}</p>}
      <ul className="pn-cards">
        {project.combinations.map((c) => <CombinationCard key={c.id} combo={c} project={project} />)}
      </ul>
      <p className="pn-hint">{t("combo.manualNote")}</p>
      <ErrorLine message={error} />
    </Section>
  );
}

export function CasesPanel() {
  return (
    <div className="pn-cases">
      <PatternsSection />
      <CasesSection />
      <CombinationsSection />
    </div>
  );
}
