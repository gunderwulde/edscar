/**
 * Esquemas Zod del modelo v1 (original, escrito desde cero). Unidades SI y convenciones: ADR-001.
 * Los tipos inferidos deben ser mutuamente asignables con los tipos de `index.ts` (ver `schema.types.test.ts`).
 */
import { z } from "zod";

/** Versión actual del esquema de fichero `.edscar.json`. */
export const CURRENT_SCHEMA_VERSION = 1;

export const IdSchema = z.string().min(1, "El id no puede estar vacío");
const num = z.number(); // en Zod 4 rechaza NaN e Infinity
const vec3 = z.tuple([num, num, num]).readonly();

export const Vec3Schema = vec3;
export const Dof6Schema = z.tuple([num, num, num, num, num, num]).readonly();
export const UnitSystemSchema = z.literal("SI");
export const AnalysisKindSchema = z.enum(["2D-XZ", "3D"]);

export const NodeSchema = z.strictObject({ id: IdSchema, x: num, y: num, z: num });

const bool = z.boolean();
export const EndReleaseSchema = z.strictObject({ ux: bool, uy: bool, uz: bool, rx: bool, ry: bool, rz: bool });
const PartialReleaseSchema = z.strictObject({
  ux: bool.exactOptional(), uy: bool.exactOptional(), uz: bool.exactOptional(),
  rx: bool.exactOptional(), ry: bool.exactOptional(), rz: bool.exactOptional(),
});
export const ReleasesSchema = z.strictObject({
  i: PartialReleaseSchema.exactOptional(),
  j: PartialReleaseSchema.exactOptional(),
});

export const MaterialSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  E: num.positive(),
  G: num.positive(),
  density: num.nonnegative(),
  alpha: num,
});

export const SectionSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  A: num.positive(),
  Iy: num.positive(),
  Iz: num.positive(),
  J: num.nonnegative(),
});

export const SupportSchema = z.strictObject({
  id: IdSchema,
  node: IdSchema,
  fixed: z.tuple([bool, bool, bool, bool, bool, bool]).readonly(),
});

export const MemberSchema = z.strictObject({
  id: IdSchema,
  i: IdSchema,
  j: IdSchema,
  material: IdSchema,
  section: IdSchema,
  releases: ReleasesSchema.exactOptional(),
  rotation: num.exactOptional(),
});

export const PatternKindSchema = z.enum(["D", "SD", "L", "Lr", "S", "W", "E", "T", "Other"]);
export const LoadPatternSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  kind: PatternKindSchema,
  selfWeightFactor: num,
});

export const LoadFrameSchema = z.enum(["local", "global"]);

const base = { id: IdSchema, pattern: IdSchema };

export const NodalLoadSchema = z.strictObject({ ...base, type: z.literal("nodal"), node: IdSchema, f: vec3, m: vec3 });
export const MemberUniformLoadSchema = z.strictObject({
  ...base,
  type: z.literal("member-uniform"),
  member: IdSchema,
  w: vec3,
  frame: LoadFrameSchema,
  a: num.exactOptional(),
  b: num.exactOptional(),
});
export const MemberTrapezoidLoadSchema = z.strictObject({
  ...base,
  type: z.literal("member-trapezoid"),
  member: IdSchema,
  w1: vec3,
  w2: vec3,
  frame: LoadFrameSchema,
  a: num,
  b: num,
});
export const MemberPointLoadSchema = z.strictObject({
  ...base,
  type: z.literal("member-point"),
  member: IdSchema,
  p: vec3,
  m: vec3.exactOptional(),
  at: num,
  relative: bool,
  frame: LoadFrameSchema,
});
export const ThermalLoadSchema = z.strictObject({
  ...base,
  type: z.literal("thermal"),
  member: IdSchema,
  dT: num,
  gradientZ: num.exactOptional(),
  gradientY: num.exactOptional(),
});
export const SupportDisplacementLoadSchema = z.strictObject({
  ...base,
  type: z.literal("support-displacement"),
  node: IdSchema,
  d: Dof6Schema,
});

export const LoadSchema = z.discriminatedUnion("type", [
  NodalLoadSchema,
  MemberUniformLoadSchema,
  MemberTrapezoidLoadSchema,
  MemberPointLoadSchema,
  ThermalLoadSchema,
  SupportDisplacementLoadSchema,
]);

export const LoadCaseSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  type: z.literal("static-linear"),
  terms: z.array(z.strictObject({ pattern: IdSchema, factor: num })),
});

export const CombinationKindSchema = z.enum(["ULS", "SLS", "ACCIDENTAL", "ENVELOPE", "CUSTOM"]);
export const LoadCombinationSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  kind: CombinationKindSchema,
  terms: z.array(z.strictObject({ ref: IdSchema, refType: z.enum(["case", "combination"]), factor: num })),
});

export const ProjectSchema = z.strictObject({
  schemaVersion: z.number().int().nonnegative(),
  units: UnitSystemSchema,
  analysis: AnalysisKindSchema,
  nodes: z.array(NodeSchema),
  members: z.array(MemberSchema),
  materials: z.array(MaterialSchema),
  sections: z.array(SectionSchema),
  supports: z.array(SupportSchema),
  patterns: z.array(LoadPatternSchema),
  loads: z.array(LoadSchema),
  cases: z.array(LoadCaseSchema),
  combinations: z.array(LoadCombinationSchema),
  settings: z.strictObject({ gravity: vec3, codeId: z.string().exactOptional() }),
});
