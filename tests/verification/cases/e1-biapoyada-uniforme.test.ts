/** E1 (ADR-001): biapoyada L=6 m, w=10 kN/m hacia abajo, EI=20000 kN*m2. Referencia: reference/beams.ts */
import { describe, expect, it } from "vitest";
import exampleJson from "../../../packages/model/examples/viga-biapoyada.edscar.json";
import { beamToCase, buildBeam, mustValidate, SUP, udlAll } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { simplySupportedUdl } from "../reference";

const L = 6;
const q = 10;
const EI = 20000; // E = 2e8, Iy = 1e-4
const ref = simplySupportedUdl({ L, q, EI });
const mk = (xs: number[], frame: "global" | "local") => () =>
  buildBeam({
    xs,
    supports: [
      { x: 0, fixed: SUP.pinned },
      { x: L, fixed: SUP.roller },
    ],
    loads: udlAll(q, frame),
    A: 0.01,
    Iy: 1e-4,
  });

const variants: Variant[] = [
  { name: "1 barra, carga global", build: mk([0, L], "global"), ref: beamToCase(ref, [0, L]) },
  {
    name: "1 barra, carga local (barra horizontal: wz local = wZ global)",
    build: mk([0, L], "local"),
    ref: beamToCase(ref, [0, L]),
  },
  { name: "2 barras (flecha central en nudo)", build: mk([0, 3, L], "global"), ref: beamToCase(ref, [0, 3, L]) },
  { name: "4 barras", build: mk([0, 1.5, 3, 4.5, L], "global"), ref: beamToCase(ref, [0, 1.5, 3, 4.5, L]) },
  {
    // Fichero de ejemplo del paquete model (ids A, B, E1): mismo problema que E1.
    name: "fichero packages/model/examples/viga-biapoyada.edscar.json",
    build: () => mustValidate(exampleJson),
    ref: beamToCase(ref, [0, L], { node: (k) => ["A", "B"][k] ?? "?", member: () => "E1" }),
  },
];

registerCase("E1 biapoyada con carga uniforme", variants);

describe("E1: valores literales del ADR en la referencia", () => {
  it("reacciones 30 kN, Vz(0+)=-30, My(3)=-45, flecha -0.008438", () => {
    expect(ref.reactions.map((r) => r.R[2])).toEqual([30, 30]);
    expect(ref.forces(0).Vz).toBe(-30);
    expect(ref.forces(3).My).toBe(-45);
    expect(ref.uz(3)).toBeCloseTo(-0.008438, 6);
  });
});
