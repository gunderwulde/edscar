/** Viga continua de 2 vanos iguales (L=5) con carga uniforme q=12: reacciones 3qL/8, 10qL/8, 3qL/8. EI=20000. */
import { beamToCase, buildBeam, SUP, udlAll } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { twoSpanUdl } from "../reference";

const L = 5;
const q = 12;
const ref = twoSpanUdl({ L, q, EI: 20000 });
const mk = (xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.pinned },
      { x: L, fixed: SUP.roller },
      { x: 2 * L, fixed: SUP.roller },
    ],
    loads: udlAll(q, "global"),
    A: 0.01,
    Iy: 1e-4,
  });

const variants: Variant[] = [
  { name: "2 barras (una por vano)", build: mk([0, L, 2 * L]), ref: beamToCase(ref, [0, L, 2 * L]) },
  {
    name: "4 barras (flechas a mitad de vano)",
    build: mk([0, L / 2, L, 1.5 * L, 2 * L]),
    ref: beamToCase(ref, [0, L / 2, L, 1.5 * L, 2 * L]),
  },
];
registerCase("Viga continua de 2 vanos con carga uniforme", variants);
