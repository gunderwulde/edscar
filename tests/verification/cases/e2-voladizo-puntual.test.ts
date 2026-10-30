/** E2 (ADR-001): voladizo L=2 m empotrado en x=0, P=15 kN hacia abajo en x=2, EI=10000 kN*m2. */
import { beamToCase, buildBeam, nodalLoad, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { cantileverTip } from "../reference";

const L = 2;
const P = 15;
const ref = cantileverTip({ L, P, EI: 10000 });
const mk = (xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [{ x: 0, fixed: SUP.fixed }],
    loads: ({ node, n }) => [nodalLoad("P1", node(n), [0, 0, -P])],
    A: 0.01,
    Iy: 5e-5, // EI = 2e8 * 5e-5 = 10000
  });

const variants: Variant[] = [
  { name: "1 barra, carga nodal en la punta", build: mk([0, L]), ref: beamToCase(ref, [0, L]) },
  { name: "4 barras, carga nodal en la punta", build: mk([0, 0.5, 1, 1.5, L]), ref: beamToCase(ref, [0, 0.5, 1, 1.5, L]) },
];

registerCase("E2 voladizo con carga puntual", variants);
