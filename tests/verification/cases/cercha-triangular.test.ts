/**
 * Cercha triangular isostatica: A(0,0,0) fijo, B(8,0,0) rodillo, C(4,0,3), P=60 kN hacia abajo en C.
 * Barras biarticuladas (releases ry en ambos extremos). E=2.1e8, A=0.004 => EA=840000 kN.
 * NOTA DE CONTRATO: los giros nodales quedan sin rigidez (todas las barras articuladas). Tratamiento en ADR-005
 * (Propuesto): condensacion + eliminacion de esos giros, sin estabilizacion; status "ok". Ejemplo numerico en ADR-005 seccion 4.
 */
import type { Load, Member } from "@edscar/model";
import { buildProject, nodalLoad, SUP } from "../builders";
import { registerCase } from "../harness";
import { triangularTruss } from "../reference";
import type { Tol } from "../compare";

const pinned = { i: { ry: true }, j: { ry: true } };
const member = (id: string, i: string, j: string): Member => ({ id, i, j, material: "M1", section: "S1", releases: pinned });
const ref = triangularTruss({ L: 8, H: 3, P: 60, EA: 840000 });
// Los giros no se comparan (sin rigidez); N exacto y flechas de ~1e-4 m.
const tol: Tol = { rel: 1e-6, absForce: 1e-7, absDisp: 1e-10 };

registerCase("Cercha triangular isostatica", [
  {
    name: "P en el vertice",
    build: () => {
      const loads: Load[] = [nodalLoad("P1", "C", [0, 0, -60])];
      return buildProject({
        nodes: [
          { id: "A", x: 0, y: 0, z: 0 },
          { id: "B", x: 8, y: 0, z: 0 },
          { id: "C", x: 4, y: 0, z: 3 },
        ],
        members: [member("AB", "A", "B"), member("AC", "A", "C"), member("BC", "B", "C")],
        supports: [
          { id: "SA", node: "A", fixed: SUP.pinned },
          { id: "SB", node: "B", fixed: SUP.roller },
        ],
        loads,
        E: 2.1e8,
        A: 0.004,
        Iy: 1e-6,
      });
    },
    ref,
    tol,
  },
]);
