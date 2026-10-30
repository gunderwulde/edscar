/**
 * @edscar/model — contrato de datos del proyecto (solo tipos en M0).
 * Fuente: EDITOR_CARGAS_ESTRUCTURAS.md sección 6. Unidades SI, ejes y signos: ADR-001.
 */
export const PACKAGE_NAME = "@edscar/model";

export type Id = string;
export type Vec3 = readonly [number, number, number];

/**
 * Vector de 6 componentes por nudo en el orden de GDL [ux, uy, uz, rx, ry, rz]
 * (ADR-001 §4). Traslaciones en m (o kN), giros en rad (o kN·m), según el uso.
 */
export type Dof6 = readonly [number, number, number, number, number, number];

/** Sistema de unidades de presentación. El modelo SIEMPRE se guarda en SI. */
export type UnitSystem = "SI";

/**
 * Tipo de análisis (ADR-001 §2.1).
 * - "2D-XZ": modelo plano en X–Z (GDL activos ux, uz, ry). Exige nudos con y = 0,
 *   `Member.rotation` ∈ {0, π} y cargas sin componentes fuera del plano (momentos puntuales de barra:
 *   m[0] = m[2] = 0 con frame "global", mx = mz = 0 con frame "local"), y gravity[1] = 0 si hay peso
 *   propio activo (selfWeightFactor ≠ 0); si no, `invalid-model`. Las reacciones valen 0 en uy, rx, rz
 *   (la restricción interna de esos GDL no es un apoyo).
 * - "3D": 6 GDL por nudo.
 */
export type AnalysisKind = "2D-XZ" | "3D";

export interface Node { id: Id; x: number; y: number; z: number }

/**
 * Liberaciones de extremo en EJES LOCALES de la barra (ADR-001 §3.1).
 * true = componente liberada (no se transmite entre nudo y barra):
 * ux ↔ N, uy ↔ Vy, uz ↔ Vz, rx ↔ T, ry ↔ My, rz ↔ Mz.
 */
export interface EndRelease { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean }
export interface Releases { i?: Partial<EndRelease>; j?: Partial<EndRelease> }

/** E, G en kN/m²; density en t/m³; alpha en 1/°C. */
export interface Material { id: Id; name: string; E: number; G: number; density: number; alpha: number }
/** A en m²; Iy, Iz, J en m⁴ (Iy: flexión en el plano local x–z; Iz: plano x–y). */
export interface Section { id: Id; name: string; A: number; Iy: number; Iz: number; J: number }
/**
 * `fixed` en ejes GLOBALES, orden [ux, uy, uz, rx, ry, rz].
 * Como máximo un `Support` por nudo: varios `Support` sobre el mismo nudo → `invalid-model` (ADR-001 §2.2).
 */
export interface Support { id: Id; node: Id; fixed: readonly [boolean, boolean, boolean, boolean, boolean, boolean] }

export interface Member {
  id: Id; i: Id; j: Id; material: Id; section: Id;
  releases?: Releases;
  /** Rotación de la sección alrededor del eje local x, en radianes (ADR-001 §3). En "2D-XZ" solo 0 o π. */
  rotation?: number;
}

export type PatternKind = "D" | "SD" | "L" | "Lr" | "S" | "W" | "E" | "T" | "Other";
export interface LoadPattern { id: Id; name: string; kind: PatternKind; selfWeightFactor: number }

/**
 * Marco de las componentes de una carga de barra (ADR-001 §5).
 * "local": [wx, wy, wz] en ejes locales. "global": [wX, wY, wZ] en ejes globales.
 * En ambos casos las cargas distribuidas son POR UNIDAD DE LONGITUD REAL de la barra (no proyectada).
 */
export type LoadFrame = "local" | "global";

export type Load =
  /** f en kN, m en kN·m, ejes globales. */
  | { id: Id; pattern: Id; type: "nodal"; node: Id; f: Vec3; m: Vec3 }
  /**
   * w en kN/m. `a`, `b`: abscisas ABSOLUTAS en m medidas desde el nudo i a lo largo de la barra,
   * 0 ≤ a < b ≤ L. Por defecto a = 0, b = L.
   */
  | { id: Id; pattern: Id; type: "member-uniform"; member: Id; w: Vec3; frame: LoadFrame; a?: number; b?: number }
  /** w1 en x = a, w2 en x = b (kN/m), variación lineal. `a`, `b` absolutas en m desde i, 0 ≤ a < b ≤ L. */
  | { id: Id; pattern: Id; type: "member-trapezoid"; member: Id; w1: Vec3; w2: Vec3; frame: LoadFrame; a: number; b: number }
  /**
   * p en kN, m en kN·m. `at`: si `relative` = true, fracción de L en [0, 1]; si false, m desde el nudo i.
   */
  | { id: Id; pattern: Id; type: "member-point"; member: Id; p: Vec3; m?: Vec3; at: number; relative: boolean; frame: LoadFrame }
  /**
   * Térmica (ADR-001 §5.1). dT: variación uniforme en °C (> 0 calentamiento).
   * gradientZ: ∂T/∂z local en °C/m (> 0: fibra +z más caliente).
   * gradientY: ∂T/∂y local en °C/m (> 0: fibra +y más caliente); debe ser 0 o ausente en "2D-XZ".
   * Una ΔT entre caras (EN 1991-1-5, cita unverified) se convierte a °C/m con ΔT/h fuera del solver:
   * h lo da el usuario en la UI o lo resuelve `loads` (Section no guarda canto). ΔT_E no lineal: no en v1.
   */
  | { id: Id; pattern: Id; type: "thermal"; member: Id; dT: number; gradientZ?: number; gradientY?: number }
  /**
   * Desplazamiento impuesto de apoyo, ejes GLOBALES, orden [ux, uy, uz, rx, ry, rz], m y rad.
   * Solo en GDL restringidos por un `Support` del nudo; un valor no nulo en un GDL libre → `invalid-model`.
   */
  | { id: Id; pattern: Id; type: "support-displacement"; node: Id; d: Dof6 };

export interface LoadCase { id: Id; name: string; type: "static-linear"; terms: { pattern: Id; factor: number }[] }
export type CombinationKind = "ULS" | "SLS" | "ACCIDENTAL" | "ENVELOPE" | "CUSTOM";
export interface LoadCombination {
  id: Id; name: string; kind: CombinationKind;
  terms: { ref: Id; refType: "case" | "combination"; factor: number }[];
}

export interface Project {
  schemaVersion: number;
  units: UnitSystem;
  /** Tipo de análisis; fija los GDL activos y las validaciones de plano (ADR-001 §2.1). */
  analysis: AnalysisKind;
  nodes: Node[]; members: Member[]; materials: Material[]; sections: Section[]; supports: Support[];
  patterns: LoadPattern[]; loads: Load[]; cases: LoadCase[]; combinations: LoadCombination[];
  /** gravity en m/s², ejes globales (por defecto [0, 0, -9.81]). */
  settings: { gravity: Vec3; codeId?: string };
}

export * from "./schema";
export * from "./validate";
export * from "./migrate";
