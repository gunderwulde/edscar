/**
 * Comparacion solver vs referencia analitica. Tolerancia relativa 1e-6 por defecto; para valores esperados
 * proximos a 0 se usa una tolerancia absoluta (fuerzas/momentos: `absForce`; desplazamientos: `absDisp`).
 * Criterio: |actual - esperado| <= max(rel * |esperado|, abs).
 */
import { expect } from "vitest";
import type { SolveResult } from "@edscar/solver";
import type { CaseRef, Dof6, Forces } from "./reference";
import { endForcesFromSections } from "./reference";

export interface Tol {
  rel: number;
  /** kN y kN*m esperados ~0. */
  absForce: number;
  /** m y rad esperados ~0. */
  absDisp: number;
}

export const DEFAULT_TOL: Tol = { rel: 1e-6, absForce: 1e-8, absDisp: 1e-10 };

export function expectClose(actual: number | undefined, expected: number, label: string, rel: number, abs: number): void {
  expect(actual, `${label}: valor ausente`).toBeDefined();
  const a = actual ?? NaN;
  const tol = Math.max(rel * Math.abs(expected), abs);
  expect(Math.abs(a - expected), `${label}: solver=${String(a)} referencia=${String(expected)} tol=${String(tol)}`).toBeLessThanOrEqual(tol);
}

const COMP = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

function checkDof6(actual: Dof6 | undefined, expected: Dof6, label: string, tol: Tol, kind: "force" | "disp"): void {
  expect(actual, `${label}: falta en el resultado`).toBeDefined();
  expected.forEach((e, k) => {
    const abs = kind === "disp" ? tol.absDisp : tol.absForce;
    expectClose(actual?.[k], e, `${label}.${COMP[k] ?? String(k)}`, tol.rel, abs);
  });
}

function sideOf(x: number, len: number, side: "left" | "right" | undefined): "left" | "right" | undefined {
  if (side) return side;
  if (Math.abs(x) < 1e-9) return "right";
  if (Math.abs(x - len) < 1e-9) return "left";
  return undefined;
}

/** Compara reacciones, esfuerzos por estacion, fuerzas de extremo y desplazamientos nodales. */
export function compareCase(res: SolveResult, ref: CaseRef, tol: Tol = DEFAULT_TOL): void {
  expect(res.status, res.message ?? "").toBe("ok");

  // Reacciones esperadas y ausencia de reacciones espurias.
  for (const [node, R] of Object.entries(ref.reactions)) {
    checkDof6(res.reactions[node], R, `${ref.id} reaccion ${node}`, tol, "force");
  }
  for (const [node, R] of Object.entries(res.reactions)) {
    if (!(node in ref.reactions)) checkDof6(R, [0, 0, 0, 0, 0, 0], `${ref.id} reaccion espuria ${node}`, tol, "force");
  }

  // Desplazamientos nodales.
  for (const [node, d] of Object.entries(ref.nodeDisp)) {
    const got = res.displacements[node];
    expect(got, `${ref.id}: faltan desplazamientos del nudo ${node}`).toBeDefined();
    if (d.ux !== undefined) expectClose(got?.[0], d.ux, `${ref.id} ${node}.ux`, tol.rel, tol.absDisp);
    if (d.uz !== undefined) expectClose(got?.[2], d.uz, `${ref.id} ${node}.uz`, tol.rel, tol.absDisp);
    if (d.ry !== undefined) expectClose(got?.[4], d.ry, `${ref.id} ${node}.ry`, tol.rel, tol.absDisp);
    // Fuera del plano: nulos (ADR-001 2.1).
    for (const k of [1, 3, 5]) expectClose(got?.[k], 0, `${ref.id} ${node}.${COMP[k] ?? ""} (fuera de plano)`, tol.rel, tol.absDisp);
  }

  // Barras.
  for (const [mid, m] of Object.entries(ref.members)) {
    const r = res.members.find((x) => x.member === mid);
    expect(r, `${ref.id}: falta la barra ${mid}`).toBeDefined();
    if (!r) continue;
    const label = `${ref.id} barra ${mid}`;
    expect(r.stations.length, `${label}: sin estaciones`).toBeGreaterThanOrEqual(2);
    expectClose(r.stations[0]?.x, 0, `${label} primera estacion x`, 0, 1e-12);
    expectClose(r.stations[r.stations.length - 1]?.x, m.length, `${label} ultima estacion x`, 1e-12, 1e-12);
    let prev = -Infinity;
    for (const s of r.stations) {
      expect(s.x, `${label}: estaciones no ordenadas`).toBeGreaterThanOrEqual(prev);
      prev = s.x;
      const e: Forces = m.forces(s.x, sideOf(s.x, m.length, s.side));
      const at = `${label} x=${String(s.x)}${s.side ? s.side : ""}`;
      expectClose(s.N, e.N, `${at} N`, tol.rel, tol.absForce);
      expectClose(s.Vz, e.Vz, `${at} Vz`, tol.rel, tol.absForce);
      expectClose(s.My, e.My, `${at} My`, tol.rel, tol.absForce);
      for (const [k, v] of [["Vy", s.Vy], ["T", s.T], ["Mz", s.Mz]] as const) {
        expectClose(v, 0, `${at} ${k} (fuera de plano)`, tol.rel, tol.absForce);
      }
    }
    // Discontinuidades interiores: exactamente un par left/right con la misma x.
    for (const j of m.jumps) {
      const at = r.stations.filter((s) => Math.abs(s.x - j) < 1e-9);
      expect(at.length, `${label}: debe haber 2 estaciones en x=${String(j)}`).toBe(2);
      expect(at[0]?.side, `${label}: la primera de x=${String(j)} debe ser left`).toBe("left");
      expect(at[1]?.side, `${label}: la segunda de x=${String(j)} debe ser right`).toBe("right");
    }
    // Fuerzas de extremo (ADR-001 6.2), derivadas de los esfuerzos de la referencia.
    const ef = endForcesFromSections(m.forces(0, "right"), m.forces(m.length, "left"));
    checkDof6(r.endForces.i, ef.i, `${label} endForces.i`, tol, "force");
    checkDof6(r.endForces.j, ef.j, `${label} endForces.j`, tol, "force");
  }
}
