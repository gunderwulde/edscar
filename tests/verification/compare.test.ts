/**
 * Prueba de la fontaneria del banco (no del solver): un "resultado simulado" construido a partir de la propia
 * referencia debe pasar `compareCase`, y versiones adulteradas deben fallar. No sustituye la verificacion del solver.
 */
import { describe, expect, it } from "vitest";
import type { SolveResult } from "@edscar/solver";
import { compareCase } from "./compare";
import { beamToCase } from "./builders";
import { endForcesFromSections, simplySupportedPoint } from "./reference";
import type { CaseRef, Dof6 } from "./reference";

function mockResult(ref: CaseRef): SolveResult {
  const displacements: Record<string, Dof6> = {};
  for (const [n, d] of Object.entries(ref.nodeDisp)) displacements[n] = [d.ux ?? 0, 0, d.uz ?? 0, 0, d.ry ?? 0, 0];
  return {
    status: "ok",
    displacements,
    reactions: { ...ref.reactions },
    members: Object.entries(ref.members).map(([member, m]) => {
      const xs = [0, ...m.jumps.flatMap((j) => [j, j]), m.length / 2, m.length].sort((a, b) => a - b);
      const seen = new Set<number>();
      const stations = xs.map((x) => {
        const dup = m.jumps.includes(x);
        const side = dup ? (seen.has(x) ? ("right" as const) : ("left" as const)) : undefined;
        seen.add(x);
        const f = m.forces(x, side ?? (x === 0 ? "right" : "left"));
        return { x, ...(side ? { side } : {}), N: f.N, Vy: 0, Vz: f.Vz, T: 0, My: f.My, Mz: 0 };
      });
      const e = endForcesFromSections(m.forces(0, "right"), m.forces(m.length, "left"));
      return { member, endForces: { i: e.i, j: e.j }, stations };
    }),
  };
}

describe("compareCase (fontaneria del banco)", () => {
  const ref = beamToCase(simplySupportedPoint({ L: 8, a: 2.5, P: 40, EI: 25000 }), [0, 8]);
  it("acepta un resultado coherente con la referencia", () => {
    expect(() => {
      compareCase(mockResult(ref), ref);
    }).not.toThrow();
  });
  it("rechaza una reaccion alterada un 1e-4 relativo", () => {
    const bad = mockResult(ref);
    const r = bad.reactions.N0 ?? [0, 0, 0, 0, 0, 0];
    bad.reactions.N0 = [r[0], r[1], r[2] * (1 + 1e-4), r[3], r[4], r[5]];
    expect(() => {
      compareCase(bad, ref);
    }).toThrow();
  });
  it("rechaza si falta el par left/right en la discontinuidad", () => {
    const bad = mockResult(ref);
    const m = bad.members[0];
    if (m) m.stations = m.stations.filter((s) => s.side !== "right");
    expect(() => {
      compareCase(bad, ref);
    }).toThrow();
  });
  it("rechaza un signo de My invertido", () => {
    const bad = mockResult(ref);
    const m = bad.members[0];
    if (m) m.stations = m.stations.map((s) => ({ ...s, My: -s.My }));
    expect(() => {
      compareCase(bad, ref);
    }).toThrow();
  });
  it("rechaza status distinto de ok", () => {
    expect(() => {
      compareCase({ ...mockResult(ref), status: "singular" }, ref);
    }).toThrow();
  });
});
