import { describe, expect, it } from "vitest";
import type { Load, Project } from "@edscar/model";
import { beamE1Project } from "@edscar/ui-state";
import { arrowHead, arcGeometry } from "./svg";
import {
  ARROW_MAX_PX, ARROW_MIN_PX, arrowLength, computeLoadScale, globalXZ, hitLoad, loadGlyphs,
} from "./loadGlyphs";
import { formatNumber, patternColor } from "./format";
import { worldToScreen, type Frame } from "./transform";

// 100 px/m, el origen del modelo en (100, 450) de pantalla.
const frame: Frame = { view: { cx: 3, cz: 1.5, zoom: 100 }, vp: { width: 800, height: 600 } };
const none = new Set<string>();

function withLoads(loads: Load[], base: Project = beamE1Project()): Project {
  return { ...base, loads };
}

describe("escalado de flechas", () => {
  it("proporcional al módulo: la mayor mide ARROW_MAX_PX", () => {
    expect(arrowLength(10, 10)).toBe(ARROW_MAX_PX);
    expect(arrowLength(5, 10)).toBe(ARROW_MAX_PX / 2);
    expect(arrowLength(-2.5, 10)).toBe(ARROW_MAX_PX / 4);
  });

  it("valores no nulos muy pequeños no desaparecen (mínimo) y el cero no dibuja nada", () => {
    expect(arrowLength(0.001, 10)).toBe(ARROW_MIN_PX);
    expect(arrowLength(0, 10)).toBe(0);
    expect(arrowLength(5, 0)).toBe(0);
  });

  it("formatNumber: enteros sin decimales, pequeños con 3, muy pequeños en exponencial", () => {
    expect(formatNumber(-10)).toBe("-10");
    expect(formatNumber(45)).toBe("45");
    expect(formatNumber(0.0084375)).toBe("0.008");
    expect(formatNumber(6.5)).toBe("6.5");
    expect(formatNumber(1e-5)).toBe("1.0e-5");
    expect(formatNumber(-0.0001)).toBe("-1.0e-4");
    expect(formatNumber(NaN)).toBe("–");
    expect(formatNumber(2e6)).toBe("2.0e6");
    expect(formatNumber(1e-13 * 0)).toBe("0");
  });

  it("colores de patrón cíclicos", () => {
    expect(patternColor(0)).toBe("var(--ec-pat-0)");
    expect(patternColor(9)).toBe("var(--ec-pat-1)");
    expect(patternColor(-1)).toBe("var(--ec-pat-7)");
  });
});

describe("carga uniforme global (E1: -10 kN/m en Z)", () => {
  const g = loadGlyphs(beamE1Project(), frame, none)[0];

  it("hay un símbolo con relleno, flechas hacia abajo y etiqueta con el valor", () => {
    expect(g?.loadId).toBe("L1");
    expect(g?.fill).toHaveLength(4);
    expect(g?.label.text).toBe("G: wz=-10 kN/m");
    // 6 m * 100 px/m = 600 px -> round(600/28) + 1 = 22 flechas
    expect(g?.arrows).toHaveLength(22);
  });

  it("las flechas apuntan hacia abajo (cola arriba) con longitud ARROW_MAX_PX y la cabeza sobre la barra", () => {
    const a = g?.arrows[0];
    const origin = worldToScreen(frame, 0, 0);
    expect(a?.head.x).toBeCloseTo(origin.x, 9);
    expect(a?.tail.x).toBeCloseTo(origin.x, 9);
    expect((a?.tail.y ?? 0) < (a?.head.y ?? 0)).toBe(true);
    expect((a?.head.y ?? 0) - (a?.tail.y ?? 0)).toBeCloseTo(ARROW_MAX_PX, 9);
    expect(origin.y - (a?.head.y ?? 0)).toBeCloseTo(4, 9); // separación de 4 px sobre la barra
  });

  it("el relleno cubre toda la barra: x desde 0 hasta 6 m", () => {
    const xs = g?.fill?.map((p) => p.x) ?? [];
    expect(Math.min(...xs)).toBeCloseTo(100, 9);
    expect(Math.max(...xs)).toBeCloseTo(700, 9);
  });
});

describe("trapezoidal, puntual, nodal, momento, térmica", () => {
  const base = beamE1Project();

  it("trapezoidal w1=-2 en a=1 y w2=-6 en b=5: longitudes 2/6 y 6/6 del máximo; etiqueta con w1→w2", () => {
    const l: Load = { id: "T", pattern: "G", type: "member-trapezoid", member: "E1", w1: [0, 0, -2], w2: [0, 0, -6], frame: "global", a: 1, b: 5 };
    const g = loadGlyphs(withLoads([l], base), frame, none)[0];
    const [h0, t0, t1, h1] = g?.fill ?? [];
    expect(h0?.x).toBeCloseTo(200, 9); // a = 1 m
    expect(h1?.x).toBeCloseTo(600, 9); // b = 5 m
    expect(Math.hypot((t0?.x ?? 0) - (h0?.x ?? 0), (t0?.y ?? 0) - (h0?.y ?? 0))).toBeCloseTo(ARROW_MAX_PX / 3, 9);
    expect(Math.hypot((t1?.x ?? 0) - (h1?.x ?? 0), (t1?.y ?? 0) - (h1?.y ?? 0))).toBeCloseTo(ARROW_MAX_PX, 9);
    expect(g?.label.text).toBe("G: wz=-2→-6 kN/m");
  });

  it("la escala usa el máximo entre las cargas visibles: ocultar el patrón mayor agranda las demás", () => {
    const p2: Project = { ...base, patterns: [...base.patterns, { id: "Q", name: "Q", kind: "L", selfWeightFactor: 0 }] };
    const loads: Load[] = [
      { id: "L1", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, -10], frame: "global" },
      { id: "L2", pattern: "Q", type: "member-uniform", member: "E1", w: [0, 0, -5], frame: "global" },
    ];
    const proj = withLoads(loads, p2);
    expect(computeLoadScale(proj, none)).toEqual({ maxForce: 0, maxLine: 10 });
    const both = loadGlyphs(proj, frame, none);
    const q = both.find((g) => g.loadId === "L2");
    expect(Math.abs((q?.arrows[0]?.head.y ?? 0) - (q?.arrows[0]?.tail.y ?? 0))).toBeCloseTo(ARROW_MAX_PX / 2, 9);
    const onlyQ = loadGlyphs(proj, frame, new Set(["G"]));
    expect(onlyQ.map((g) => g.loadId)).toEqual(["L2"]);
    expect(Math.abs((onlyQ[0]?.arrows[0]?.head.y ?? 0) - (onlyQ[0]?.arrows[0]?.tail.y ?? 0))).toBeCloseTo(ARROW_MAX_PX, 9);
  });

  it("dos patrones sobre la misma cara se apilan: el segundo queda más lejos de la barra", () => {
    const p2: Project = { ...base, patterns: [...base.patterns, { id: "Q", name: "Q", kind: "L", selfWeightFactor: 0 }] };
    const loads: Load[] = [
      { id: "L1", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, -10], frame: "global" },
      { id: "L2", pattern: "Q", type: "member-uniform", member: "E1", w: [0, 0, -10], frame: "global" },
    ];
    const [a, b] = loadGlyphs(withLoads(loads, p2), frame, none);
    expect((b?.arrows[0]?.head.y ?? 0) < (a?.arrows[0]?.tail.y ?? 0)).toBe(true); // la cabeza del 2.º por encima de la cola del 1.º
  });

  it("puntual relativa a L/2 con P=-20: cabeza sobre el centro de la barra y flecha hacia abajo", () => {
    const l: Load = { id: "P", pattern: "G", type: "member-point", member: "E1", p: [0, 0, -20], at: 0.5, relative: true, frame: "global" };
    const g = loadGlyphs(withLoads([l], base), frame, none)[0];
    const a = g?.arrows[0];
    expect(a?.head.x).toBeCloseTo(400, 9);
    expect((a?.tail.y ?? 0) < (a?.head.y ?? 0)).toBe(true);
    expect(g?.label.text).toBe("G: Pz=-20 kN");
    const abs: Load = { ...l, id: "P2", at: 1.5, relative: false };
    expect(loadGlyphs(withLoads([abs], base), frame, none)[0]?.arrows[0]?.head.x).toBeCloseTo(250, 9);
  });

  it("nodal Fx=+8 en B: la flecha apunta a la derecha (cola a la izquierda) y mide el máximo", () => {
    const l: Load = { id: "N", pattern: "G", type: "nodal", node: "B", f: [8, 0, 0], m: [0, 0, 0] };
    const g = loadGlyphs(withLoads([l], base), frame, none)[0];
    const a = g?.arrows[0];
    expect((a?.tail.x ?? 0) < (a?.head.x ?? 0)).toBe(true);
    expect((a?.head.x ?? 0) - (a?.tail.x ?? 0)).toBeCloseTo(ARROW_MAX_PX, 9);
    expect(g?.label.text).toBe("G: Fx=8 kN");
  });

  it("momento nodal My>0 es horario en pantalla y My<0 antihorario (ADR-001: +My lleva +x hacia -z)", () => {
    const mk = (my: number): Load => ({ id: "M", pattern: "G", type: "nodal", node: "A", f: [0, 0, 0], m: [0, my, 0] });
    expect(loadGlyphs(withLoads([mk(5)], base), frame, none)[0]?.arc?.clockwise).toBe(true);
    expect(loadGlyphs(withLoads([mk(-5)], base), frame, none)[0]?.arc?.clockwise).toBe(false);
    expect(loadGlyphs(withLoads([mk(-5)], base), frame, none)[0]?.label.text).toBe("G: My=-5 kN·m");
  });

  it("momento puntual de barra en ejes locales se pasa a globales con los ejes de la barra", () => {
    // Barra horizontal: y local = +Y global, así que my local = My global.
    const l: Load = { id: "MP", pattern: "G", type: "member-point", member: "E1", p: [0, 0, 0], m: [0, 7, 0], at: 3, relative: false, frame: "local" };
    const g = loadGlyphs(withLoads([l], base), frame, none)[0];
    expect(g?.arc?.clockwise).toBe(true);
    expect(g?.arrows).toHaveLength(0);
  });

  it("carga en ejes locales sobre un pilar: wz local = +X global (ADR-001, z = +X en barras verticales)", () => {
    const col: Project = {
      ...base,
      nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 0, y: 0, z: 3 }],
      supports: [],
      loads: [{ id: "L1", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, 4], frame: "local" }],
    };
    expect(globalXZ([0, 0, 4], "local", null)).toEqual([0, 4]);
    const g = loadGlyphs(col, frame, none)[0];
    const a = g?.arrows[0];
    expect((a?.tail.x ?? 0) < (a?.head.x ?? 0)).toBe(true); // hacia +X
    expect(g?.label.text).toBe("G: wz'=4 kN/m");
  });

  it("térmica y desplazamiento impuesto producen símbolos discontinuos con etiqueta", () => {
    const loads: Load[] = [
      { id: "T", pattern: "G", type: "thermal", member: "E1", dT: 20, gradientZ: 30 },
      { id: "D", pattern: "G", type: "support-displacement", node: "B", d: [0, 0, -0.01, 0, 0, 0] },
    ];
    const [t, d] = loadGlyphs(withLoads(loads, base), frame, none);
    expect(t?.dashed).toBe(true);
    expect(t?.label.text).toBe("G: ΔT=20 °C, ∇z=30 °C/m");
    expect(d?.arrows).toHaveLength(1);
    expect(d?.label.text).toBe("G: δz=-0.01 m");
  });

  it("ignora cargas cuya barra/nudo no existe o de módulo cero", () => {
    const loads: Load[] = [
      { id: "Z", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, 0], frame: "global" },
    ];
    expect(loadGlyphs(withLoads(loads, base), frame, none)).toEqual([]);
  });
});

describe("selección de cargas con el ratón", () => {
  it("hitLoad encuentra la flecha más cercana y null lejos", () => {
    const glyphs = loadGlyphs(beamE1Project(), frame, none);
    const a = glyphs[0]?.arrows[3];
    const mid = { x: (a?.head.x ?? 0) + 2, y: ((a?.head.y ?? 0) + (a?.tail.y ?? 0)) / 2 };
    expect(hitLoad(glyphs, mid)).toBe("L1");
    expect(hitLoad(glyphs, { x: 400, y: 10 })).toBeNull();
  });

  it("hitLoad también acierta sobre el arco de un momento", () => {
    const l: Load = { id: "M", pattern: "G", type: "nodal", node: "A", f: [0, 0, 0], m: [0, 5, 0] };
    const glyphs = loadGlyphs(withLoads([l]), frame, none);
    const o = worldToScreen(frame, 0, 0);
    expect(hitLoad(glyphs, { x: o.x, y: o.y - 14 })).toBe("M");
  });
});

describe("primitivas SVG", () => {
  it("la cabeza de flecha tiene la punta en `head` y es simétrica", () => {
    const pts = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 7).split(" ");
    expect(pts[0]).toBe("10,0");
    expect(pts).toHaveLength(3);
    expect(arrowHead({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe("");
  });

  it("el arco horario y el antihorario usan la bandera de barrido correcta", () => {
    expect(arcGeometry({ cx: 0, cy: 0, r: 10, clockwise: true }).d).toMatch(/A 10 10 0 1 1 /);
    expect(arcGeometry({ cx: 0, cy: 0, r: 10, clockwise: false }).d).toMatch(/A 10 10 0 1 0 /);
    expect(arcGeometry({ cx: 0, cy: 0, r: 10, clockwise: true }).head.split(" ")).toHaveLength(3);
  });
});
