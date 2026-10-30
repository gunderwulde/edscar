#!/usr/bin/env node
// Ejecuta el banco de verificacion analitico (tests/verification).
//   pnpm verify                    -> corre el banco; los casos que necesitan el solver quedan SKIP si no existe.
//   pnpm verify --require-solver   -> falla si @edscar/solver no esta implementado (casos 2D sin verificar).
//   pnpm verify --require-3d       -> ademas exige el solver 3D (casos "PENDIENTE 3D").
// Mecanismo: pasa EDSCAR_REQUIRE_SOLVER=1 / EDSCAR_REQUIRE_3D=1 a vitest; tests/verification/adapter.ts convierte
// cada suite dependiente del solver en un fallo explicito en lugar de describe.skip. Sin dependencias externas.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const known = new Set(["--require-solver", "--require-3d"]);
const unknown = args.filter((a) => !known.has(a));
if (unknown.length > 0) {
  console.error(`Argumentos desconocidos: ${unknown.join(" ")}\nUso: pnpm verify [--require-solver] [--require-3d]`);
  process.exit(2);
}
const require3d = args.includes("--require-3d");
const requireSolver = args.includes("--require-solver") || require3d;

const env = { ...process.env };
if (requireSolver) env.EDSCAR_REQUIRE_SOLVER = "1";
if (require3d) env.EDSCAR_REQUIRE_3D = "1";

const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const r = spawnSync(process.execPath, [vitest, "run", "tests/verification"], { cwd: root, env, stdio: "inherit" });
if (r.error) {
  console.error(r.error.message);
  process.exit(2);
}
if (r.status !== 0 && requireSolver) {
  console.error("\nverify: FALLO con --require-solver (casos sin implementar o resultados que no coinciden).");
}
process.exit(r.status ?? 1);
