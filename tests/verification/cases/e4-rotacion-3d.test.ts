/**
 * E4 (ADR-001) - PENDIENTE 3D. Viga horizontal biapoyada con rotation = pi/2 en analysis "3D":
 * y' = +Z, z' = -Y; carga global [0,0,-w] => wy' = -w; flexion con Iz (Iy distinto para detectar confusiones).
 * L=6, w=10, Iz=1e-4 (EIz=20000), Iy=4e-4.
 * Se registra siempre el test de modelo valido; la comparacion queda como pendiente 3D (describe.skip).
 */
import { describe, expect, it } from "vitest";
import { describeSolver3D, solveForTest } from "../adapter";
import { buildBeam, memberId, SUP, udlAll } from "../builders";
import { expectClose } from "../compare";
import { rotatedBeamUdl } from "../reference";

const L = 6;
const w = 10;
const ref = rotatedBeamUdl({ L, w, EIz: 20000 });
const build = () =>
  buildBeam({
    analysis: "3D",
    xs: [0, L],
    supports: [
      { x: 0, fixed: SUP.pinned3D },
      { x: L, fixed: SUP.roller3D },
    ],
    loads: udlAll(w, "global"),
    A: 0.01,
    Iy: 4e-4,
    Iz: 1e-4,
    rotation: Math.PI / 2,
  });

describe("E4 rotacion pi/2 3D: modelo", () => {
  it("modelo valido segun validateProject", () => {
    const p = build();
    expect(p.analysis).toBe("3D");
    expect(p.members[0]?.rotation).toBeCloseTo(Math.PI / 2, 15);
  });
});

describeSolver3D("E4 rotacion pi/2 3D: solver vs referencia", () => {
  it("reacciones, Vy, Mz y flecha uz global = uy local; Vz y My nulos", () => {
    const res = solveForTest(build());
    expect(res.status).toBe("ok");
    ref.reactions.forEach((r, k) => {
      for (const c of [0, 1, 2, 3, 4, 5]) {
        expectClose(res.reactions[`N${String(k * 1)}`]?.[c], r.R[c] ?? 0, `E4 reaccion N${String(k)}[${String(c)}]`, 1e-6, 1e-8);
      }
    });
    const m = res.members.find((x) => x.member === memberId(0));
    expect(m).toBeDefined();
    for (const s of m?.stations ?? []) {
      const e = ref.forces(s.x);
      expectClose(s.Vy, e.Vy, `E4 Vy x=${String(s.x)}`, 1e-6, 1e-8);
      expectClose(s.Mz, e.Mz, `E4 Mz x=${String(s.x)}`, 1e-6, 1e-8);
      expectClose(s.Vz, 0, `E4 Vz x=${String(s.x)}`, 1e-6, 1e-8);
      expectClose(s.My, 0, `E4 My x=${String(s.x)}`, 1e-6, 1e-8);
    }
  });
  it("flecha central (viga partida en el centro)", () => {
    const p = buildBeam({
      analysis: "3D",
      xs: [0, L / 2, L],
      supports: [
        { x: 0, fixed: SUP.pinned3D },
        { x: L, fixed: SUP.roller3D },
      ],
      loads: udlAll(w, "global"),
      A: 0.01,
      Iy: 4e-4,
      Iz: 1e-4,
      rotation: Math.PI / 2,
    });
    const res = solveForTest(p);
    expectClose(res.displacements.N1?.[2], ref.uy(L / 2), "E4 uz(L/2)", 1e-6, 1e-10);
  });
});
