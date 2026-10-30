/**
 * Registro de casos: cada caso aporta variantes (modelo + referencia). Siempre se ejecuta un test de
 * "modelo valido" (no depende del solver); la comparacion con el solver queda `describe.skip` explicito
 * mientras @edscar/solver no tenga implementacion.
 */
import { describe, expect, it } from "vitest";
import type { Project } from "@edscar/model";
import { describeSolver, solveForTest } from "./adapter";
import { compareCase, DEFAULT_TOL } from "./compare";
import type { Tol } from "./compare";
import type { CaseRef } from "./reference";

export interface Variant {
  name: string;
  /** Construye y valida el modelo (lanza si no valida con validateProject). */
  build: () => Project;
  ref: CaseRef;
  tol?: Tol;
}

export function registerCase(title: string, variants: readonly Variant[]): void {
  describe(`${title}: modelos`, () => {
    for (const v of variants) {
      it(`modelo valido segun validateProject: ${v.name}`, () => {
        const p = v.build();
        expect(p.members.length).toBeGreaterThan(0);
        // La referencia debe cubrir todas las barras del modelo.
        for (const m of p.members) expect(Object.keys(v.ref.members), `referencia sin la barra ${m.id}`).toContain(m.id);
      });
    }
  });
  describeSolver(`${title}: solver vs referencia`, () => {
    for (const v of variants) {
      it(v.name, () => {
        compareCase(solveForTest(v.build()), v.ref, v.tol ?? DEFAULT_TOL);
      });
    }
  });
}
