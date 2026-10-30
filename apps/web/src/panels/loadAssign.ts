/**
 * Asignación de cargas a una selección (lógica pura). Genera la lista de comandos que el panel despacha dentro de un
 * grupo (un solo deshacer). Modos:
 * - add: añade una carga nueva por elemento seleccionado, sin tocar las existentes.
 * - replace: antes de añadir, quita las cargas del patrón activo que ya hubiera en esos elementos
 *   (cargas de barra si el tipo elegido es de barra; cargas de nudo si es de nudo).
 * - remove: quita las cargas del patrón activo en los elementos seleccionados (opcionalmente solo de un tipo).
 */
import type { Id, Load, LoadFrame, Project } from "@edscar/model";
import { addLoadCommand, nextId, type Command, type NewLoad, type SelectionLike } from "@edscar/ui-state";

export type AssignMode = "add" | "replace" | "remove";
export type AssignKind =
  | "member-uniform" | "member-trapezoid" | "member-point" | "member-moment" | "thermal" | "nodal" | "support-displacement";
export type RemoveFilter = AssignKind | "any";

export const MEMBER_KINDS: readonly AssignKind[] = ["member-uniform", "member-trapezoid", "member-point", "member-moment", "thermal"];
export const isMemberKind = (k: AssignKind): boolean => MEMBER_KINDS.includes(k);

/** Valores de la carga a asignar, en SI (kN, kN/m, kN·m, m, °C). */
export interface AssignSpec {
  kind: AssignKind;
  frame: LoadFrame;
  /** Componente X (w, p, F o d). */
  vx: number;
  /** Componente Z. */
  vz: number;
  /** w2 para trapezoidal. */
  vx2: number;
  vz2: number;
  /** Momento alrededor de Y (momento puntual o nodal). */
  my: number;
  a: number | null;
  b: number | null;
  at: number;
  relative: boolean;
  dT: number;
  gradientZ: number | null;
  /** Giro impuesto (rad) para desplazamiento de apoyo. */
  dRy: number;
}

export const DEFAULT_SPEC: AssignSpec = {
  kind: "member-uniform", frame: "global", vx: 0, vz: -10, vx2: 0, vz2: -10, my: 0, a: null, b: null,
  at: 0.5, relative: true, dT: 20, gradientZ: null, dRy: 0,
};

export type AssignError = "no-pattern" | "no-targets" | "bad-range" | "bad-position" | "no-length" | "nothing-to-remove";

export type AssignPlan =
  | { ok: true; commands: Command[]; added: number; removed: number; targets: number }
  | { ok: false; error: AssignError };

function memberLength(project: Project, id: Id): number | null {
  const m = project.members.find((x) => x.id === id);
  const ni = project.nodes.find((n) => n.id === m?.i);
  const nj = project.nodes.find((n) => n.id === m?.j);
  if (!m || !ni || !nj) return null;
  const L = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
  return L > 0 ? L : null;
}

function buildLoad(project: Project, pattern: Id, spec: AssignSpec, target: Id): NewLoad | AssignError {
  switch (spec.kind) {
    case "member-uniform": {
      if (spec.a !== null && spec.b !== null && !(spec.a < spec.b)) return "bad-range";
      return {
        type: "member-uniform", pattern, member: target, w: [spec.vx, 0, spec.vz], frame: spec.frame,
        ...(spec.a === null ? {} : { a: spec.a }), ...(spec.b === null ? {} : { b: spec.b }),
      };
    }
    case "member-trapezoid": {
      const L = memberLength(project, target);
      if (L === null) return "no-length";
      const a = spec.a ?? 0;
      const b = spec.b ?? L;
      if (!(a < b)) return "bad-range";
      return { type: "member-trapezoid", pattern, member: target, w1: [spec.vx, 0, spec.vz], w2: [spec.vx2, 0, spec.vz2], frame: spec.frame, a, b };
    }
    case "member-point":
    case "member-moment": {
      if (spec.relative && !(spec.at >= 0 && spec.at <= 1)) return "bad-position";
      const moment = spec.kind === "member-moment";
      return {
        type: "member-point", pattern, member: target, p: moment ? [0, 0, 0] : [spec.vx, 0, spec.vz],
        ...(moment ? { m: [0, spec.my, 0] as const } : {}), at: spec.at, relative: spec.relative, frame: spec.frame,
      };
    }
    case "thermal":
      return { type: "thermal", pattern, member: target, dT: spec.dT, ...(spec.gradientZ === null ? {} : { gradientZ: spec.gradientZ }) };
    case "nodal":
      return { type: "nodal", pattern, node: target, f: [spec.vx, 0, spec.vz], m: [0, spec.my, 0] };
    case "support-displacement":
      return { type: "support-displacement", pattern, node: target, d: [spec.vx, 0, spec.vz, 0, spec.dRy, 0] };
  }
}

const matchesFilter = (l: Load, f: RemoveFilter): boolean => {
  if (f === "any") return true;
  if (f === "member-moment") return l.type === "member-point";
  return l.type === f;
};

/** Cargas del patrón sobre los elementos dados (barras y/o nudos). */
function existingLoads(project: Project, pattern: Id, members: ReadonlySet<Id>, nodes: ReadonlySet<Id>, filter: RemoveFilter): Load[] {
  return project.loads.filter((l) => {
    if (l.pattern !== pattern || !matchesFilter(l, filter)) return false;
    return "member" in l ? members.has(l.member) : nodes.has(l.node);
  });
}

export function planAssign(
  project: Project,
  input: { mode: AssignMode; pattern: Id | null; spec: AssignSpec; selection: SelectionLike; removeFilter?: RemoveFilter },
): AssignPlan {
  const { mode, pattern, spec, selection } = input;
  if (pattern === null || !project.patterns.some((p) => p.id === pattern)) return { ok: false, error: "no-pattern" };

  const memberSet = new Set(selection.members);
  const nodeSet = new Set(selection.nodes);

  if (mode === "remove") {
    const filter = input.removeFilter ?? "any";
    const hit = existingLoads(project, pattern, memberSet, nodeSet, filter);
    if (memberSet.size + nodeSet.size === 0) return { ok: false, error: "no-targets" };
    if (hit.length === 0) return { ok: false, error: "nothing-to-remove" };
    return {
      ok: true, added: 0, removed: hit.length, targets: memberSet.size + nodeSet.size,
      commands: hit.map((l): Command => ({ type: "load.remove", payload: { id: l.id } })),
    };
  }

  const targets = isMemberKind(spec.kind) ? [...memberSet] : [...nodeSet];
  if (targets.length === 0) return { ok: false, error: "no-targets" };

  const commands: Command[] = [];
  let removed = 0;
  if (mode === "replace") {
    const old = isMemberKind(spec.kind)
      ? existingLoads(project, pattern, memberSet, new Set(), "any")
      : existingLoads(project, pattern, new Set(), nodeSet, "any");
    for (const l of old) commands.push({ type: "load.remove", payload: { id: l.id } });
    removed = old.length;
  }
  const reserved = new Set<Id>();
  for (const t of targets) {
    const built = buildLoad(project, pattern, spec, t);
    if (typeof built === "string") return { ok: false, error: built };
    const id = nextId(project, "load", reserved);
    reserved.add(id);
    commands.push(addLoadCommand(project, { ...built, id }, reserved));
  }
  return { ok: true, commands, added: targets.length, removed, targets: targets.length };
}
