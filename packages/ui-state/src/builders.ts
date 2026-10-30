/**
 * Constructores de comandos y de proyectos nuevos (escrito desde cero). Los ids se generan aquí, antes de
 * crear el comando, para que el comando guardado en el historial sea determinista al rehacerlo.
 */
import type { Id, Load, LoadCase, LoadPattern, PatternKind, Project, Support, Vec3 } from "@edscar/model";
import { CURRENT_SCHEMA_VERSION } from "@edscar/model";
import { combine, type Command, type EntityKind } from "./commands";

export const DEFAULT_MATERIAL_ID = "MAT1";
export const DEFAULT_SECTION_ID = "SEC1";

const PREFIX: Record<EntityKind, string> = {
  node: "N", member: "B", material: "MAT", section: "SEC", support: "R", pattern: "P", load: "L", case: "C", combination: "U",
};

const COLLECTION_OF = {
  node: "nodes", member: "members", material: "materials", section: "sections",
  support: "supports", pattern: "patterns", load: "loads", case: "cases", combination: "combinations",
} as const;

/** Siguiente id libre `<prefijo><n>` de la colección; `reserved` evita choques con ids aún no aplicados. */
export function nextId(project: Project, kind: EntityKind, reserved: Iterable<Id> = []): Id {
  const list = project[COLLECTION_OF[kind]];
  const used = new Set<Id>([...list.map((e) => e.id), ...reserved]);
  let n = list.length + 1;
  while (used.has(`${PREFIX[kind]}${String(n)}`)) n++;
  return `${PREFIX[kind]}${String(n)}`;
}

/**
 * Proyecto vacío válido con un material y una sección por defecto (para poder dibujar barras de inmediato).
 * Material: acero estructural genérico (E = 210e6 kN/m², G = 81e6 kN/m², 7.85 t/m³, α = 1.2e-5 1/°C).
 * Sección: valores orientativos tipo IPE 200 (no normativos, ver nombre); el usuario puede editarlos.
 */
export function createEmptyProject(analysis: Project["analysis"] = "2D-XZ"): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    units: "SI",
    analysis,
    nodes: [], members: [],
    materials: [{ id: DEFAULT_MATERIAL_ID, name: "Acero (genérico)", E: 210e6, G: 81e6, density: 7.85, alpha: 1.2e-5 }],
    sections: [{ id: DEFAULT_SECTION_ID, name: "Sección por defecto (≈ IPE 200, orientativa)", A: 28.5e-4, Iy: 1943e-8, Iz: 142e-8, J: 7e-8 }],
    supports: [], patterns: [], loads: [], cases: [], combinations: [],
    settings: { gravity: [0, 0, -9.81] },
  };
}

// --- apoyos ---------------------------------------------------------------------------------------------

export type SupportPreset = "pinned" | "roller-x" | "roller-z" | "fixed";
type Fixed6 = Support["fixed"];

/**
 * Apoyos habituales en el plano X–Z, en ejes globales [ux, uy, uz, rx, ry, rz] (como el ejemplo del modelo, uy va
 * restringido; en 2D-XZ el solver lo restringe igualmente y no genera reacción):
 * - pinned: articulado fijo (ux, uz). - roller-x: móvil horizontal, solo uz. - roller-z: móvil vertical, solo ux.
 * - fixed: empotramiento (ux, uz, ry).
 */
export const SUPPORT_PRESETS: Record<SupportPreset, Fixed6> = {
  pinned: [true, true, true, false, false, false],
  "roller-x": [false, true, true, false, false, false],
  "roller-z": [true, true, false, false, false, false],
  fixed: [true, true, true, true, true, true],
};

/** Clasifica por los GDL del plano (ux, uz, ry); null si no coincide con un tipo habitual. */
export function classifySupport(fixed: Fixed6): SupportPreset | null {
  const [ux, , uz, , ry] = fixed;
  if (ux && uz && ry) return "fixed";
  if (ux && uz) return "pinned";
  if (uz) return "roller-x";
  if (ux) return "roller-z";
  return null;
}

/** Asigna (o sustituye) el apoyo de un nudo. */
export function setSupportCommand(project: Project, node: Id, preset: SupportPreset, reserved: Iterable<Id> = []): Command {
  const existing = project.supports.find((s) => s.node === node);
  const id = existing ? existing.id : nextId(project, "support", reserved);
  return { type: "support.set", payload: { item: { id, node, fixed: SUPPORT_PRESETS[preset] } } };
}

// --- geometría ------------------------------------------------------------------------------------------

/** Añade un nudo en el plano X–Z (y = 0). */
export function addNodeCommand(project: Project, x: number, z: number, id?: Id): Command {
  return { type: "node.add", payload: { item: { id: id ?? nextId(project, "node"), x, y: 0, z } } };
}

export interface AddMemberOptions { id?: Id; material?: Id; section?: Id }

/** Añade una barra; por defecto usa el primer material y la primera sección del proyecto. */
export function addMemberCommand(project: Project, i: Id, j: Id, opts: AddMemberOptions = {}): Command {
  return {
    type: "member.add",
    payload: {
      item: {
        id: opts.id ?? nextId(project, "member"), i, j,
        material: opts.material ?? project.materials[0]?.id ?? DEFAULT_MATERIAL_ID,
        section: opts.section ?? project.sections[0]?.id ?? DEFAULT_SECTION_ID,
      },
    },
  };
}

/** Asigna material y/o sección a varias barras. */
export function assignPropertiesCommand(memberIds: readonly Id[], props: { material?: Id; section?: Id }): Command {
  const patch: Record<string, unknown> = {};
  if (props.material !== undefined) patch["material"] = props.material;
  if (props.section !== undefined) patch["section"] = props.section;
  return combine(memberIds.map((id): Command => ({ type: "member.update", payload: { id, patch } })), "Asignar material/sección");
}

// --- patrones, cargas y casos ---------------------------------------------------------------------------

export function addPatternCommand(
  project: Project,
  opts: { name: string; kind: PatternKind; selfWeightFactor?: number; id?: Id },
): Command {
  const item: LoadPattern = {
    id: opts.id ?? nextId(project, "pattern"), name: opts.name, kind: opts.kind, selfWeightFactor: opts.selfWeightFactor ?? 0,
  };
  return { type: "pattern.add", payload: { item } };
}

export function addCaseCommand(
  project: Project,
  opts: { name: string; terms: { pattern: Id; factor: number }[]; id?: Id },
): Command {
  const item: LoadCase = { id: opts.id ?? nextId(project, "case"), name: opts.name, type: "static-linear", terms: opts.terms };
  return { type: "case.add", payload: { item } };
}

/** `Load` con id opcional (distribuido sobre la unión) para construir `load.add` con id generado. */
type DistributiveOmitId<T> = T extends unknown ? Omit<T, "id"> & { id?: Id } : never;
export type NewLoad = DistributiveOmitId<Load>;

export function addLoadCommand(project: Project, load: NewLoad, reserved: Iterable<Id> = []): Command {
  const item = { ...load, id: load.id ?? nextId(project, "load", reserved) };
  return { type: "load.add", payload: { item } };
}

export const uniformLoad = (pattern: Id, member: Id, w: Vec3, frame: "local" | "global" = "global"): NewLoad =>
  ({ type: "member-uniform", pattern, member, w, frame });

// --- selección ------------------------------------------------------------------------------------------

export interface SelectionLike { nodes: readonly Id[]; members: readonly Id[]; loads: readonly Id[] }

/** Borra la selección: primero cargas, luego barras y al final nudos (con cascada). null si no hay nada. */
export function deleteSelectionCommand(sel: SelectionLike): Command | null {
  const cmds: Command[] = [
    ...sel.loads.map((id): Command => ({ type: "load.remove", payload: { id } })),
    ...sel.members.map((id): Command => ({ type: "member.remove", payload: { id } })),
    ...sel.nodes.map((id): Command => ({ type: "node.remove", payload: { id } })),
  ];
  return cmds.length === 0 ? null : combine(cmds, "Borrar selección");
}
