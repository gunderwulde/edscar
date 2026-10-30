/**
 * Pilar en voladizo con salto de 180 grados en el eje local (ADR-001 seccion 3): delta = 0 (exactamente vertical,
 * y local = -Y) y delta = 1e-4 rad (casi vertical, y local = +Y). H=4, P=25 kN en +X en la cabeza, EI=20000,
 * EA=2e6. Se compara el My local (signo opuesto) ademas de reacciones, desplazamientos y fuerzas de extremo.
 * Cabeza T = (H sin d, 0, H cos d), longitud H (por construccion).
 */
import { buildProject, nodalLoad, SUP } from "../builders";
import { registerCase } from "../harness";
import { slantedColumn } from "../reference";
import type { Tol } from "../compare";

const H = 4;
const P = 25;
const tol: Tol = { rel: 1e-6, absForce: 1e-7, absDisp: 1e-11 };

const mk = (delta: number) => () =>
  buildProject({
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "T", x: H * Math.sin(delta), y: 0, z: H * Math.cos(delta) },
    ],
    members: [{ id: "C1", i: "A", j: "T", material: "M1", section: "S1" }],
    supports: [{ id: "SA", node: "A", fixed: SUP.fixed }],
    loads: [nodalLoad("P1", "T", [P, 0, 0])],
    A: 0.01,
    Iy: 1e-4, // EI = 20000
  });

registerCase("Pilar con salto de 180 grados (delta = 0)", [
  { name: "delta = 0 (z local = +X, y local = -Y)", build: mk(0), ref: slantedColumn({ H, P, EI: 20000, EA: 2e6, delta: 0 }), tol },
]);
registerCase("Pilar con salto de 180 grados (delta = 1e-4 rad)", [
  {
    name: "delta = 1e-4 (z local ~ -X, y local = +Y)",
    build: mk(1e-4),
    ref: slantedColumn({ H, P, EI: 20000, EA: 2e6, delta: 1e-4 }),
    tol,
  },
]);
