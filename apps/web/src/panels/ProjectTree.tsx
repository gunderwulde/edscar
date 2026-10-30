/** Árbol del proyecto: listas de nudos, barras, cargas, patrones, casos, combinaciones, materiales y secciones. */
import { useMemo, type MouseEvent } from "react";
import type { Id } from "@edscar/model";
import { patternColor } from "../canvas/format";
import { useEditorSelector, useEditorStore } from "../store";
import { useT } from "./i18n";
import { loadTarget, loadTypeKey } from "./loadFields";
import { formatPlain, toDisplay, unitLabel } from "./units";
import { usePrefs } from "./prefs";
import { Section } from "./ui";

export type LeftTab = "model" | "cases" | "materials";

export function ProjectTree({ onNavigate }: { onNavigate: (tab: LeftTab) => void }) {
  const t = useT();
  const store = useEditorStore();
  const { units } = usePrefs();
  const project = useEditorSelector((s) => s.project);
  const selection = useEditorSelector((s) => s.selection);
  const activePattern = useEditorSelector((s) => s.activePattern);
  const hidden = useEditorSelector((s) => s.hiddenPatterns);

  const selNodes = useMemo(() => new Set(selection.nodes), [selection.nodes]);
  const selMembers = useMemo(() => new Set(selection.members), [selection.members]);
  const selLoads = useMemo(() => new Set(selection.loads), [selection.loads]);
  const supportByNode = useMemo(() => new Map(project.supports.map((s) => [s.node, s])), [project.supports]);

  const mode = (e: MouseEvent): "toggle" | "replace" => (e.ctrlKey || e.metaKey || e.shiftKey ? "toggle" : "replace");
  const len = (v: number): string => `${formatPlain(toDisplay("length", v, units))} ${unitLabel("length", units)}`;
  const nodeById = useMemo(() => new Map(project.nodes.map((n) => [n.id, n])), [project.nodes]);

  const memberLength = (i: Id, j: Id): number => {
    const a = nodeById.get(i);
    const b = nodeById.get(j);
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;
  };

  return (
    <div className="pn-tree">
      <Section title={t("tree.nodes")} count={project.nodes.length}>
        <ul className="pn-list">
          {project.nodes.map((n) => (
            <li key={n.id}>
              <button type="button" aria-pressed={selNodes.has(n.id)} onClick={(e) => { store.select({ nodes: [n.id] }, mode(e)); }}>
                <b>{n.id}</b> <span className="pn-dim">({len(n.x)}, {len(n.z)})</span>
                {supportByNode.has(n.id) && <span className="pn-tag">{t("tree.support")}</span>}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tree.members")} count={project.members.length}>
        <ul className="pn-list">
          {project.members.map((m) => (
            <li key={m.id}>
              <button type="button" aria-pressed={selMembers.has(m.id)} onClick={(e) => { store.select({ members: [m.id] }, mode(e)); }}>
                <b>{m.id}</b> <span className="pn-dim">{m.i}–{m.j}, L = {len(memberLength(m.i, m.j))}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tree.loads")} count={project.loads.length} defaultOpen={false}>
        <ul className="pn-list">
          {project.loads.map((l) => {
            const tg = loadTarget(l);
            return (
              <li key={l.id}>
                <button type="button" aria-pressed={selLoads.has(l.id)} onClick={(e) => { store.select({ loads: [l.id] }, mode(e)); }}>
                  <span className="pn-swatch" style={{ background: patternColor(project.patterns.findIndex((p) => p.id === l.pattern)) }} aria-hidden="true" />
                  <b>{l.id}</b> <span className="pn-dim">{l.pattern} · {t(loadTypeKey(l))} · {tg.id}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("tree.patterns")} count={project.patterns.length}>
        <ul className="pn-list">
          {project.patterns.map((p, k) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={activePattern === p.id}
                onClick={() => { store.setActivePattern(p.id); onNavigate("cases"); }}
              >
                <span className="pn-swatch" style={{ background: patternColor(k) }} aria-hidden="true" />
                <b>{p.id}</b> <span className="pn-dim">{p.name} ({p.kind})</span>
                {hidden.includes(p.id) && <span className="pn-tag">{t("tree.hidden")}</span>}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tree.cases")} count={project.cases.length}>
        <ul className="pn-list">
          {project.cases.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { store.setResultCase(c.id); onNavigate("cases"); }}>
                <b>{c.id}</b> <span className="pn-dim">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tree.combinations")} count={project.combinations.length}>
        <ul className="pn-list">
          {project.combinations.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onNavigate("cases"); }}>
                <b>{c.id}</b> <span className="pn-dim">{c.name} ({c.kind})</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tree.materials")} count={project.materials.length} defaultOpen={false}>
        <ul className="pn-list">
          {project.materials.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { onNavigate("materials"); }}>
                <b>{m.id}</b> <span className="pn-dim">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("tree.sections")} count={project.sections.length} defaultOpen={false}>
        <ul className="pn-list">
          {project.sections.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => { onNavigate("materials"); }}>
                <b>{s.id}</b> <span className="pn-dim">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
