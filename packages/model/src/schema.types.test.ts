import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type {
  Dof6, EndRelease, Load, LoadCase, LoadCombination, LoadPattern, Material, Member, Node, Project, Section, Support,
} from "./index";
import { CURRENT_SCHEMA_VERSION } from "./schema";
import type {
  AnalysisKindSchema, Dof6Schema, EndReleaseSchema, LoadCaseSchema, LoadCombinationSchema, LoadPatternSchema,
  LoadSchema, MaterialSchema, MemberSchema, NodeSchema, ProjectSchema, SectionSchema, SupportSchema,
} from "./schema";
import type { AnalysisKind } from "./index";

/** Igualdad mutua de tipos en tiempo de compilación. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type Check736 = Assert<Same<z.infer<typeof NodeSchema>, Node>>;
export type Check782 = Assert<Same<z.infer<typeof MaterialSchema>, Material>>;
export type Check836 = Assert<Same<z.infer<typeof SectionSchema>, Section>>;
export type Check888 = Assert<Same<z.infer<typeof SupportSchema>, Support>>;
export type Check940 = Assert<Same<z.infer<typeof MemberSchema>, Member>>;
export type Check990 = Assert<Same<z.infer<typeof LoadPatternSchema>, LoadPattern>>;
export type Check1050 = Assert<Same<z.infer<typeof LoadSchema>, Load>>;
export type Check1096 = Assert<Same<z.infer<typeof LoadCaseSchema>, LoadCase>>;
export type Check1150 = Assert<Same<z.infer<typeof LoadCombinationSchema>, LoadCombination>>;
export type Check1218 = Assert<Same<z.infer<typeof EndReleaseSchema>, EndRelease>>;
export type Check1276 = Assert<Same<z.infer<typeof Dof6Schema>, Dof6>>;
export type Check1322 = Assert<Same<z.infer<typeof AnalysisKindSchema>, AnalysisKind>>;
// Project: schemaVersion es number en ambos.
export type Check1430 = Assert<Same<z.infer<typeof ProjectSchema>, Project>>;

describe("consistencia de tipos", () => {
  it("la comprobación es de compilación; versión actual definida", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });
});
