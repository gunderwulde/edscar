/** Editor de materiales y secciones (con valores por defecto orientativos). */
import { useState } from "react";
import type { Material, Section as SectionData } from "@edscar/model";
import { nextId } from "@edscar/ui-state";
import { useEditorSelector, useEditorStore } from "../store";
import { MATERIAL_PRESETS, SECTION_PRESETS, rectangularSection } from "./catalog";
import { run, updateEntity } from "./edits";
import { useT } from "./i18n";
import { ErrorLine, MenuButton, NumberField, Section, SelectField, TextField } from "./ui";

function MaterialEditor() {
  const t = useT();
  const store = useEditorStore();
  const materials = useEditorSelector((s) => s.project.materials);
  const members = useEditorSelector((s) => s.project.members);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current: Material | undefined = materials.find((m) => m.id === picked) ?? materials[0];
  const uses = current ? members.filter((m) => m.material === current.id).length : 0;
  const set = (key: keyof Material, v: number | string | null): string | null => {
    if (!current) return null;
    const e = updateEntity(store, "material", current.id, { patch: { [key]: v ?? 0 } });
    setError(e);
    return e;
  };
  const add = (values: Omit<Material, "id">): void => {
    const id = nextId(store.getState().project, "material");
    const e = run(store, { type: "material.add", payload: { item: { id, ...values } } });
    setError(e);
    if (!e) setPicked(id);
  };
  return (
    <Section
      title={t("tree.materials")}
      count={materials.length}
      actions={<MenuButton label={t("mat.new")} items={MATERIAL_PRESETS.map((p) => ({ id: p.key, label: t(p.nameKey), onSelect: () => { add(p.values); } }))} />}
    >
      {current && (
        <div className="pn-form">
          <SelectField label={t("mat.select")} value={current.id} options={materials.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))} onChange={setPicked} />
          <TextField label={t("common.name")} value={current.name} onCommit={(v) => set("name", v)} />
          <NumberField label="E" quantity="modulus" value={current.E} onCommit={(v) => set("E", v)} />
          <NumberField label="G" quantity="modulus" value={current.G} onCommit={(v) => set("G", v)} />
          <NumberField label={t("mat.density")} quantity="density" value={current.density} onCommit={(v) => set("density", v)} />
          <NumberField label="α" quantity="alpha" value={current.alpha} onCommit={(v) => set("alpha", v)} />
          <p className="pn-hint">{t("mat.used", { n: uses })}</p>
          <button
            type="button"
            onClick={() => { setError(run(store, { type: "material.remove", payload: { id: current.id } })); }}
          >
            {t("common.deleteItem", { id: current.id })}
          </button>
        </div>
      )}
      <p className="pn-hint">{t("catalog.note")}</p>
      <ErrorLine message={error} />
    </Section>
  );
}

function SectionEditor() {
  const t = useT();
  const store = useEditorStore();
  const sections = useEditorSelector((s) => s.project.sections);
  const members = useEditorSelector((s) => s.project.members);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [b, setB] = useState(0.3);
  const [h, setH] = useState(0.3);
  const current: SectionData | undefined = sections.find((m) => m.id === picked) ?? sections[0];
  const uses = current ? members.filter((m) => m.section === current.id).length : 0;
  const set = (key: keyof SectionData, v: number | string | null): string | null => {
    if (!current) return null;
    const e = updateEntity(store, "section", current.id, { patch: { [key]: v ?? 0 } });
    setError(e);
    return e;
  };
  const add = (values: Omit<SectionData, "id">): void => {
    const id = nextId(store.getState().project, "section");
    const e = run(store, { type: "section.add", payload: { item: { id, ...values } } });
    setError(e);
    if (!e) setPicked(id);
  };
  return (
    <Section
      title={t("tree.sections")}
      count={sections.length}
      actions={<MenuButton label={t("sec.new")} items={SECTION_PRESETS.map((p) => ({ id: p.key, label: p.name, onSelect: () => { add(p.values); } }))} />}
    >
      {current && (
        <div className="pn-form">
          <SelectField label={t("sec.select")} value={current.id} options={sections.map((m) => ({ value: m.id, label: `${m.id} · ${m.name}` }))} onChange={setPicked} />
          <TextField label={t("common.name")} value={current.name} onCommit={(v) => set("name", v)} />
          <NumberField label="A" quantity="area" value={current.A} onCommit={(v) => set("A", v)} />
          <NumberField label="Iy" quantity="inertia" value={current.Iy} onCommit={(v) => set("Iy", v)} />
          <NumberField label="Iz" quantity="inertia" value={current.Iz} onCommit={(v) => set("Iz", v)} />
          <NumberField label="J" quantity="inertia" value={current.J} onCommit={(v) => set("J", v)} />
          <p className="pn-hint">{t("mat.used", { n: uses })}</p>
          <button type="button" onClick={() => { setError(run(store, { type: "section.remove", payload: { id: current.id } })); }}>
            {t("common.deleteItem", { id: current.id })}
          </button>
        </div>
      )}
      <fieldset className="pn-fieldset">
        <legend>{t("sec.rect")}</legend>
        <NumberField label="b" quantity="length" value={b} onCommit={(v) => { if (v !== null && v > 0) { setB(v); return null; } return t("field.positive"); }} />
        <NumberField label="h" quantity="length" value={h} onCommit={(v) => { if (v !== null && v > 0) { setH(v); return null; } return t("field.positive"); }} />
        <button type="button" onClick={() => { add(rectangularSection(b, h)); }}>{t("sec.createRect")}</button>
      </fieldset>
      <p className="pn-hint">{t("catalog.note")}</p>
      <ErrorLine message={error} />
    </Section>
  );
}

export function MaterialsPanel() {
  return (
    <div className="pn-materials">
      <MaterialEditor />
      <SectionEditor />
    </div>
  );
}
