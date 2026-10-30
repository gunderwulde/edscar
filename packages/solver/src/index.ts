/**
 * @edscar/solver — rigidez directa, TS puro, apto para Worker. M1: "2D-XZ" implementado; "3D" pendiente (M4).
 * Convenciones de ejes, signos y orden de GDL: docs/adr/ADR-001-ejes-signos-unidades.md.
 * Todo en SI (m, kN, kN·m, rad). Debe poder reescribirse en Rust/WASM sin cambiar esta interfaz.
 */
import type { Dof6, Id, Project } from "@edscar/model";
import { solve2D } from "./solve2d";

export const PACKAGE_NAME = "@edscar/solver";

/** Orden por nudo: [ux, uy, uz, rx, ry, rz] (ADR-001 §4). Reexportado desde @edscar/model. */
export type { Dof6 };

export interface SolveRequest {
  project: Project;
  /** Caso a resolver (id de LoadCase); las combinaciones se superponen fuera del solver. */
  caseId: Id;
}

/**
 * Esfuerzos de sección en la abscisa x (m desde el nudo i), ejes locales, criterio de ADR-001 §6
 * (valores crudos; la presentación de §7 la aplican UI e informes).
 * `side` solo aparece en estaciones duplicadas con la misma x en una discontinuidad:
 * "left" = límite x⁻ (va primero), "right" = límite x⁺.
 */
export interface SectionForces {
  x: number;
  side?: "left" | "right";
  N: number; Vy: number; Vz: number; T: number; My: number; Mz: number;
}

/**
 * Fuerzas de extremo de barra (ADR-001 §6.2): fuerzas y momentos que el NUDO ejerce SOBRE LA BARRA,
 * en ejes locales, orden [Fx, Fy, Fz, Mx, My, Mz] (kN, kN·m), positivas según los ejes locales.
 * = k_local·u_local + fuerzas de empotramiento perfecto (extremos fijos; = −cargas nodales
 * equivalentes, incluidas las térmicas), con liberaciones aplicadas.
 * Relación con los esfuerzos de sección:
 *   en i: N(0) = −Fx_i, Vy(0) = −Fy_i, Vz(0) = −Fz_i, T(0) = −Mx_i, My(0) = −My_i, Mz(0) = −Mz_i;
 *   en j: N(L) = +Fx_j, Vy(L) = +Fy_j, Vz(L) = +Fz_j, T(L) = +Mx_j, My(L) = +My_j, Mz(L) = +Mz_j.
 */
export interface MemberEndForces { i: Dof6; j: Dof6 }

export interface MemberResult {
  member: Id;
  endForces: MemberEndForces;
  /** Muestreo a lo largo de la barra, x no decreciente; incluye x = 0 y x = L. */
  stations: SectionForces[];
}

/**
 * Punto de la deformada de una barra (ADR-006 §3): desplazamiento del punto de la directriz situado en la
 * abscisa `x` (m desde el nudo i, geometría sin deformar), en EJES GLOBALES, `d = [ux, uy, uz]` en m.
 * En "2D-XZ", `uy` vale 0. Solo traslaciones (el giro de la sección no se expone aquí).
 */
export interface DeflectionStation {
  x: number;
  d: readonly [number, number, number];
}

/**
 * Estados del resultado:
 * - "ok": resuelto (puede llevar `message` con avisos).
 * - "singular": mecanismo o matriz singular (ADR-005).
 * - "invalid-model": el modelo no es válido o no se puede resolver tal como está.
 * - "unsupported": el modelo es válido pero el análisis pedido no está implementado (hoy, `analysis: "3D"`
 *   hasta M4). Añadido por ADR-006; el solver lo emite para 3D (antes devolvía "invalid-model").
 */
export type SolveStatus = "ok" | "singular" | "invalid-model" | "unsupported";

export interface SolveResult {
  status: SolveStatus;
  message?: string;
  /** Desplazamientos nodales, ejes globales, m y rad. */
  displacements: Record<Id, Dof6>;
  /**
   * Reacciones por nudo apoyado, ejes globales (ADR-001 §5): acción del apoyo sobre la estructura.
   * No incluyen la carga nodal aplicada en el propio nudo; valen 0 en los GDL libres.
   * En "2D-XZ" valen 0 en uy, rx, rz (índices 1, 3, 5) aunque el solver los restrinja internamente.
   */
  reactions: Record<Id, Dof6>;
  members: MemberResult[];
  /**
   * GDL indeterminados por nudo (ADR-005 §2.7): índices Dof6 (0…5), en orden creciente, de los GDL de giro
   * eliminados por falta de rigidez (p. ej. `ry` de un nudo al que solo llegan extremos articulados) y NO
   * restringidos por un apoyo. Ausente si no hay ninguno; un nudo sin GDL indeterminados no aparece.
   * Alcance: solo eliminaciones alineadas con ejes globales (todas las de "2D-XZ"; en "3D", las de subespacio
   * generado por ejes globales). Los GDL restringidos nunca aparecen (toman el valor prescrito).
   * En `displacements` esos GDL valen 0 por convención (sin significado físico); UI e informes deben mostrarlos
   * como "indeterminado (nudo articulado)", igual que los desplazamientos de barra que dependen de ellos.
   *
   * Reservado para M4 (NO definido aún, pendiente del ADR de M4): `indeterminateRotations?`, base ortonormal
   * global del subespacio de giros eliminado por nudo para eliminaciones en base no global. No añadir hasta
   * que ese ADR esté aceptado.
   */
  indeterminateDofs?: Record<Id, number[]>;
  /**
   * Deformada discretizada por barra (ADR-006 §3), clave = id de la barra; ejes globales, m.
   * Estaciones con `x` estrictamente creciente que incluyen x = 0 y x = L; se recomienda la misma malla de
   * abscisas que `stations` (sin duplicados: la deformada es continua dentro de la barra).
   * En x = 0 y x = L coincide con el desplazamiento del extremo de la barra, que difiere del del nudo si hay
   * liberaciones de traslación en ese extremo. Los tramos que dependen de GDL de `indeterminateDofs` se
   * muestran como indeterminados en UI.
   * Opcional: ausente si el solver no la calcula o si `status` no es "ok".
   * Implementación 2D-XZ: presente en todas las barras con status "ok"; abscisas = las de `stations` + L·k/20
   * (k = 0…20); valores exactos de Euler-Bernoulli (Hermite de los desplazamientos de extremo + solución
   * particular de las cargas de vano), no solo la cúbica nodal. Barras con mecanismo interno sin carga que lo
   * active (p. ej. biela con uz y ry liberados en ambos extremos): su posición es indeterminada; se dibuja por
   * convención unida a los nudos (salto mínimo de las traslaciones liberadas) y `message` incluye un
   * "Aviso: Barra <id>: mecanismo interno sin carga que lo active (…)"; la UI debe marcarla como indeterminada.
   */
  deflections?: Record<Id, DeflectionStation[]>;
}

export interface Solver {
  solve(request: SolveRequest): SolveResult;
}

/**
 * PUNTO DE ENTRADA (contrato fijado por el Arquitecto, 2026-10-30). La implementación de M1 debe exportar
 * desde este módulo exactamente:
 *
 *   export function createSolver(): Solver
 *
 * Es la ÚNICA forma admitida: no se exporta un objeto `solver` ni una función `solve` sueltos. Cada llamada
 * devuelve una instancia independiente y sin estado compartido (apta para Worker; una futura versión
 * Rust/WASM se envuelve tras la misma fábrica). `solve` es síncrono y no lanza por errores del modelo:
 * los comunica con `status` ("invalid-model" | "singular" | "unsupported") y `message`.
 * Mientras `createSolver` no exista, el banco de verificación (tests/verification/adapter.ts) deja en skip
 * las suites del solver. Tratamiento de GDL sin rigidez y mecanismos: ADR-005 (Aceptado).
 */
export type CreateSolver = () => Solver;

/**
 * Implementación M1: análisis "2D-XZ" por rigidez directa (Euler-Bernoulli), ver `solve2d.ts`.
 * `analysis: "3D"` devuelve `unsupported` con un mensaje de "no soportado" (pendiente de M4) sin intentar resolver.
 * Con status "ok" rellena `deflections` (deformada exacta en ejes globales, ver `sections.ts` → `memberDeflection`).
 * Sin estado compartido: cada instancia es independiente.
 */
export function createSolver(): Solver {
  return {
    solve: (request: SolveRequest): SolveResult => {
      // Contrato: `solve` no lanza. Una excepción aquí solo puede ser un error interno (no del modelo).
      try {
        return solve2D(request).result;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { status: "invalid-model", message: `Error interno del solver: ${detail}`, displacements: {}, reactions: {}, members: [] };
      }
    },
  };
}
