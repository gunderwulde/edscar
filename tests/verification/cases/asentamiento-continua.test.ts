/** Asentamiento delta=12 mm del apoyo central de una viga continua de 2 vanos (L=4) sin cargas. EI=20000. */
import type { Load } from "@edscar/model";
import { beamToCase, buildBeam, indexOfX, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { twoSpanSettlement } from "../reference";

const L = 4;
const delta = 0.012;
const ref = twoSpanSettlement({ L, EI: 20000, delta });
const mk = (xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.pinned },
      { x: L, fixed: SUP.roller },
      { x: 2 * L, fixed: SUP.roller },
    ],
    loads: ({ node }): Load[] => [
      {
        id: "D1",
        pattern: "G",
        type: "support-displacement",
        node: node(indexOfX(xs, L)),
        d: [0, 0, -delta, 0, 0, 0],
      },
    ],
    A: 0.01,
    Iy: 1e-4,
  });

const variants: Variant[] = [
  { name: "2 barras", build: mk([0, L, 2 * L]), ref: beamToCase(ref, [0, L, 2 * L]) },
  { name: "4 barras", build: mk([0, 2, L, 6, 2 * L]), ref: beamToCase(ref, [0, 2, L, 6, 2 * L]) },
];
registerCase("Asentamiento de apoyo en viga continua", variants);
