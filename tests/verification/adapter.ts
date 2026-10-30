/**
 * Adaptador unico entre el banco de verificacion y @edscar/solver.
 *
 * Deteccion de la implementacion (contrato en packages/solver/src/index.ts, tipo `CreateSolver`): el modulo
 * `@edscar/solver` exporta `createSolver(): Solver`, UNICA forma admitida (decision del Arquitecto,
 * 2026-10-30). No se buscan otras formas (`solver`, `solve`).
 * Mientras no exista, `solverAvailable` es false y los tests dependientes del solver quedan como
 * `describe.skip` con el motivo. Con `EDSCAR_REQUIRE_SOLVER=1` (pnpm verify --require-solver) en cambio FALLAN.
 *
 * Nada aqui calcula valores esperados.
 */
import { describe, expect, it } from "vitest";
import type { Project } from "@edscar/model";
import type { CreateSolver, SolveResult, Solver } from "@edscar/solver";

async function detectSolver(): Promise<Solver | null> {
  const mod = (await import("@edscar/solver")) as unknown as Record<string, unknown>;
  const create = mod.createSolver;
  if (typeof create !== "function") return null;
  const instance = (create as CreateSolver)();
  if (typeof (instance as Partial<Solver> | null)?.solve !== "function") {
    throw new Error("@edscar/solver: createSolver() debe devolver un objeto con solve(request) (contrato Solver)");
  }
  return instance;
}

const envFlag = (name: string): boolean => {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name] === "1";
};

const implementation = await detectSolver();

export const solverAvailable = implementation !== null;
export const requireSolver = envFlag("EDSCAR_REQUIRE_SOLVER");
export const requireThreeD = envFlag("EDSCAR_REQUIRE_3D");

/**
 * Interruptor MANUAL: ponerlo a true cuando el solver soporte `analysis: "3D"` (el dueno de @edscar/solver lo
 * cambia en el PR que lo implemente). Hasta entonces los casos 3D son "pendiente 3D".
 */
export const SOLVER_SUPPORTS_3D = false as boolean;

/** Resuelve el caso `caseId` (por defecto "C1") con el solver real. Lanza si no esta implementado. */
export function solveForTest(project: Project, caseId = "C1"): SolveResult {
  if (!implementation) {
    throw new Error("@edscar/solver no tiene implementacion (ver tests/verification/adapter.ts)");
  }
  return implementation.solve({ project, caseId });
}

const SKIP_MOTIVE = "SKIP: @edscar/solver aun sin implementacion (M1 paso 2)";
const SKIP_3D_MOTIVE = "SKIP: PENDIENTE 3D (solver sin soporte 3D)";

/** Suite que necesita el solver 2D: skip explicito si falta; falla si se exige con --require-solver. */
export function describeSolver(name: string, fn: () => void): void {
  if (solverAvailable) {
    describe(name, fn);
  } else if (requireSolver) {
    describe(name, () => {
      it("el solver debe estar implementado (--require-solver)", () => {
        expect.fail("@edscar/solver sin implementar: el caso no se ha verificado");
      });
    });
  } else {
    describe.skip(`${name} [${SKIP_MOTIVE}]`, fn);
  }
}

/** Suite 3D: igual pero ademas exige SOLVER_SUPPORTS_3D; con --require-3d falla si falta. */
export function describeSolver3D(name: string, fn: () => void): void {
  if (solverAvailable && SOLVER_SUPPORTS_3D) {
    describe(name, fn);
  } else if (requireThreeD) {
    describe(name, () => {
      it("el solver 3D debe estar implementado (--require-3d)", () => {
        expect.fail("solver 3D sin implementar: el caso no se ha verificado");
      });
    });
  } else {
    describe.skip(`${name} [${SKIP_3D_MOTIVE}]`, fn);
  }
}
