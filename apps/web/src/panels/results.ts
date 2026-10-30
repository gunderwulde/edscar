/**
 * Lógica pura de resultados para los paneles: caso virtual de una combinación, resumen de máximos y análisis de los
 * mensajes del solver. Los esfuerzos se presentan con el criterio de ADR-001 (`presentedValue` de ui-state).
 */
import type { Id, LoadCase, Project } from "@edscar/model";
import type { SolveResult } from "@edscar/solver";
import { presentedValue, type DiagramKind } from "@edscar/ui-state";

export const VIRTUAL_CASE_ID = "__combinacion__";

export type FlattenResult = { ok: true; terms: { pattern: Id; factor: number }[] } | { ok: false; reason: string };

/**
 * Una combinación es lineal: Σ factor·caso = Σ factor·factor_término·patrón. Se aplana a los términos de un caso
 * virtual (se resuelve con el solver tal cual, sin superponer resultados). Detecta ciclos y referencias rotas.
 */
export function flattenCombination(project: Project, comboId: Id): FlattenResult {
  const acc = new Map<Id, number>();
  const visiting = new Set<Id>();
  const walk = (id: Id, mult: number): string | null => {
    const combo = project.combinations.find((c) => c.id === id);
    if (!combo) return `La combinación "${id}" no existe`;
    if (visiting.has(id)) return `Ciclo en la combinación "${id}"`;
    visiting.add(id);
    for (const t of combo.terms) {
      if (t.refType === "case") {
        const c = project.cases.find((x) => x.id === t.ref);
        if (!c) return `El caso "${t.ref}" no existe`;
        for (const ct of c.terms) acc.set(ct.pattern, (acc.get(ct.pattern) ?? 0) + mult * t.factor * ct.factor);
      } else {
        const err = walk(t.ref, mult * t.factor);
        if (err) return err;
      }
    }
    visiting.delete(id);
    return null;
  };
  const err = walk(comboId, 1);
  if (err) return { ok: false, reason: err };
  return { ok: true, terms: [...acc].map(([pattern, factor]) => ({ pattern, factor })) };
}

/** Proyecto con el caso virtual de la combinación añadido, listo para `solve({ project, caseId: VIRTUAL_CASE_ID })`. */
export function projectWithCombination(project: Project, comboId: Id): { project: Project; caseId: Id } | { error: string } {
  const f = flattenCombination(project, comboId);
  if (!f.ok) return { error: f.reason };
  const virtual: LoadCase = { id: VIRTUAL_CASE_ID, name: comboId, type: "static-linear", terms: f.terms };
  return { project: { ...project, cases: [...project.cases.filter((c) => c.id !== VIRTUAL_CASE_ID), virtual] }, caseId: VIRTUAL_CASE_ID };
}

export interface Extreme { value: number; member: Id; x: number }
export interface ReactionRow { node: Id; rx: number; rz: number; my: number }
export interface ResultSummary {
  N: Extreme | null;
  V: Extreme | null;
  M: Extreme | null;
  maxDisplacement: { value: number; node: Id } | null;
  reactions: ReactionRow[];
  sumRx: number;
  sumRz: number;
}

export function summarizeResult(result: SolveResult): ResultSummary {
  const ext = (kind: DiagramKind): Extreme | null => {
    let best: Extreme | null = null;
    for (const m of result.members) {
      for (const s of m.stations) {
        const v = presentedValue(kind, s);
        if (best === null || Math.abs(v) > Math.abs(best.value) + 1e-12) best = { value: v, member: m.member, x: s.x };
      }
    }
    return best;
  };
  let maxD: ResultSummary["maxDisplacement"] = null;
  for (const [node, d] of Object.entries(result.displacements)) {
    const mag = Math.hypot(d[0], d[1], d[2]);
    if (maxD === null || mag > maxD.value) maxD = { value: mag, node };
  }
  const reactions = Object.entries(result.reactions).map(([node, r]): ReactionRow => ({ node, rx: r[0], rz: r[2], my: r[4] }));
  return {
    N: ext("N"), V: ext("V"), M: ext("M"), maxDisplacement: maxD, reactions,
    sumRx: reactions.reduce((a, r) => a + r.rx, 0), sumRz: reactions.reduce((a, r) => a + r.rz, 0),
  };
}

export interface SolverNote {
  text: string;
  severity: "error" | "warning" | "info";
  kind: "ill-conditioned" | "mechanism" | "other";
  members: Id[];
  nodes: Id[];
}

const strip = (s: string): string => s.replace(/^["']|["'.,:;)]+$/g, "");

/**
 * Trocea el mensaje del solver en avisos individuales ("Aviso: …" separados por "; ") y extrae los elementos citados
 * ("Barra P1", "nudo N3") para poder seleccionarlos. Los mensajes de estado distinto de "ok" se tratan como error.
 */
export function parseSolverMessage(message: string | null | undefined, status: string | null): SolverNote[] {
  if (!message) return [];
  const parts = status === "ok" ? message.split(/;\s+(?=Aviso)/) : [message];
  return parts.map((text): SolverNote => {
    const members = [...text.matchAll(/\b[Bb]arra\s+(\S+)/g)].map((m) => strip(m[1] ?? "")).filter((x) => x !== "");
    const nodes = [...text.matchAll(/\bnudo\s+(\S+)/gi)].map((m) => strip(m[1] ?? "")).filter((x) => x !== "");
    const ill = /condicionad/i.test(text);
    const mech = /mecanismo|singular/i.test(text);
    return {
      text, members: [...new Set(members)], nodes: [...new Set(nodes)],
      severity: status === "ok" ? "warning" : "error",
      kind: mech ? "mechanism" : ill ? "ill-conditioned" : "other",
    };
  });
}
