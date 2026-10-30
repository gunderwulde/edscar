/** Modelos de ejemplo construidos solo con comandos (ADR-001, E1). */
import type { Project } from "@edscar/model";
import { createEmptyProject } from "./builders";
import { applyCommand, type Command } from "./commands";

/**
 * Viga biapoyada E1 (ADR-001): L = 6 m, w = 10 kN/m hacia abajo (patrón G), articulada en A y móvil en B,
 * EI = 20000 kN·m² (material y sección ficticios, como el ejemplo de @edscar/model). Parte de un proyecto vacío.
 */
export function beamE1Commands(): Command[] {
  return [
    { type: "material.update", payload: { id: "MAT1", patch: { name: "Ficticio (EI = 20000 kN m2)", E: 200000000, G: 80000000, density: 0, alpha: 0.000012 } } },
    { type: "section.update", payload: { id: "SEC1", patch: { name: "Sección ficticia", A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.00001 } } },
    { type: "node.add", payload: { item: { id: "A", x: 0, y: 0, z: 0 } } },
    { type: "node.add", payload: { item: { id: "B", x: 6, y: 0, z: 0 } } },
    { type: "member.add", payload: { item: { id: "E1", i: "A", j: "B", material: "MAT1", section: "SEC1" } } },
    { type: "support.set", payload: { item: { id: "SA", node: "A", fixed: [true, true, true, false, false, false] } } },
    { type: "support.set", payload: { item: { id: "SB", node: "B", fixed: [false, true, true, false, false, false] } } },
    { type: "pattern.add", payload: { item: { id: "G", name: "Carga permanente", kind: "D", selfWeightFactor: 0 } } },
    { type: "load.add", payload: { item: { id: "L1", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, -10], frame: "global" } } },
    { type: "case.add", payload: { item: { id: "C1", name: "Permanente", type: "static-linear", terms: [{ pattern: "G", factor: 1 }] } } },
  ];
}

/** Proyecto E1 listo (aplica `beamE1Commands` sobre un proyecto vacío). */
export function beamE1Project(): Project {
  let p = createEmptyProject();
  for (const c of beamE1Commands()) {
    const r = applyCommand(p, c);
    if (!r.ok) throw new Error(`beamE1Commands inválido: ${r.errors.map((e) => e.message).join("; ")}`);
    p = r.project;
  }
  return p;
}
