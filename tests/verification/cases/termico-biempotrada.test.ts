/**
 * Termica en biempotrada (ADR-001 5.1): N = -EA*alpha*dT ; My = -EIy*alpha*gradientZ (presentacion M > 0).
 * L=5, E=2e8, A=0.01 (EA=2e6), Iy=1e-4 (EI=20000), alpha=1.2e-5.
 */
import type { Load } from "@edscar/model";
import { beamToCase, buildBeam, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { thermalFixedFixed } from "../reference";

const L = 5;
const base = { L, EA: 2e6, EIy: 20000, alpha: 1.2e-5 };

const mk = (dT: number, g: number, xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.fixed },
      { x: L, fixed: SUP.fixed },
    ],
    loads: ({ member, n }): Load[] =>
      Array.from({ length: n }, (_, k) => ({
        id: `TH${String(k)}`,
        pattern: "G",
        type: "thermal" as const,
        member: member(k),
        dT,
        gradientZ: g,
      })),
    A: 0.01,
    Iy: 1e-4,
    alpha: 1.2e-5,
  });

const variants: Variant[] = [
  {
    name: "dT = +30 degC (axial, comprimida)",
    build: mk(30, 0, [0, L]),
    ref: beamToCase(thermalFixedFixed({ ...base, dT: 30, gradZ: 0 }), [0, L]),
  },
  {
    name: "gradientZ = +40 degC/m (My = -EI*alpha*g)",
    build: mk(0, 40, [0, L]),
    ref: beamToCase(thermalFixedFixed({ ...base, dT: 0, gradZ: 40 }), [0, L]),
  },
  {
    name: "dT = -25 y gradientZ = -15 combinados",
    build: mk(-25, -15, [0, L]),
    ref: beamToCase(thermalFixedFixed({ ...base, dT: -25, gradZ: -15 }), [0, L]),
  },
  {
    name: "dT = 30 y gradientZ = 40, 2 barras",
    build: mk(30, 40, [0, 2, L]),
    ref: beamToCase(thermalFixedFixed({ ...base, dT: 30, gradZ: 40 }), [0, 2, L]),
  },
];
registerCase("Termica en biempotrada (axial y gradiente)", variants);
