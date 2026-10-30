/** Panel 'Propiedades' del elemento seleccionado: edición numérica con unidades y errores junto al campo. */
import { useState } from "react";
import type { Id, Load, Member, Node } from "@edscar/model";
import {
  assignPropertiesCommand, nextId, setSupportCommand, type EditorStore,
} from "@edscar/ui-state";
import { useEditorSelector, useEditorStore } from "../store";
import {
  fixedFromFlags, isReleased, releaseChange, run, supportChoice, supportFlags, updateEntity, type SupportChoice,
} from "./edits";
import { useT, type MessageKey } from "./i18n";
import { loadFields, loadTarget, loadTypeKey, type FieldDef } from "./loadFields";
import { usePrefs } from "./prefs";
import { formatPlain, toDisplay, unitLabel } from "./units";
import { CheckField, ErrorLine, NumberField, Section, SelectField } from "./ui";

/** Renderiza un campo de `loadFields` y lo conecta con `load.update`. */
export function LoadFieldEditor({ def, loadId, compact, cell }: { def: FieldDef; loadId: Id; compact?: boolean; cell?: { row: number; col: number } }) {
  const t = useT();
  const store = useEditorStore();
  const [error, setError] = useState<string | null>(null);
  const label = def.kind === "number" ? def.label : def.labelKey ? t(def.labelKey) : def.label;
  if (def.kind === "number") {
    return (
      <NumberField
        label={label}
        quantity={def.quantity}
        value={def.value}
        optional={def.optional}
        compact={compact}
        {...(cell ? { cell } : {})}
        onCommit={(v) => updateEntity(store, "load", loadId, def.apply(v))}
      />
    );
  }
  if (def.kind === "bool") {
    return (
      <>
        <CheckField label={label} checked={def.value} onChange={(v) => { setError(updateEntity(store, "load", loadId, def.apply(v))); }} />
        <ErrorLine message={error} />
      </>
    );
  }
  return (
    <>
      <SelectField
        label={label}
        value={def.value}
        compact={compact}
        options={def.options.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        onChange={(v) => { setError(updateEntity(store, "load", loadId, def.apply(v))); }}
      />
      <ErrorLine message={error} />
    </>
  );
}

const SUPPORT_OPTIONS: { value: SupportChoice; key: MessageKey }[] = [
  { value: "none", key: "support.none" },
  { value: "pinned", key: "support.pinned" },
  { value: "roller-x", key: "support.rollerX" },
  { value: "roller-z", key: "support.rollerZ" },
  { value: "fixed", key: "support.fixed" },
  { value: "custom", key: "support.custom" },
];

/** Cambia el apoyo de un nudo (o lo quita). */
export function applySupport(store: EditorStore, node: Id, choice: SupportChoice): string | null {
  const project = store.getState().project;
  const existing = project.supports.find((s) => s.node === node);
  if (choice === "none") return existing ? run(store, { type: "support.remove", payload: { id: existing.id } }) : null;
  if (choice === "custom") return null;
  return run(store, setSupportCommand(project, node, choice));
}

function NodeProps({ node }: { node: Node }) {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const choice = supportChoice(project, node.id);
  const support = project.supports.find((s) => s.node === node.id);
  const flags = supportFlags(support?.fixed ?? []);
  const setFlags = (next: { ux: boolean; uz: boolean; ry: boolean }): void => {
    const id = support?.id ?? nextId(project, "support");
    setError(run(store, { type: "support.set", payload: { item: { id, node: node.id, fixed: fixedFromFlags(next) } } }));
  };
  return (
    <Section title={t("props.node", { id: node.id })}>
      <NumberField label="x" quantity="length" value={node.x} onCommit={(v) => run(store, { type: "node.move", payload: { id: node.id, x: v ?? 0, z: node.z } })} />
      {project.analysis === "3D" && (
        <NumberField label="y" quantity="length" value={node.y} onCommit={(v) => updateEntity(store, "node", node.id, { patch: { y: v ?? 0 } })} />
      )}
      <NumberField label="z" quantity="length" value={node.z} onCommit={(v) => run(store, { type: "node.move", payload: { id: node.id, x: node.x, z: v ?? 0 } })} />
      <SelectField
        label={t("props.support")}
        value={choice}
        options={SUPPORT_OPTIONS.filter((o) => o.value !== "custom" || choice === "custom").map((o) => ({ value: o.value, label: t(o.key) }))}
        onChange={(v) => { setError(applySupport(store, node.id, v as SupportChoice)); }}
      />
      {support && (
        <fieldset className="pn-fieldset">
          <legend>{t("props.dofs")}</legend>
          <CheckField label={t("dof.ux")} checked={flags.ux} onChange={(v) => { setFlags({ ...flags, ux: v }); }} />
          <CheckField label={t("dof.uz")} checked={flags.uz} onChange={(v) => { setFlags({ ...flags, uz: v }); }} />
          <CheckField label={t("dof.ry")} checked={flags.ry} onChange={(v) => { setFlags({ ...flags, ry: v }); }} />
        </fieldset>
      )}
      <ErrorLine message={error} />
    </Section>
  );
}

function ReleaseBoxes({ member, end }: { member: Member; end: "i" | "j" }) {
  const t = useT();
  const store = useEditorStore();
  const [error, setError] = useState<string | null>(null);
  const keys: { key: "ux" | "uz" | "ry"; label: MessageKey }[] = [
    { key: "ux", label: "release.ux" }, { key: "uz", label: "release.uz" }, { key: "ry", label: "release.ry" },
  ];
  return (
    <fieldset className="pn-fieldset">
      <legend>{t(end === "i" ? "props.releaseI" : "props.releaseJ", { node: end === "i" ? member.i : member.j })}</legend>
      {keys.map((k) => (
        <CheckField
          key={k.key}
          label={t(k.label)}
          checked={isReleased(member, end, k.key)}
          onChange={(v) => { setError(updateEntity(store, "member", member.id, releaseChange(member, end, k.key, v))); }}
        />
      ))}
      <ErrorLine message={error} />
    </fieldset>
  );
}

function MemberProps({ member }: { member: Member }) {
  const t = useT();
  const store = useEditorStore();
  const { units } = usePrefs();
  const project = useEditorSelector((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const ni = project.nodes.find((n) => n.id === member.i);
  const nj = project.nodes.find((n) => n.id === member.j);
  const L = ni && nj ? Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z) : 0;
  const set = (patch: Record<string, unknown>): void => {
    setError(updateEntity(store, "member", member.id, { patch }));
  };
  const nodeOpts = project.nodes.map((n) => ({ value: n.id, label: n.id }));
  const flipped = member.rotation !== undefined && Math.abs(member.rotation) > 1e-9;
  return (
    <Section title={t("props.member", { id: member.id })}>
      <div className="pn-row">
        <SelectField label={t("props.nodeI")} value={member.i} options={nodeOpts} onChange={(v) => { set({ i: v }); }} />
        <SelectField label={t("props.nodeJ")} value={member.j} options={nodeOpts} onChange={(v) => { set({ j: v }); }} />
      </div>
      <p className="pn-hint">{t("props.length")}: {formatPlain(toDisplay("length", L, units))} {unitLabel("length", units)}</p>
      <SelectField label={t("props.material")} value={member.material} options={project.materials.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))} onChange={(v) => { set({ material: v }); }} />
      <SelectField label={t("props.section")} value={member.section} options={project.sections.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))} onChange={(v) => { set({ section: v }); }} />
      <SelectField
        label={t("props.rotation")}
        value={flipped ? "pi" : "0"}
        options={[{ value: "0", label: "0°" }, { value: "pi", label: "180°" }]}
        onChange={(v) => {
          if (v === "pi") set({ rotation: Math.PI });
          else setError(updateEntity(store, "member", member.id, { patch: {}, unset: ["rotation"] }));
        }}
      />
      <ReleaseBoxes member={member} end="i" />
      <ReleaseBoxes member={member} end="j" />
      <ErrorLine message={error} />
    </Section>
  );
}

function LoadProps({ load }: { load: Load }) {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const target = loadTarget(load);
  const fields = loadFields(load, project.analysis);
  const patch = (p: Record<string, unknown>): void => {
    setError(updateEntity(store, "load", load.id, { patch: p }));
  };
  const targets = target.kind === "node" ? project.nodes : project.members;
  return (
    <Section title={t("props.load", { id: load.id })}>
      <p className="pn-hint">{t(loadTypeKey(load))}</p>
      <SelectField label={t("props.pattern")} value={load.pattern} options={project.patterns.map((p) => ({ value: p.id, label: `${p.id} · ${p.name}` }))} onChange={(v) => { patch({ pattern: v }); }} />
      <SelectField
        label={t(target.kind === "node" ? "props.targetNode" : "props.targetMember")}
        value={target.id}
        options={targets.map((x) => ({ value: x.id, label: x.id }))}
        onChange={(v) => { patch({ [target.kind]: v }); }}
      />
      {fields.map((f) => <LoadFieldEditor key={f.id} def={f} loadId={load.id} />)}
      <p className="pn-hint">{t("props.loadUnitsNote")}</p>
      <button type="button" onClick={() => { setError(run(store, { type: "load.remove", payload: { id: load.id } })); }}>{t("common.deleteItem", { id: load.id })}</button>
      <ErrorLine message={error} />
    </Section>
  );
}

function MembersBulk({ ids }: { ids: readonly Id[] }) {
  const t = useT();
  const store = useEditorStore();
  const project = useEditorSelector((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const mats = new Set(project.members.filter((m) => ids.includes(m.id)).map((m) => m.material));
  const secs = new Set(project.members.filter((m) => ids.includes(m.id)).map((m) => m.section));
  const mixed = { value: "", label: t("props.mixed") };
  const assign = (props: { material?: Id; section?: Id }): void => {
    store.beginGroup(t("props.assignGroup"));
    const e = run(store, assignPropertiesCommand(ids, props));
    store.endGroup();
    setError(e);
  };
  return (
    <Section title={t("props.members", { n: ids.length })}>
      <SelectField
        label={t("props.material")}
        value={mats.size === 1 ? ([...mats][0] ?? "") : ""}
        options={[...(mats.size === 1 ? [] : [mixed]), ...project.materials.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))]}
        onChange={(v) => { if (v !== "") assign({ material: v }); }}
      />
      <SelectField
        label={t("props.section")}
        value={secs.size === 1 ? ([...secs][0] ?? "") : ""}
        options={[...(secs.size === 1 ? [] : [mixed]), ...project.sections.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))]}
        onChange={(v) => { if (v !== "") assign({ section: v }); }}
      />
      <ErrorLine message={error} />
    </Section>
  );
}

function NodesBulk({ ids }: { ids: readonly Id[] }) {
  const t = useT();
  const store = useEditorStore();
  const [error, setError] = useState<string | null>(null);
  const apply = (choice: SupportChoice): void => {
    store.beginGroup(t("props.supportGroup"));
    let e: string | null = null;
    for (const id of ids) {
      e = applySupport(store, id, choice);
      if (e) break;
    }
    if (e) store.cancelGroup();
    else store.endGroup();
    setError(e);
  };
  return (
    <Section title={t("props.nodes", { n: ids.length })}>
      <SelectField
        label={t("props.supportAll")}
        value=""
        options={[{ value: "", label: t("props.choose") }, ...SUPPORT_OPTIONS.filter((o) => o.value !== "custom").map((o) => ({ value: o.value, label: t(o.key) }))]}
        onChange={(v) => { if (v !== "") apply(v as SupportChoice); }}
      />
      <ErrorLine message={error} />
    </Section>
  );
}

function LoadsBulk({ ids }: { ids: readonly Id[] }) {
  const t = useT();
  const store = useEditorStore();
  return (
    <Section title={t("props.loads", { n: ids.length })}>
      <button type="button" onClick={() => { store.deleteSelection(); }}>{t("props.deleteLoads")}</button>
    </Section>
  );
}

export function PropertiesPanel() {
  const t = useT();
  const selection = useEditorSelector((s) => s.selection);
  const project = useEditorSelector((s) => s.project);
  const total = selection.nodes.length + selection.members.length + selection.loads.length;
  const node = selection.nodes.length === 1 ? project.nodes.find((n) => n.id === selection.nodes[0]) : undefined;
  const member = selection.members.length === 1 ? project.members.find((n) => n.id === selection.members[0]) : undefined;
  const load = selection.loads.length === 1 ? project.loads.find((n) => n.id === selection.loads[0]) : undefined;
  return (
    <div className="pn-props">
      {total === 0 && <p className="pn-empty">{t("props.empty")}</p>}
      {node ? <NodeProps node={node} /> : selection.nodes.length > 1 && <NodesBulk ids={selection.nodes} />}
      {member ? <MemberProps member={member} /> : selection.members.length > 1 && <MembersBulk ids={selection.members} />}
      {load ? <LoadProps load={load} /> : selection.loads.length > 1 && <LoadsBulk ids={selection.loads} />}
    </div>
  );
}
