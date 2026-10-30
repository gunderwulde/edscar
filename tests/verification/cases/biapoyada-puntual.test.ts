/** Biapoyada con carga puntual centrada y excentrica. L=8 m, P=40 kN, EI=25000 kN*m2 (Iy = 1.25e-4). */
import type { Load } from "@edscar/model";
import { beamToCase, buildBeam, nodalLoad, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { simplySupportedPoint } from "../reference";

const L = 8;
const P = 40;
const EI = 25000;
const sup = [
  { x: 0, fixed: SUP.pinned },
  { x: L, fixed: SUP.roller },
];

const memberPoint = (at: number, relative: boolean): Load => ({
  id: "P1",
  pattern: "G",
  type: "member-point",
  member: "M0",
  p: [0, 0, -P],
  at,
  relative,
  frame: "global",
});

function variantsFor(name: string, a: number, relativeAt: boolean, withNodal: boolean): Variant[] {
  const ref = simplySupportedPoint({ L, a, P, EI, id: name });
  const out: Variant[] = [
    {
      name: `${name}: member-point en 1 barra (${relativeAt ? "at relativo" : "at absoluto"}), estaciones duplicadas`,
      build: () =>
        buildBeam({
          xs: [0, L],
          supports: sup,
          loads: () => [memberPoint(relativeAt ? a / L : a, relativeAt)],
          A: 0.01,
          Iy: 1.25e-4,
        }),
      ref: beamToCase(ref, [0, L]),
    },
  ];
  if (withNodal) {
    out.push({
      name: `${name}: carga nodal en nudo intermedio (flecha y giros en el punto de carga)`,
      build: () =>
        buildBeam({
          xs: [0, a, L],
          supports: sup,
          loads: ({ node }) => [nodalLoad("P1", node(1), [0, 0, -P])],
          A: 0.01,
          Iy: 1.25e-4,
        }),
      ref: beamToCase(ref, [0, a, L]),
    });
  }
  return out;
}

registerCase("Biapoyada con puntual centrada", variantsFor("PUNT-C", L / 2, true, true));
registerCase("Biapoyada con puntual excentrica", [
  ...variantsFor("PUNT-E", 2.5, true, true),
  ...variantsFor("PUNT-E-abs", 2.5, false, false),
]);
