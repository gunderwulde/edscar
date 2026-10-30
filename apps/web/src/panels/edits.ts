/** Utilidades de edición: traducen cambios de formulario a comandos de ui-state y devuelven el error si se rechazan. */
import type { Id, Member, Project } from "@edscar/model";
import {
  SUPPORT_PRESETS, classifySupport, type Command, type EditorStore, type EntityKind, type SupportPreset,
} from "@edscar/ui-state";
import type { FieldChange } from "./loadFields";
import { describeErrors } from "./validation";

/** Despacha un comando; devuelve el texto del error (de `validateProject`) si se rechaza, o null si se aplica. */
export function run(store: EditorStore, cmd: Command): string | null {
  const r = store.dispatch(cmd);
  return r.ok ? null : describeErrors(r.errors);
}

/** `<kind>.update` con un cambio de campo. */
export function updateEntity(store: EditorStore, kind: EntityKind, id: Id, change: FieldChange): string | null {
  const cmd = {
    type: `${kind}.update`,
    payload: { id, patch: change.patch, ...(change.unset && change.unset.length > 0 ? { unset: change.unset } : {}) },
  } as Command;
  return run(store, cmd);
}

type EndKey = "ux" | "uy" | "uz" | "rx" | "ry" | "rz";

/** Cambio de `releases` de una barra al fijar/quitar una liberación en un extremo (se eliminan los objetos vacíos). */
export function releaseChange(member: Member, end: "i" | "j", key: EndKey, value: boolean): FieldChange {
  const cur = member.releases ?? {};
  const without = Object.entries(cur[end] ?? {}).filter(([k]) => k !== key);
  const endNow = Object.fromEntries(value ? [...without, [key, true]] : without) as Partial<Record<EndKey, boolean>>;
  const next: { i?: Partial<Record<EndKey, boolean>>; j?: Partial<Record<EndKey, boolean>> } = {};
  const other = end === "i" ? "j" : "i";
  if (cur[other] && Object.keys(cur[other]).length > 0) next[other] = cur[other];
  if (Object.keys(endNow).length > 0) next[end] = endNow;
  return Object.keys(next).length === 0 ? { patch: {}, unset: ["releases"] } : { patch: { releases: next } };
}

export const isReleased = (member: Member, end: "i" | "j", key: EndKey): boolean => member.releases?.[end]?.[key] === true;

/** GDL del plano restringidos (ux, uz, ry) como banderas, para el editor de apoyos. */
export function supportFlags(fixed: readonly boolean[]): { ux: boolean; uz: boolean; ry: boolean } {
  return { ux: fixed[0] === true, uz: fixed[2] === true, ry: fixed[4] === true };
}

/** `fixed` completo a partir de las banderas del plano: uy, rx y rz se tratan como los presets (uy restringido). */
export function fixedFromFlags(f: { ux: boolean; uz: boolean; ry: boolean }): [boolean, boolean, boolean, boolean, boolean, boolean] {
  return [f.ux, true, f.uz, f.ry, f.ry, f.ry];
}

export type SupportChoice = SupportPreset | "none" | "custom";

export function supportChoice(project: Project, node: Id): SupportChoice {
  const s = project.supports.find((x) => x.node === node);
  if (!s) return "none";
  const c = classifySupport(s.fixed);
  if (c === null) return "custom";
  const exact = SUPPORT_PRESETS[c].every((v, i) => v === s.fixed[i]);
  return exact ? c : "custom";
}
