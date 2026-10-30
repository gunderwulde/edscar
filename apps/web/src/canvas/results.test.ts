import { describe, expect, it } from "vitest";
import type { Project } from "@edscar/model";
import { createSolver, type MemberResult, type SolveResult } from "@edscar/solver";
import { beamE1Project, createEmptyProject, SUPPORT_PRESETS } from "@edscar/ui-state";
import {
  autoDeformScale, deformedMember, diagramScale, hermite, maxAbsDiagram, maxDisplacement, memberDiagram, reactionGlyphs,
} from "./results";
import { releaseMarks, supportOutward, supportShape } from "./supports";
import { worldToScreen, type Frame } from "./transform";

const frame: Frame = { view: { cx: 3, cz: 0, zoom: 100 }, vp: { width: 800, height: 600 } };
const origin = worldToScreen(frame, 0, 0); // (100, 300)

const solveE1 = (): SolveResult => createSolver().solve({ project: beamE1Project(), caseId: "C1" });

describe("diagramas de E1 con el solver real (ADR-001 §7)", () => {
  const project = beamE1Project();
  const result = solveE1();

  it("el solver resuelve E1 (precondición): reacciones 30/30 kN", () => {
    expect(result.status).toBe("ok");
    expect(result.reactions["A"]?.[2]).toBeCloseTo(30, 6);
    expect(result.reactions["B"]?.[2]).toBeCloseTo(30, 6);
  });

  it("escala: el valor máximo mide 70 px", () => {
    const max = maxAbsDiagram(result, "M");
    expect(max).toBeCloseTo(45, 6); // wL²/8 = 10*36/8
    expect(diagramScale(max)).toBeCloseTo(70 / 45, 9);
    expect(maxAbsDiagram(result, "V")).toBeCloseTo(30, 6);
    expect(diagramScale(0)).toBe(0);
  });

  it("M se dibuja del lado de la fibra traccionada: la ordenada máxima (45 kN·m) queda DEBAJO de la viga", () => {
    const px = diagramScale(maxAbsDiagram(result, "M"));
    const d = memberDiagram(project, result, "E1", "M", frame, px);
    expect(d).not.toBeNull();
    const peak = d?.labels.find((l) => Math.abs(l.value - 45) < 1e-6);
    expect(peak).toBeDefined();
    expect(peak?.text).toBe("45 kN·m");
    // El punto de mayor ordenada está en x = 3 m (400 px) y 70 px por debajo de la barra (y mayor en pantalla).
    const lowest = d?.outline.reduce((a, b) => (b.y > a.y ? b : a));
    expect(lowest?.x).toBeCloseTo(400, 6);
    expect(lowest?.y).toBeCloseTo(origin.y + 70, 6);
    // Extremos: M = 0 sobre la barra.
    expect(d?.outline[0]?.y).toBeCloseTo(origin.y, 6);
    expect(d?.outline[d.outline.length - 1]?.y).toBeCloseTo(origin.y, 6);
  });

  it("V: +30 kN en el apoyo izquierdo (hacia arriba, +z) y -30 kN en el derecho (hacia abajo)", () => {
    const px = diagramScale(maxAbsDiagram(result, "V"));
    const d = memberDiagram(project, result, "E1", "V", frame, px);
    expect(d?.outline[0]?.y).toBeCloseTo(origin.y - 70, 6);
    expect(d?.outline[d.outline.length - 1]?.y).toBeCloseTo(origin.y + 70, 6);
    const texts = d?.labels.map((l) => l.text).sort();
    expect(texts).toEqual(["-30 kN", "30 kN"]);
  });

  it("el polígono se cierra por la línea base", () => {
    const d = memberDiagram(project, result, "E1", "M", frame, 1);
    expect(d?.polygon[0]?.y).toBeCloseTo(origin.y, 9);
    expect(d?.polygon[d.polygon.length - 1]?.y).toBeCloseTo(origin.y, 9);
    expect(d?.polygon).toHaveLength((d?.outline.length ?? 0) + 2);
  });

  it("N es nulo en E1: sin valores no hay escala ni rótulos", () => {
    expect(maxAbsDiagram(result, "N")).toBeLessThan(1e-9);
    const d = memberDiagram(project, result, "E1", "N", frame, 1);
    expect(d?.labels).toEqual([]);
  });

  it("barra o resultado inexistente devuelven null", () => {
    expect(memberDiagram(project, result, "NOPE", "M", frame, 1)).toBeNull();
    expect(memberDiagram(project, { ...result, members: [] }, "E1", "M", frame, 1)).toBeNull();
  });
});

describe("estaciones duplicadas (discontinuidad)", () => {
  // Viga biapoyada de 6 m con P = 20 kN hacia abajo en x = 3: Vz = -10 antes y +10 después.
  // Presentación V = -Vz: +10 a la izquierda de la carga y -10 a la derecha (salto de 20 kN).
  const project = beamE1Project();
  const st = (x: number, Vz: number, side?: "left" | "right") => ({
    x, ...(side ? { side } : {}), N: 0, Vy: 0, Vz, T: 0, My: 0, Mz: 0,
  });
  const member: MemberResult = {
    member: "E1",
    endForces: { i: [0, 0, 10, 0, 0, 0], j: [0, 0, 10, 0, 0, 0] },
    stations: [st(0, -10), st(3, -10, "left"), st(3, 10, "right"), st(6, 10)],
  };
  const result: SolveResult = { status: "ok", displacements: {}, reactions: {}, members: [member] };

  it("no se deduplican: el diagrama de V tiene un salto vertical en x = 3 m", () => {
    const d = memberDiagram(project, result, "E1", "V", frame, 1);
    expect(d?.outline).toHaveLength(4);
    expect(d?.outline[1]?.x).toBeCloseTo(d?.outline[2]?.x ?? NaN, 9);
    expect(d?.outline[1]?.x).toBeCloseTo(400, 9);
    expect(d?.outline[1]?.y).toBeCloseTo(origin.y - 10, 9); // V = +10 -> arriba
    expect(d?.outline[2]?.y).toBeCloseTo(origin.y + 10, 9); // V = -10 -> abajo
  });
});

describe("deformada", () => {
  it("cúbico de Hermite del voladizo E2 (ADR-001): w(L/2) = -PL³·... = -0.00125 m", () => {
    // L = 2, EI = 10000, P = 15: w(x) = -P x² (3L - x) / (6EI); w(1) = -15·1·5/60000 = -0.00125
    const L = 2;
    const w1 = -0.004;
    const s1 = -0.003; // pendiente dw/dx en la punta = -ry, ry = +PL²/(2EI) = 0.003
    expect(hermite(L, 0, 0, w1, s1, 0.5)).toBeCloseTo(-0.00125, 12);
    expect(hermite(L, 0, 0, w1, s1, 0)).toBe(0);
    expect(hermite(L, 0, 0, w1, s1, 1)).toBeCloseTo(w1, 15);
    for (const xi of [0.25, 0.75]) {
      const x = xi * L;
      expect(hermite(L, 0, 0, w1, s1, xi)).toBeCloseTo((-15 * x * x * (3 * L - x)) / 60000, 12);
    }
  });

  const cantilever: Project = {
    ...createEmptyProject(),
    nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 2, y: 0, z: 0 }],
    members: [{ id: "E2", i: "A", j: "B", material: "MAT1", section: "SEC1" }],
    supports: [{ id: "S", node: "A", fixed: SUPPORT_PRESETS.fixed }],
  };
  const resultE2: SolveResult = {
    status: "ok",
    displacements: { A: [0, 0, 0, 0, 0, 0], B: [0, 0, -0.004, 0, 0.003, 0] },
    reactions: { A: [0, 0, 15, 0, -30, 0] },
    members: [],
  };

  it("sin `deflections`: aproxima con Hermite (marcada como aproximada); punto medio = -0.00125 m * escala", () => {
    const scale = 1000;
    const s = deformedMember(cantilever, resultE2, "E2", scale, frame);
    expect(s?.approximate).toBe(true);
    expect(s?.points).toHaveLength(25);
    const mid = s?.points[12]; // xi = 0.5
    const base = worldToScreen(frame, 1, 0);
    expect(mid?.x).toBeCloseTo(base.x, 6);
    // +z hacia arriba: -0.00125 m * 1000 * 100 px/m = 125 px hacia abajo.
    expect(mid?.y).toBeCloseTo(base.y + 125, 6);
    const tip = s?.points[24];
    expect(tip?.y).toBeCloseTo(worldToScreen(frame, 2, 0).y + 0.004 * 1000 * 100, 6);
  });

  it("con `deflections` del solver las usa tal cual (no aproximada)", () => {
    const withD: SolveResult = {
      ...resultE2,
      deflections: { E2: [{ x: 0, d: [0, 0, 0] }, { x: 1, d: [0, 0, -0.00125] }, { x: 2, d: [0, 0, -0.004] }] },
    };
    const s = deformedMember(cantilever, withD, "E2", 1000, frame);
    expect(s?.approximate).toBe(false);
    expect(s?.points).toHaveLength(3);
    expect(s?.points[1]?.y).toBeCloseTo(worldToScreen(frame, 1, 0).y + 125, 6);
  });

  it("con liberaciones o GDL indeterminados dibuja la cuerda entre nudos deformados", () => {
    const rel: Project = {
      ...cantilever,
      members: [{ id: "E2", i: "A", j: "B", material: "MAT1", section: "SEC1", releases: { j: { ry: true } } }],
    };
    const s = deformedMember(rel, resultE2, "E2", 1000, frame);
    expect(s?.points).toHaveLength(2);
    const indet = deformedMember(cantilever, { ...resultE2, indeterminateDofs: { B: [4] } }, "E2", 1000, frame);
    expect(indet?.points).toHaveLength(2);
  });

  it("barra vertical: el desplazamiento transversal se mide perpendicular a la barra", () => {
    const col: Project = {
      ...cantilever,
      nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 0, y: 0, z: 2 }],
    };
    // Sin giros: ux = +0.01 en la cabeza del pilar -> la cabeza se desplaza 0.01 m a la derecha.
    const res: SolveResult = { status: "ok", displacements: { A: [0, 0, 0, 0, 0, 0], B: [0.01, 0, 0, 0, 0, 0] }, reactions: {}, members: [] };
    const s = deformedMember(col, res, "E2", 100, frame);
    const tip = s?.points[s.points.length - 1];
    expect(tip?.x).toBeCloseTo(worldToScreen(frame, 0, 2).x + 0.01 * 100 * 100, 6);
    expect(tip?.y).toBeCloseTo(worldToScreen(frame, 0, 2).y, 6);
  });

  it("escala automática: el mayor desplazamiento se dibuja como el 8 % de la dimensión del modelo", () => {
    // Modelo de 2 m; máx. 0.004 m -> factor = 0.08*2/0.004 = 40
    expect(maxDisplacement(resultE2)).toBeCloseTo(0.004, 12);
    expect(autoDeformScale(cantilever, resultE2)).toBeCloseTo(40, 9);
    expect(autoDeformScale(cantilever, { ...resultE2, displacements: {} })).toBe(1);
    expect(autoDeformScale(createEmptyProject(), resultE2)).toBeCloseTo((0.08 * 1) / 0.004, 9);
  });

  it("máximo también sobre `deflections`", () => {
    const r: SolveResult = { ...resultE2, deflections: { E2: [{ x: 0, d: [0, 0, 0] }, { x: 2, d: [0, 0, -0.5] }] } };
    expect(maxDisplacement(r)).toBeCloseTo(0.5, 12);
  });

  it("sin desplazamientos nodales ni deflections no hay deformada", () => {
    expect(deformedMember(cantilever, { ...resultE2, displacements: {} }, "E2", 1, frame)).toBeNull();
    expect(deformedMember(cantilever, resultE2, "NOPE", 1, frame)).toBeNull();
  });
});

describe("reacciones", () => {
  it("E1: dos flechas verticales hacia arriba de 30 kN, con la cola por debajo del apoyo", () => {
    const gl = reactionGlyphs(beamE1Project(), solveE1(), frame);
    expect(gl.map((g) => g.node).sort()).toEqual(["A", "B"]);
    for (const g of gl) {
      expect(g.label.text).toBe("Rz=30 kN");
      expect(g.arc).toBeNull();
      expect((g.arrow?.tail.y ?? 0) > (g.arrow?.head.y ?? 0)).toBe(true); // apunta hacia arriba
      expect(g.arrow?.head.y).toBeCloseTo(origin.y + 18, 9); // separada del símbolo de apoyo
    }
  });

  it("el empotramiento del voladizo E2 muestra Rz=15 kN y My=-30 kN·m (antihorario)", () => {
    const res: SolveResult = { status: "ok", displacements: {}, reactions: { A: [0, 0, 15, 0, -30, 0] }, members: [] };
    const proj: Project = { ...beamE1Project(), supports: [] };
    const [g] = reactionGlyphs(proj, res, frame);
    expect(g?.label.text).toBe("Rz=15 kN | My=-30 kN·m");
    expect(g?.arc?.clockwise).toBe(false);
  });

  it("reacciones nulas o de nudos inexistentes no se dibujan", () => {
    const res: SolveResult = { status: "ok", displacements: {}, reactions: { A: [0, 0, 0, 0, 0, 0], ZZ: [0, 0, 5, 0, 0, 0] }, members: [] };
    expect(reactionGlyphs(beamE1Project(), res, frame)).toEqual([]);
  });

  it("reacción horizontal: flecha horizontal con etiqueta Rx", () => {
    const res: SolveResult = { status: "ok", displacements: {}, reactions: { B: [-12, 0, 0, 0, 0, 0] }, members: [] };
    const [g] = reactionGlyphs(beamE1Project(), res, frame);
    expect(g?.label.text).toBe("Rx=-12 kN");
    expect((g?.arrow?.tail.x ?? 0) > (g?.arrow?.head.x ?? 0)).toBe(true); // empuja hacia -X: la cola queda a la derecha
  });
});

describe("símbolos de apoyo y articulaciones", () => {
  const at = { x: 100, y: 200 };
  const sup = (preset: keyof typeof SUPPORT_PRESETS) => ({ id: "S", node: "A", fixed: SUPPORT_PRESETS[preset] });

  it("el apoyo articulado es un triángulo con el vértice en el nudo y la base debajo", () => {
    const s = supportShape(sup("pinned"), at, { x: 0, y: 1 });
    expect(s.paths[0]).toBe("M 100 200 L 110 213 L 90 213 Z");
    expect(s.title).toMatch(/articulado/);
  });

  it("el móvil lleva dos rodillos; el empotramiento una pared con rayado; uno desconocido, un cuadrado", () => {
    expect(supportShape(sup("roller-x"), at, { x: 0, y: 1 }).circles).toHaveLength(2);
    const fixed = supportShape(sup("fixed"), at, { x: -1, y: 0 });
    expect(fixed.paths.length).toBeGreaterThan(5);
    expect(fixed.title).toBe("empotramiento");
    const custom = supportShape({ id: "S", node: "A", fixed: [false, false, false, true, false, false] }, at, { x: 0, y: 1 });
    expect(custom.title).toBe("apoyo personalizado");
  });

  it("dirección del apoyo: articulado hacia abajo; empotramiento en el extremo izquierdo de una viga, hacia la izquierda", () => {
    const project = beamE1Project();
    expect(supportOutward(project, frame, "A", sup("pinned"))).toEqual({ x: 0, y: 1 });
    expect(supportOutward(project, frame, "A", sup("fixed"))).toEqual({ x: -1, y: 0 });
    expect(supportOutward(project, frame, "B", sup("fixed"))).toEqual({ x: 1, y: 0 });
    const col: Project = { ...project, nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 0, y: 0, z: 3 }] };
    expect(supportOutward(col, frame, "B", sup("roller-z"))).toEqual({ x: 0, y: -1 }); // pilar por debajo: sale hacia arriba
    expect(supportOutward({ ...project, members: [] }, frame, "A", sup("fixed"))).toEqual({ x: -1, y: 0 });
    expect(supportOutward(project, frame, "ZZ", sup("fixed"))).toEqual({ x: -1, y: 0 });
  });

  it("marcas de articulación: círculo para ry liberado, cuadrado para traslaciones, nada sin releases", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const base = { id: "M", i: "A", j: "B", material: "MAT1", section: "SEC1" };
    expect(releaseMarks(base, a, b)).toEqual([]);
    const marks = releaseMarks({ ...base, releases: { i: { ry: true }, j: { ux: true } } }, a, b);
    expect(marks.map((m) => `${m.end}:${m.kind}`)).toEqual(["i:rotation", "j:translation"]);
    expect(marks[0]?.at).toEqual({ x: 11, y: 0 });
    expect(marks[1]?.at).toEqual({ x: 89, y: 0 });
    expect(releaseMarks({ ...base, releases: { i: { ry: true } } }, a, a)).toEqual([]);
    expect(releaseMarks({ ...base, releases: { i: { ry: false, rz: true } } }, a, b)).toEqual([]);
  });
});
