/** @edscar/loads — patrones, casos, combinaciones y cargas -> vector nodal. M0: solo contrato. */
import type { Id, LoadCombination, LoadCase, Project } from "@edscar/model";
import type { NationalAnnex } from "@edscar/codes";

export const PACKAGE_NAME = "@edscar/loads";

/** Combinación expandida a factores por caso (sin referencias a otras combinaciones). */
export interface ResolvedCombination { id: Id; name: string; terms: { case: Id; factor: number }[] }

/** Generador de combinaciones normativas (contrato; implementación pendiente en M3). */
export interface CombinationGenerator {
  generate(project: Project, annex: NationalAnnex): LoadCombination[];
}

/** Resuelve casos y combinaciones anidadas a factores sobre casos. */
export interface CombinationResolver {
  resolve(cases: readonly LoadCase[], combinations: readonly LoadCombination[]): ResolvedCombination[];
}
