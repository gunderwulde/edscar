/** E3 (ADR-001): barra axial, i empotrado, carga nodal global f=[+-100,0,0] en j. EA = 2e8*0.01 = 2e6 kN. */
import { beamToCase, buildBeam, nodalLoad, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { axialBar } from "../reference";

const L = 4;
const mk = (F: number, xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [{ x: 0, fixed: SUP.fixed }],
    loads: ({ node, n }) => [nodalLoad("F1", node(n), [F, 0, 0])],
    A: 0.01,
    Iy: 1e-4,
  });

const variants: Variant[] = [100, -100].flatMap((F) => [
  { name: `F=${String(F)}, 1 barra`, build: mk(F, [0, L]), ref: beamToCase(axialBar({ L, F, EA: 2e6 }), [0, L]) },
  { name: `F=${String(F)}, 2 barras`, build: mk(F, [0, 2, L]), ref: beamToCase(axialBar({ L, F, EA: 2e6 }), [0, 2, L]) },
]);

registerCase("E3 axial", variants);
