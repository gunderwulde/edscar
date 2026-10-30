/**
 * Tabla de datos editable tipo hoja (nudos, barras, cargas), sincronizada con el lienzo mediante la selección del
 * store. Enter / flechas arriba-abajo mueven entre filas de la misma columna; Esc cancela la edición de una celda.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Id } from "@edscar/model";
import { addMemberCommand, addNodeCommand, nextId } from "@edscar/ui-state";
import { useEditorSelector, useEditorStore } from "../store";
import { isReleased, releaseChange, run, supportChoice, type SupportChoice, updateEntity } from "./edits";
import { useT, type MessageKey } from "./i18n";
import { loadFields, loadTarget, loadTypeKey } from "./loadFields";
import { LoadFieldEditor, applySupport } from "./PropertiesPanel";
import { ErrorLine, NumberField, SelectField, Tabs } from "./ui";

const MAX_ROWS = 500;
type TableId = "nodes" | "members" | "loads";

const SUPPORT_KEYS: { value: SupportChoice; key: MessageKey }[] = [
  { value: "none", key: "support.none" }, { value: "pinned", key: "support.pinned" }, { value: "roller-x", key: "support.rollerX" },
  { value: "roller-z", key: "support.rollerZ" }, { value: "fixed", key: "support.fixed" }, { value: "custom", key: "support.custom" },
];

function useGridNav(): { onKeyDown: (e: KeyboardEvent<HTMLElement>) => void } {
  return {
    onKeyDown(e) {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.dataset["row"] === undefined) return;
      const dir = e.key === "ArrowDown" || e.key === "Enter" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dir === 0) return;
      const row = Number(el.dataset["row"]);
      const col = el.dataset["col"] ?? "";
      const next = e.currentTarget.querySelector<HTMLInputElement>(`input[data-row="${String(row + dir)}"][data-col="${col}"]`);
      if (next) {
        e.preventDefault();
        next.focus();
        next.select();
      }
    },
  };
}

/** Atributos comunes de fila: selección sincronizada y desplazamiento a la vista. */
function useSelectedRowScroll(selected: boolean) {
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    if (selected && typeof ref.current?.scrollIntoView === "function") ref.current.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return ref;
}

function RowHead({ id, selected, onSelect }: { id: Id; selected: boolean; onSelect: (e: MouseEvent) => void }) {
  const ref = useSelectedRowScroll(selected);
  return (
    <th scope="row" ref={ref}>
      <button type="button" aria-pressed={selected} onClick={onSelect}>{id}</button>
    </th>
  );
}

function NodesTable({ onError }: { onError: (e: string | null) => void }) {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const selection = useEditorSelector((s) => s.selection);
  const sel = new Set(selection.nodes);
  return (
    <table className="pn-table">
      <caption className="pn-sr">{t("table.nodes")}</caption>
      <thead><tr><th scope="col">{t("table.id")}</th><th scope="col">x</th>{project.analysis === "3D" && <th scope="col">y</th>}<th scope="col">z</th><th scope="col">{t("props.support")}</th></tr></thead>
      <tbody>
        {project.nodes.slice(0, MAX_ROWS).map((n, r) => (
          <tr key={n.id} aria-selected={sel.has(n.id)} className={sel.has(n.id) ? "pn-selected" : undefined}>
            <RowHead id={n.id} selected={sel.has(n.id)} onSelect={(e) => { store.select({ nodes: [n.id] }, e.ctrlKey || e.metaKey || e.shiftKey ? "toggle" : "replace"); }} />
            <td><NumberField compact label={`${n.id} x`} quantity="length" value={n.x} cell={{ row: r, col: 0 }} onCommit={(v) => run(store, { type: "node.move", payload: { id: n.id, x: v ?? 0, z: n.z } })} /></td>
            {project.analysis === "3D" && <td><NumberField compact label={`${n.id} y`} quantity="length" value={n.y} cell={{ row: r, col: 1 }} onCommit={(v) => updateEntity(store, "node", n.id, { patch: { y: v ?? 0 } })} /></td>}
            <td><NumberField compact label={`${n.id} z`} quantity="length" value={n.z} cell={{ row: r, col: 2 }} onCommit={(v) => run(store, { type: "node.move", payload: { id: n.id, x: n.x, z: v ?? 0 } })} /></td>
            <td>
              <SelectField
                compact
                label={`${n.id} ${t("props.support")}`}
                value={supportChoice(project, n.id)}
                options={SUPPORT_KEYS.filter((o) => o.value !== "custom" || supportChoice(project, n.id) === "custom").map((o) => ({ value: o.value, label: t(o.key) }))}
                onChange={(v) => { onError(applySupport(store, n.id, v as SupportChoice)); }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MembersTable({ onError }: { onError: (e: string | null) => void }) {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const selection = useEditorSelector((s) => s.selection);
  const sel = new Set(selection.members);
  const nodeOpts = project.nodes.map((n) => ({ value: n.id, label: n.id }));
  const upd = (id: Id, patch: Record<string, unknown>): void => {
    onError(updateEntity(store, "member", id, { patch }));
  };
  return (
    <table className="pn-table">
      <caption className="pn-sr">{t("table.members")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("table.id")}</th><th scope="col">{t("props.nodeI")}</th><th scope="col">{t("props.nodeJ")}</th><th scope="col">L</th>
          <th scope="col">{t("props.material")}</th><th scope="col">{t("props.section")}</th><th scope="col">{t("table.hingeI")}</th><th scope="col">{t("table.hingeJ")}</th>
        </tr>
      </thead>
      <tbody>
        {project.members.slice(0, MAX_ROWS).map((m) => {
          const a = project.nodes.find((n) => n.id === m.i);
          const b = project.nodes.find((n) => n.id === m.j);
          const L = a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;
          return (
            <tr key={m.id} aria-selected={sel.has(m.id)} className={sel.has(m.id) ? "pn-selected" : undefined}>
              <RowHead id={m.id} selected={sel.has(m.id)} onSelect={(e) => { store.select({ members: [m.id] }, e.ctrlKey || e.metaKey || e.shiftKey ? "toggle" : "replace"); }} />
              <td><SelectField compact label={`${m.id} ${t("props.nodeI")}`} value={m.i} options={nodeOpts} onChange={(v) => { upd(m.id, { i: v }); }} /></td>
              <td><SelectField compact label={`${m.id} ${t("props.nodeJ")}`} value={m.j} options={nodeOpts} onChange={(v) => { upd(m.id, { j: v }); }} /></td>
              <td><NumberField compact label={`${m.id} L`} quantity="length" value={L} disabled onCommit={() => null} /></td>
              <td><SelectField compact label={`${m.id} ${t("props.material")}`} value={m.material} options={project.materials.map((x) => ({ value: x.id, label: x.id }))} onChange={(v) => { upd(m.id, { material: v }); }} /></td>
              <td><SelectField compact label={`${m.id} ${t("props.section")}`} value={m.section} options={project.sections.map((x) => ({ value: x.id, label: x.id }))} onChange={(v) => { upd(m.id, { section: v }); }} /></td>
              {(["i", "j"] as const).map((end) => (
                <td key={end}>
                  <input
                    type="checkbox"
                    checked={isReleased(m, end, "ry")}
                    aria-label={`${m.id} ${t(end === "i" ? "table.hingeI" : "table.hingeJ")}`}
                    onChange={(e) => { onError(updateEntity(store, "member", m.id, releaseChange(m, end, "ry", e.target.checked))); }}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LoadsTable({ onError }: { onError: (e: string | null) => void }) {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const selection = useEditorSelector((s) => s.selection);
  const sel = new Set(selection.loads);
  return (
    <table className="pn-table">
      <caption className="pn-sr">{t("table.loads")}</caption>
      <thead>
        <tr><th scope="col">{t("table.id")}</th><th scope="col">{t("props.pattern")}</th><th scope="col">{t("table.type")}</th><th scope="col">{t("table.target")}</th><th scope="col">{t("table.values")}</th></tr>
      </thead>
      <tbody>
        {project.loads.slice(0, MAX_ROWS).map((l) => {
          const tg = loadTarget(l);
          return (
            <tr key={l.id} aria-selected={sel.has(l.id)} className={sel.has(l.id) ? "pn-selected" : undefined}>
              <RowHead id={l.id} selected={sel.has(l.id)} onSelect={(e) => { store.select({ loads: [l.id] }, e.ctrlKey || e.metaKey || e.shiftKey ? "toggle" : "replace"); }} />
              <td>
                <SelectField compact label={`${l.id} ${t("props.pattern")}`} value={l.pattern} options={project.patterns.map((p) => ({ value: p.id, label: p.id }))} onChange={(v) => { onError(updateEntity(store, "load", l.id, { patch: { pattern: v } })); }} />
              </td>
              <td>{t(loadTypeKey(l))}</td>
              <td>{tg.id}</td>
              <td className="pn-values">
                {loadFields(l, project.analysis).map((f) => (
                  <span key={f.id} className="pn-inline">
                    <span className="pn-dim" aria-hidden="true">{f.kind === "bool" && f.labelKey ? t(f.labelKey) : f.label}</span>
                    <LoadFieldEditor def={f} loadId={l.id} compact />
                  </span>
                ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DataTable() {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const selection = useEditorSelector((s) => s.selection);
  const [tab, setTab] = useState<TableId>("nodes");
  const [error, setError] = useState<string | null>(null);
  const nav = useGridNav();

  const addNode = (): void => {
    const p = store.getState().project;
    const x = p.nodes.reduce((m, n) => Math.max(m, n.x), -1) + 1;
    setError(run(store, addNodeCommand(p, p.nodes.length === 0 ? 0 : x, 0, nextId(p, "node"))));
  };
  const addMember = (): void => {
    const p = store.getState().project;
    const pick = selection.nodes.length >= 2 ? selection.nodes : p.nodes.slice(-2).map((n) => n.id);
    const [i, j] = pick;
    if (i === undefined || j === undefined) {
      setError(t("table.needTwoNodes"));
      return;
    }
    setError(run(store, addMemberCommand(p, i, j)));
  };
  const total = tab === "nodes" ? project.nodes.length : tab === "members" ? project.members.length : project.loads.length;

  return (
    <div className="pn-datatable" onKeyDown={nav.onKeyDown}>
      <Tabs
        ariaLabel={t("table.title")}
        active={tab}
        onChange={(id) => { setTab(id as TableId); setError(null); }}
        tabs={[
          { id: "nodes", label: `${t("tree.nodes")} (${String(project.nodes.length)})` },
          { id: "members", label: `${t("tree.members")} (${String(project.members.length)})` },
          { id: "loads", label: `${t("tree.loads")} (${String(project.loads.length)})` },
        ]}
      >
        <div className="pn-row pn-tablebar">
          {tab === "nodes" && <button type="button" onClick={addNode}>{t("table.addNode")}</button>}
          {tab === "members" && <button type="button" onClick={addMember}>{t("table.addMember")}</button>}
          <button type="button" onClick={() => { store.deleteSelection(); }} disabled={selection.nodes.length + selection.members.length + selection.loads.length === 0}>{t("table.deleteSelection")}</button>
          <span className="pn-hint">{t("table.hint")}</span>
        </div>
        <ErrorLine message={error} />
        <div className="pn-tablewrap">
          {total === 0 && <p className="pn-empty">{t("table.empty")}</p>}
          {total > MAX_ROWS && <p className="pn-warn">{t("table.truncated", { n: MAX_ROWS })}</p>}
          {tab === "nodes" && total > 0 && <NodesTable onError={setError} />}
          {tab === "members" && total > 0 && <MembersTable onError={setError} />}
          {tab === "loads" && total > 0 && <LoadsTable onError={setError} />}
        </div>
      </Tabs>
    </div>
  );
}
