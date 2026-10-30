import { describe, expect, it } from "vitest";
import {
  defaultStorage, diagramSide, DIAGRAM_UNIT, localToGlobal, memberAxes, parseProjectText, presentedValue, serializeProject,
  beamE1Project, PACKAGE_NAME,
} from "./index";

const close = (a: readonly number[], b: readonly number[]): void => {
  a.forEach((v, k) => {
    expect(v).toBeCloseTo(b[k] ?? NaN, 12);
  });
};

describe("ejes locales de barra (ADR-001 §3)", () => {
  it("barra horizontal hacia +X: x = +X, y = +Y, z = +Z", () => {
    const ax = memberAxes({ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });
    close(ax?.x ?? [], [1, 0, 0]);
    close(ax?.y ?? [], [0, 1, 0]);
    close(ax?.z ?? [], [0, 0, 1]);
    expect(ax?.length).toBe(6);
  });

  it("pilar vertical hacia +Z: z = +X, y = -Y", () => {
    const ax = memberAxes({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 });
    close(ax?.x ?? [], [0, 0, 1]);
    close(ax?.z ?? [], [1, 0, 0]);
    close(ax?.y ?? [], [0, -1, 0]);
  });

  it("pilar casi vertical (δ = 1e-4 rad): el salto de 180° del ADR (z ≈ -X, y ≈ +Y)", () => {
    const d = 1e-4;
    const ax = memberAxes({ x: 0, y: 0, z: 0 }, { x: Math.sin(d), y: 0, z: Math.cos(d) });
    expect(ax?.z[0]).toBeLessThan(-0.99);
    expect(ax?.y[1]).toBeGreaterThan(0.99);
  });

  it("barra inclinada 45°: z perpendicular a x en el plano X-Z", () => {
    const ax = memberAxes({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 });
    const s = Math.SQRT1_2;
    close(ax?.x ?? [], [s, 0, s]);
    close(ax?.z ?? [], [-s, 0, s]);
  });

  it("rotación π invierte y y z; rotación π/2 lleva y' a +Z (ADR E4)", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 4, y: 0, z: 0 };
    close(memberAxes(a, b, Math.PI)?.z ?? [], [0, 0, -1]);
    const q = memberAxes(a, b, Math.PI / 2);
    close(q?.y ?? [], [0, 0, 1]);
    close(q?.z ?? [], [0, -1, 0]);
  });

  it("nudos coincidentes: sin ejes", () => {
    expect(memberAxes({ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 })).toBeNull();
  });

  it("local → global con los ejes de un pilar", () => {
    const ax = memberAxes({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 });
    if (!ax) throw new Error("sin ejes");
    close(localToGlobal(ax, [1, 0, 0]), [0, 0, 1]);
    close(localToGlobal(ax, [0, 0, 1]), [1, 0, 0]);
    close(localToGlobal(ax, [2, 3, 4]), [4, -3, 2]);
  });
});

describe("presentación de esfuerzos (ADR-001 §7, ejemplo E1)", () => {
  it("V = -Vz, M = -My, N tal cual", () => {
    // E1: Vz(0+) = -30, My(3) = -45, N = 5 (tracción)
    expect(presentedValue("V", { N: 0, Vz: -30, My: 0 })).toBe(30);
    expect(presentedValue("M", { N: 0, Vz: 0, My: -45 })).toBe(45);
    expect(presentedValue("N", { N: 5, Vz: 0, My: 0 })).toBe(5);
  });

  it("el momento positivo se dibuja hacia -z (fibra traccionada); N y V hacia +z", () => {
    expect(diagramSide("M")).toBe(-1);
    expect(diagramSide("N")).toBe(1);
    expect(diagramSide("V")).toBe(1);
    expect(DIAGRAM_UNIT.M).toBe("kN·m");
  });
});

describe("persistencia", () => {
  it("serializa y parsea el proyecto E1 sin pérdida", () => {
    const p = beamE1Project();
    const r = parseProjectText(serializeProject(p));
    expect(r.ok && r.project).toEqual(p);
    expect(PACKAGE_NAME).toBe("@edscar/ui-state");
  });

  it("migra un documento de la versión 0 (thermal.gradient -> gradientZ)", () => {
    const doc = JSON.parse(serializeProject(beamE1Project())) as Record<string, unknown>;
    delete doc["schemaVersion"];
    doc["loads"] = [{ id: "T1", pattern: "G", type: "thermal", member: "E1", dT: 10, gradient: 30 }];
    const r = parseProjectText(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.loads[0]).toMatchObject({ gradientZ: 30 });
  });

  it("rechaza una versión futura y JSON roto con errores legibles", () => {
    const future = parseProjectText(JSON.stringify({ schemaVersion: 99 }));
    expect(future.ok).toBe(false);
    const broken = parseProjectText("{");
    expect(broken.ok ? "" : broken.errors[0]?.code).toBe("json-syntax");
  });

  it("defaultStorage no lanza aunque localStorage no exista o falle", () => {
    expect(() => defaultStorage()).not.toThrow();
    const g = globalThis as { localStorage?: unknown };
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("SecurityError"); } });
    expect(defaultStorage()).toBeNull();
    if (had) Object.defineProperty(globalThis, "localStorage", had);
    else delete g.localStorage;
  });
});
