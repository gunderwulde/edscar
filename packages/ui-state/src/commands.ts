/**
 * Comandos serializables sobre el `Project` de @edscar/model (escrito desde cero).
 *
 * Todo cambio del modelo es un `Command` `{ type, payload }` que sobrevive a `JSON.stringify`/`JSON.parse`.
 * `applyCommand` es puro: devuelve el proyecto nuevo y el comando inverso, o los errores dejando la entrada
 * intacta. Tras aplicar se valida el proyecto completo con `validateProject`; si falla, el comando se rechaza.
 *
 * Tipos de comando (K = node | member | material | section | support | pattern | load | case):
 *   K.add     { item, index? }                  añade (index = posición para restaurar el orden original)
 *   K.remove  { id }                            borra con cascada (ver `removeWithCascade`)
 *   K.update  { id, patch, unset? }             cambia/quita propiedades (asignar material/sección, editar carga…)
 *   node.move { id, x, z }                      mueve un nudo en el plano X–Z (y no cambia)
 *   support.set { item }                        asigna/sustituye el apoyo del nudo `item.node` (uno por nudo)
 *   batch     { commands, label? }              varios comandos como una unidad (una sola validación y un solo undo)
 */
import { validateProject } from "@edscar/model";
import type {
  Id, Load, LoadCase, LoadCombination, LoadPattern, Material, Member, Node, Project, Section, Support, ValidationError,
} from "@edscar/model";

export interface EntityMap {
  node: Node;
  member: Member;
  material: Material;
  section: Section;
  support: Support;
  pattern: LoadPattern;
  load: Load;
  case: LoadCase;
  combination: LoadCombination;
}
export type EntityKind = keyof EntityMap;

type CollectionKey = "nodes" | "members" | "materials" | "sections" | "supports" | "patterns" | "loads" | "cases" | "combinations";
const COLLECTION: Record<EntityKind, CollectionKey> = {
  node: "nodes", member: "members", material: "materials", section: "sections",
  support: "supports", pattern: "patterns", load: "loads", case: "cases", combination: "combinations",
};
export const ENTITY_KINDS = Object.keys(COLLECTION) as EntityKind[];

export type Patch = Readonly<Record<string, unknown>>;

type AddCommand<K extends EntityKind> = { type: `${K}.add`; payload: { item: EntityMap[K]; index?: number } };
type RemoveCommand<K extends EntityKind> = { type: `${K}.remove`; payload: { id: Id } };
type UpdateCommand<K extends EntityKind> = { type: `${K}.update`; payload: { id: Id; patch: Patch; unset?: string[] } };

export type EntityCommand = { [K in EntityKind]: AddCommand<K> | RemoveCommand<K> | UpdateCommand<K> }[EntityKind];
export type NodeMoveCommand = { type: "node.move"; payload: { id: Id; x: number; z: number } };
export type SupportSetCommand = { type: "support.set"; payload: { item: Support } };
export type BatchCommand = { type: "batch"; payload: { commands: Command[]; label?: string } };

/** Compatible con el contrato M0 `{ type: string; payload: unknown }`. */
export type Command = EntityCommand | NodeMoveCommand | SupportSetCommand | BatchCommand;

export type ApplyResult =
  | { ok: true; project: Project; inverse: Command }
  | { ok: false; errors: ValidationError[] };

class CommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const clone = <T>(v: T): T => structuredClone(v);

const getList = (p: Project, kind: EntityKind): readonly { id: Id }[] => p[COLLECTION[kind]];
const withList = (p: Project, kind: EntityKind, list: readonly unknown[]): Project =>
  ({ ...p, [COLLECTION[kind]]: list });

function indexOfId(p: Project, kind: EntityKind, id: Id): number {
  return getList(p, kind).findIndex((e) => e.id === id);
}

function mustFind(p: Project, kind: EntityKind, id: Id): { item: { id: Id }; index: number } {
  const index = indexOfId(p, kind, id);
  const item = getList(p, kind)[index];
  if (!item) throw new CommandError("not-found", `No existe ${kind} con id "${id}"`);
  return { item, index };
}

interface Applied { project: Project; inverse: Command[] }

function addEntity(p: Project, kind: EntityKind, rawItem: unknown, index: number | undefined): Applied {
  const item = clone(rawItem) as { id: Id };
  if (typeof item.id !== "string" || item.id === "") throw new CommandError("bad-command", `${kind}.add exige un id`);
  if (indexOfId(p, kind, item.id) >= 0) throw new CommandError("duplicate-id", `Ya existe ${kind} con id "${item.id}"`);
  const list = [...getList(p, kind)];
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, item);
  return { project: withList(p, kind, list), inverse: [{ type: `${kind}.remove`, payload: { id: item.id } }] };
}

function updateEntity(p: Project, kind: EntityKind, id: Id, patch: Patch, unset: readonly string[]): Applied {
  const { item, index } = mustFind(p, kind, id);
  const keys = [...new Set([...Object.keys(patch), ...unset])];
  if (keys.some((k) => k === "id")) throw new CommandError("bad-command", "El id no se puede modificar");
  if (keys.some((k) => FORBIDDEN_KEYS.has(k))) throw new CommandError("bad-command", "Clave de propiedad no permitida");
  const prev = item as unknown as Record<string, unknown>;
  const prevPatch: Record<string, unknown> = {};
  const prevUnset: string[] = [];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(prev, k)) prevPatch[k] = clone(prev[k]);
    else prevUnset.push(k);
  }
  const next: Record<string, unknown> = Object.fromEntries(Object.entries(prev).filter(([k]) => !unset.includes(k)));
  for (const [k, v] of Object.entries(clone(patch))) next[k] = v;
  const list = [...getList(p, kind)];
  list.splice(index, 1, next as { id: Id });
  const inverse = {
    type: `${kind}.update`,
    payload: { id, patch: prevPatch, ...(prevUnset.length > 0 ? { unset: prevUnset } : {}) },
  } as Command;
  return { project: withList(p, kind, list), inverse: [inverse] };
}

/**
 * Borra una entidad y lo que dependería de ella (el comando inverso lo reconstruye todo en su sitio):
 * - nudo: sus barras (y las cargas de esas barras), su apoyo y sus cargas nodales / de desplazamiento impuesto.
 * - barra: sus cargas.
 * - patrón: sus cargas y los términos que lo citan en los casos.
 * Material, sección, caso, apoyo y carga se borran solos; si algo los sigue citando, la validación rechaza.
 */
function removeWithCascade(p: Project, kind: EntityKind, id: Id): Applied {
  const found = mustFind(p, kind, id);
  if (kind === "material" || kind === "section" || kind === "case" || kind === "combination") {
    const list = getList(p, kind);
    return {
      project: withList(p, kind, list.filter((e) => e.id !== id)),
      inverse: [{ type: `${kind}.add`, payload: { item: clone(found.item), index: found.index } } as Command],
    };
  }
  const del: Record<"node" | "member" | "support" | "pattern" | "load", Set<Id>> = {
    node: new Set(), member: new Set(), support: new Set(), pattern: new Set(), load: new Set(),
  };
  switch (kind) {
    case "node":
      del.node.add(id);
      for (const m of p.members) if (m.i === id || m.j === id) del.member.add(m.id);
      for (const s of p.supports) if (s.node === id) del.support.add(s.id);
      break;
    case "member":
      del.member.add(id);
      break;
    case "pattern":
      del.pattern.add(id);
      break;
    case "support":
      del.support.add(id);
      break;
    default:
      del.load.add(id);
      break;
  }
  for (const l of p.loads) {
    const byNode = "node" in l && del.node.has(l.node);
    const byMember = "member" in l && del.member.has(l.member);
    if (byNode || byMember || del.pattern.has(l.pattern)) del.load.add(l.id);
  }

  let next = p;
  const inverse: Command[] = [];
  const removeFrom = (k: "node" | "member" | "support" | "pattern" | "load", ids: Set<Id>): void => {
    if (ids.size === 0) return;
    const list = getList(next, k);
    inverse.push(
      ...list.flatMap((item, index) =>
        ids.has(item.id) ? [{ type: `${k}.add`, payload: { item: clone(item), index } } as Command] : [],
      ),
    );
    next = withList(next, k, list.filter((e) => !ids.has(e.id)));
  };
  // Orden de borrado: dependientes antes que el objetivo; el inverso se lee en el orden contrario por tipo.
  const order: ("node" | "pattern" | "member" | "support" | "load")[] = ["node", "pattern", "member", "support", "load"];
  for (const k of order) removeFrom(k, del[k]);

  // Términos de casos que citan un patrón borrado.
  const caseRestores: Command[] = [];
  if (del.pattern.size > 0) {
    next = {
      ...next,
      cases: next.cases.map((c) => {
        if (!c.terms.some((t) => del.pattern.has(t.pattern))) return c;
        caseRestores.push({ type: "case.update", payload: { id: c.id, patch: { terms: clone(c.terms) } } });
        return { ...c, terms: c.terms.filter((t) => !del.pattern.has(t.pattern)) };
      }),
    };
  }
  return { project: next, inverse: [...inverse, ...caseRestores] };
}

function moveNode(p: Project, id: Id, x: number, z: number): Applied {
  const { item, index } = mustFind(p, "node", id);
  const n = item as Node;
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new CommandError("bad-command", "Coordenadas no finitas");
  const list = [...p.nodes];
  list.splice(index, 1, { ...n, x, z });
  return { project: { ...p, nodes: list }, inverse: [{ type: "node.move", payload: { id, x: n.x, z: n.z } }] };
}

function setSupport(p: Project, item: Support): Applied {
  const existing = p.supports.findIndex((s) => s.node === item.node);
  const sameId = p.supports.findIndex((s) => s.id === item.id);
  if (sameId >= 0 && sameId !== existing) throw new CommandError("duplicate-id", `Ya existe un apoyo con id "${item.id}"`);
  const list = [...p.supports];
  const copy = clone(item);
  if (existing >= 0) {
    const prev = list[existing] as Support;
    list.splice(existing, 1, copy);
    return {
      project: { ...p, supports: list },
      inverse: [
        { type: "support.remove", payload: { id: copy.id } },
        { type: "support.add", payload: { item: clone(prev), index: existing } },
      ],
    };
  }
  list.push(copy);
  return { project: { ...p, supports: list }, inverse: [{ type: "support.remove", payload: { id: copy.id } }] };
}

function applyRaw(p: Project, c: Command): Applied {
  switch (c.type) {
    case "batch": {
      let cur = p;
      let inverse: Command[] = [];
      for (const sub of c.payload.commands) {
        const r = applyRaw(cur, sub);
        cur = r.project;
        inverse = [...r.inverse, ...inverse];
      }
      return { project: cur, inverse };
    }
    case "node.move":
      return moveNode(p, c.payload.id, c.payload.x, c.payload.z);
    case "support.set":
      return setSupport(p, c.payload.item);
    default: {
      const [kindName, op] = c.type.split(".") as [string, string];
      if (!Object.prototype.hasOwnProperty.call(COLLECTION, kindName) || !(op === "add" || op === "remove" || op === "update")) {
        throw new CommandError("bad-command", `Comando desconocido: ${c.type}`);
      }
      const kind = kindName as EntityKind;
      const payload = c.payload as { item?: unknown; index?: number; id?: Id; patch?: Patch; unset?: string[] };
      if (op === "add") return addEntity(p, kind, payload.item, payload.index);
      if (op === "remove") return removeWithCascade(p, kind, payload.id as Id);
      return updateEntity(p, kind, payload.id as Id, payload.patch ?? {}, payload.unset ?? []);
    }
  }
}

/** Agrupa una lista de comandos en uno solo (el propio comando si es único). */
export function combine(commands: readonly Command[], label?: string): Command {
  const only = commands[0];
  if (commands.length === 1 && only) return only;
  return { type: "batch", payload: { commands: [...commands], ...(label ? { label } : {}) } };
}

/**
 * Aplica un comando de forma pura. En éxito devuelve el proyecto validado y el comando inverso; en fallo
 * (comando mal formado o proyecto resultante inválido) devuelve los errores y el proyecto de entrada no cambia.
 */
export function applyCommand(project: Project, command: Command): ApplyResult {
  let applied: Applied;
  try {
    applied = applyRaw(project, command);
  } catch (e) {
    if (e instanceof CommandError) return { ok: false, errors: [{ path: "", code: e.code, message: e.message }] };
    return { ok: false, errors: [{ path: "", code: "bad-command", message: e instanceof Error ? e.message : String(e) }] };
  }
  const v = validateProject(applied.project);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, project: applied.project, inverse: combine(applied.inverse) };
}

const LABELS: Record<string, string> = {
  "node.add": "Añadir nudo", "node.remove": "Borrar nudo", "node.update": "Editar nudo", "node.move": "Mover nudo",
  "member.add": "Añadir barra", "member.remove": "Borrar barra", "member.update": "Editar barra",
  "material.add": "Añadir material", "material.remove": "Borrar material", "material.update": "Editar material",
  "section.add": "Añadir sección", "section.remove": "Borrar sección", "section.update": "Editar sección",
  "support.add": "Añadir apoyo", "support.remove": "Quitar apoyo", "support.update": "Editar apoyo", "support.set": "Asignar apoyo",
  "pattern.add": "Crear patrón", "pattern.remove": "Borrar patrón", "pattern.update": "Editar patrón",
  "load.add": "Añadir carga", "load.remove": "Borrar carga", "load.update": "Editar carga",
  "case.add": "Crear caso", "case.remove": "Borrar caso", "case.update": "Editar caso",
  "combination.add": "Crear combinación", "combination.remove": "Borrar combinación", "combination.update": "Editar combinación",
};

/** Texto legible (español) de un comando, para el historial. */
export function commandLabel(c: Command): string {
  if (c.type === "batch") return c.payload.label ?? "Varios cambios";
  return LABELS[c.type] ?? c.type;
}
