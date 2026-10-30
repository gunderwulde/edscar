import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkgSrc = (p: string): string => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

// Cobertura (ADR-004): umbral del 90 % en lines, statements, functions y branches, por paquete,
// para los paquetes de dominio crítico model, loads, solver y codes.
const COVERAGE_PACKAGES = ["model", "loads", "solver", "codes", "ui-state"] as const;

// Paquetes que hoy son solo contrato (stubs de M0). Se miden y aparecen en el informe, pero
// quedan EXCLUIDOS del umbral hasta M1. Al empezar la implementación de cada uno en M1, su
// propietario lo quita de esta lista en el mismo PR; desde ese momento rige el 90 %.
const THRESHOLD_PENDING_M1: readonly (typeof COVERAGE_PACKAGES)[number][] = ["loads", "codes"];

const THRESHOLD = { lines: 90, statements: 90, functions: 90, branches: 90 };

const perPackageThresholds = Object.fromEntries(
  COVERAGE_PACKAGES.filter((p) => !THRESHOLD_PENDING_M1.includes(p)).map((p) => [
    `packages/${p}/src/**`,
    THRESHOLD,
  ]),
);

export default defineConfig({
  resolve: {
    // Los tests de tests/verification importan @edscar/* sin ser un paquete del workspace.
    alias: { "@edscar/model": pkgSrc("model"), "@edscar/solver": pkgSrc("solver") },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.tsx",
      // Banco de verificacion analitico (no cuenta para la cobertura: coverage.include solo mide packages/*/src).
      "tests/verification/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: COVERAGE_PACKAGES.map((p) => `packages/${p}/src/**/*.ts`),
      exclude: ["**/*.test.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      // Sin umbral global: cada paquete tiene el suyo (los stubs no deben diluir ni inflar a model).
      thresholds: perPackageThresholds,
    },
  },
});
