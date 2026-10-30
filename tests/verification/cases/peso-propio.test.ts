/** Peso propio: densidad 7.85 t/m3, A=0.01 m2, g=9.81 => w = 0.770085 kN/m (hacia -Z). Biapoyada L=6, EI=20000. */
import { beamToCase, buildBeam, SUP } from "../builders";
import { registerCase } from "../harness";
import { selfWeightSimple } from "../reference";

const L = 6;
const rho = 7.85;
const g = 9.81;
const A = 0.01;
const ref = selfWeightSimple({ L, rho, g, A, EI: 20000 });
const mk = (xs: number[]) => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.pinned },
      { x: L, fixed: SUP.roller },
    ],
    loads: () => [],
    A,
    Iy: 1e-4,
    rho,
    selfWeightFactor: 1,
    gravity: [0, 0, -g],
  });

registerCase("Peso propio", [
  { name: "1 barra", build: mk([0, L]), ref: beamToCase(ref, [0, L]) },
  { name: "2 barras", build: mk([0, 3, L]), ref: beamToCase(ref, [0, 3, L]) },
]);
