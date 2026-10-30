/** Carga trapezoidal sobre biapoyada: q1=1.5 en x=0, q2=4.5 en x=L, L=7, EI=18000 (Iy = 9e-5). */
import type { Load } from "@edscar/model";
import { beamToCase, buildBeam, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { simplySupportedTrapezoid } from "../reference";

const L = 7;
const q1 = 1.5;
const q2 = 4.5;
const ref = simplySupportedTrapezoid({ L, q1, q2, EI: 18000 });
const qAt = (x: number): number => q1 + ((q2 - q1) * x) / L;

const mk = (xs: number[], frame: "global" | "local") => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.pinned },
      { x: L, fixed: SUP.roller },
    ],
    loads: ({ member, n }): Load[] =>
      Array.from({ length: n }, (_, k) => {
        const x0 = xs[k] ?? 0;
        const x1 = xs[k + 1] ?? 0;
        return {
          id: `T${String(k)}`,
          pattern: "G",
          type: "member-trapezoid" as const,
          member: member(k),
          w1: [0, 0, -qAt(x0)] as const,
          w2: [0, 0, -qAt(x1)] as const,
          frame,
          a: 0,
          b: x1 - x0,
        };
      }),
    A: 0.01,
    Iy: 9e-5,
  });

const variants: Variant[] = [
  { name: "1 barra, global", build: mk([0, L], "global"), ref: beamToCase(ref, [0, L]) },
  { name: "1 barra, local", build: mk([0, L], "local"), ref: beamToCase(ref, [0, L]) },
  {
    name: "2 barras (cada una con su tramo del trapecio)",
    build: mk([0, 3.5, L], "global"),
    ref: beamToCase(ref, [0, 3.5, L]),
  },
];
registerCase("Carga trapezoidal sobre biapoyada", variants);
