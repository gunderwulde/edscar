/** Ejes locales (ADR-001 §3). Esperados a mano según las reglas del ADR. */
import { describe, expect, it } from "vitest";
import { cross, dot, localAxes, toLocal } from "./geometry";
import type { V3 } from "./geometry";

const close = (a: V3, b: V3, digits = 14): void => {
  a.forEach((v, k) => {
    expect(v).toBeCloseTo(b[k] ?? NaN, digits);
  });
};

describe("ejes locales (ADR-001 §3)", () => {
  it("barra horizontal x = +X: y = +Y, z = +Z", () => {
    const ax = localAxes([0, 0, 0], [6, 0, 0]);
    expect(ax.length).toBe(6);
    close(ax.x, [1, 0, 0]);
    close(ax.y, [0, 1, 0]);
    close(ax.z, [0, 0, 1]);
  });

  it("pilar exactamente vertical x = +Z: z = +X, y = −Y", () => {
    const ax = localAxes([0, 0, 0], [0, 0, 4]);
    close(ax.x, [0, 0, 1]);
    close(ax.z, [1, 0, 0]);
    close(ax.y, [0, -1, 0]);
  });

  it("pilar inclinado δ = 1e-4 rad: z ≈ −X, y = +Y (salto de 180°)", () => {
    const d = 1e-4;
    const ax = localAxes([0, 0, 0], [4 * Math.sin(d), 0, 4 * Math.cos(d)]);
    close(ax.z, [-Math.cos(d), 0, Math.sin(d)], 9);
    close(ax.y, [0, 1, 0], 12);
  });

  it("barra 3-4-5 inclinada: x = (0.6, 0, 0.8), z = (−0.8, 0, 0.6), y = +Y", () => {
    const ax = localAxes([0, 0, 0], [3, 0, 4]);
    expect(ax.length).toBe(5);
    close(ax.x, [0.6, 0, 0.8]);
    close(ax.z, [-0.8, 0, 0.6]);
    close(ax.y, [0, 1, 0]);
  });

  it("rotation = π/2 (E4): y' = +Z, z' = −Y", () => {
    const ax = localAxes([0, 0, 0], [6, 0, 0], Math.PI / 2);
    close(ax.y, [0, 0, 1]);
    close(ax.z, [0, -1, 0]);
  });

  it("rotation = π con ajuste 2D: y' = −Y y z' = −Z exactos", () => {
    const ax = localAxes([0, 0, 0], [6, 0, 0], Math.PI, true);
    expect(ax.y.map((v) => v + 0)).toEqual([0, -1, 0]);
    expect(ax.z[1] === 0).toBe(true);
    expect(ax.z[2]).toBe(-1);
    const ax0 = localAxes([0, 0, 0], [6, 0, 0], 2 * Math.PI, true);
    expect(ax0.z[2]).toBe(1);
  });

  it("terna derecha y componentes locales", () => {
    const ax = localAxes([1, 0, 2], [4, 0, 6]);
    close(cross(ax.y, ax.z), ax.x);
    expect(dot(ax.x, ax.z)).toBeCloseTo(0, 15);
    close(toLocal(ax, [0, 0, -10]), [-8, 0, -6]);
  });
});
