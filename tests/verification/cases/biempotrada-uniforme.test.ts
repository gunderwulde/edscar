/** Biempotrada con carga uniforme: empotramiento perfecto +-wL2/12, flecha wL4/(384EI) (ADR-001 6.2). L=5, w=12, EI=20000. */
import { beamToCase, buildBeam, SUP, udlAll } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { fixedFixedUdl } from "../reference";

const L = 5;
const q = 12;
const ref = fixedFixedUdl({ L, q, EI: 20000 });
const mk = (xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.fixed },
      { x: L, fixed: SUP.fixed },
    ],
    loads: udlAll(q, "global"),
    A: 0.01,
    Iy: 1e-4,
  });

const variants: Variant[] = [
  { name: "1 barra (endForces = empotramiento perfecto)", build: mk([0, L]), ref: beamToCase(ref, [0, L]) },
  { name: "2 barras (flecha central en nudo)", build: mk([0, L / 2, L]), ref: beamToCase(ref, [0, L / 2, L]) },
];
registerCase("Biempotrada con carga uniforme", variants);
