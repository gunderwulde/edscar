/**
 * Validación en vivo del modelo (lógica pura): avisos que ayudan a corregir antes de calcular. Complementa a
 * `validateProject`, que ya rechaza los comandos inválidos: aquí se detectan situaciones válidas pero sospechosas
 * (mecanismos, nudos sueltos, cargas que ningún caso usa, casos o combinaciones vacíos…).
 */
import type { Id, Project } from "@edscar/model";

export type CheckSeverity = "error" | "warning" | "info";
export type CheckCode =
  | "empty-model" | "no-members" | "loose-nodes" | "no-supports" | "mechanism" | "pattern-unused" | "pattern-empty"
  | "case-empty" | "case-zero" | "combination-empty" | "no-cases" | "selfweight-no-density" | "analysis-3d";

export interface Check {
  id: string;
  severity: CheckSeverity;
  code: CheckCode;
  params: Record<string, string | number>;
  /** Elementos a seleccionar al pulsar el aviso. */
  select?: { nodes?: Id[]; members?: Id[] };
}

/** Grupos de barras conectadas (por nudos compartidos). Cada grupo: ids de nudo y de barra. */
export function connectedGroups(project: Project): { nodes: Id[]; members: Id[] }[] {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) ?? r;
    return r;
  };
  for (const n of project.nodes) parent.set(n.id, n.id);
  for (const m of project.members) {
    if (parent.has(m.i) && parent.has(m.j)) parent.set(find(m.i), find(m.j));
  }
  const groups = new Map<Id, { nodes: Id[]; members: Id[] }>();
  const grp = (root: Id): { nodes: Id[]; members: Id[] } => {
    let g = groups.get(root);
    if (!g) {
      g = { nodes: [], members: [] };
      groups.set(root, g);
    }
    return g;
  };
  const used = new Set<Id>(project.members.flatMap((m) => [m.i, m.j]));
  for (const n of project.nodes) if (used.has(n.id)) grp(find(n.id)).nodes.push(n.id);
  for (const m of project.members) if (parent.has(m.i)) grp(find(m.i)).members.push(m.id);
  return [...groups.values()];
}

/** GDL del plano (ux, uz, ry) restringidos por un apoyo. */
const restrained = (fixed: readonly boolean[]): number => (fixed[0] ? 1 : 0) + (fixed[2] ? 1 : 0) + (fixed[4] ? 1 : 0);

export function liveChecks(project: Project): Check[] {
  const out: Check[] = [];
  const add = (c: Omit<Check, "id"> & { id?: string }): void => {
    out.push({ ...c, id: c.id ?? `${c.code}:${JSON.stringify(c.params)}` });
  };

  if (project.analysis === "3D") add({ severity: "warning", code: "analysis-3d", params: {} });

  if (project.nodes.length === 0) {
    add({ severity: "info", code: "empty-model", params: {} });
  } else if (project.members.length === 0) {
    add({ severity: "warning", code: "no-members", params: {} });
  }

  const used = new Set<Id>(project.members.flatMap((m) => [m.i, m.j]));
  const loose = project.nodes.filter((n) => !used.has(n.id)).map((n) => n.id);
  if (loose.length > 0 && project.members.length > 0) {
    add({ severity: "warning", code: "loose-nodes", params: { ids: loose.join(", "), n: loose.length }, select: { nodes: loose } });
  }

  if (project.members.length > 0) {
    if (project.supports.length === 0) {
      add({ severity: "error", code: "no-supports", params: {} });
    } else {
      const supportOf = new Map(project.supports.map((s) => [s.node, s]));
      for (const g of connectedGroups(project)) {
        const dofs = g.nodes.reduce((acc, n) => acc + restrained(supportOf.get(n)?.fixed ?? []), 0);
        if (dofs < 3) {
          add({
            severity: "error", code: "mechanism",
            params: { members: g.members.join(", "), dofs },
            select: { members: g.members },
          });
        }
      }
    }
  }

  const casePatterns = new Set(project.cases.flatMap((c) => c.terms.filter((t) => t.factor !== 0).map((t) => t.pattern)));
  const loadsByPattern = new Map<Id, number>();
  for (const l of project.loads) loadsByPattern.set(l.pattern, (loadsByPattern.get(l.pattern) ?? 0) + 1);
  for (const p of project.patterns) {
    const n = loadsByPattern.get(p.id) ?? 0;
    if ((n > 0 || p.selfWeightFactor !== 0) && !casePatterns.has(p.id)) {
      add({ severity: "warning", code: "pattern-unused", params: { id: p.id, n } });
    } else if (n === 0 && p.selfWeightFactor === 0) {
      add({ severity: "info", code: "pattern-empty", params: { id: p.id } });
    }
  }

  if (project.cases.length === 0 && project.members.length > 0) add({ severity: "warning", code: "no-cases", params: {} });
  for (const c of project.cases) {
    if (c.terms.length === 0) add({ severity: "warning", code: "case-empty", params: { id: c.id } });
    else if (c.terms.every((t) => t.factor === 0)) add({ severity: "warning", code: "case-zero", params: { id: c.id } });
  }
  for (const c of project.combinations) {
    if (c.terms.length === 0) add({ severity: "warning", code: "combination-empty", params: { id: c.id } });
  }

  if (project.patterns.some((p) => p.selfWeightFactor !== 0)) {
    const noDensity = project.members.filter((m) => (project.materials.find((x) => x.id === m.material)?.density ?? 0) === 0).map((m) => m.id);
    if (noDensity.length > 0) {
      add({ severity: "info", code: "selfweight-no-density", params: { ids: noDensity.join(", ") }, select: { members: noDensity } });
    }
  }
  return out;
}

/** Mensaje de un resultado de `dispatch` rechazado (primer error, con su ruta). */
export function describeErrors(errors: readonly { path: string; message: string }[]): string {
  const e = errors[0];
  if (!e) return "";
  const more = errors.length > 1 ? ` (+${String(errors.length - 1)})` : "";
  return `${e.message}${more}`;
}
