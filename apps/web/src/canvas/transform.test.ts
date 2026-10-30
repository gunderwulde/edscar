import { describe, expect, it } from "vitest";
import type { Project } from "@edscar/model";
import { createEmptyProject } from "@edscar/ui-state";
import {
  boxSelect, distToSegment, hitMember, hitNode, snapPoint,
} from "./hit";
import {
  fitView, gridStep, modelBounds, panBy, screenToWorld, snapToGrid, worldToScreen, zoomAt, type Frame,
} from "./transform";

// Lienzo 800 x 600, centro del modelo (3; 1.5) m, 100 px/m.
const frame: Frame = { view: { cx: 3, cz: 1.5, zoom: 100 }, vp: { width: 800, height: 600 } };

describe("mundo <-> pantalla (Z arriba)", () => {
  it("el centro del modelo cae en el centro del lienzo", () => {
    expect(worldToScreen(frame, 3, 1.5)).toEqual({ x: 400, y: 300 });
  });

  it("+1 m en X son +100 px a la derecha; +1 m en Z son 100 px HACIA ARRIBA (y disminuye)", () => {
    expect(worldToScreen(frame, 4, 1.5)).toEqual({ x: 500, y: 300 });
    expect(worldToScreen(frame, 3, 2.5)).toEqual({ x: 400, y: 200 });
    expect(worldToScreen(frame, 0, 0)).toEqual({ x: 100, y: 450 });
  });

  it("screenToWorld es la inversa de worldToScreen", () => {
    for (const [x, z] of [[0, 0], [6, 0], [-2.5, 7.25], [1e3, -1e3]] as const) {
      const p = worldToScreen(frame, x, z);
      const w = screenToWorld(frame, p);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.z).toBeCloseTo(z, 9);
    }
  });
});

describe("zoom y pan", () => {
  it("el zoom con la rueda deja fijo el punto del modelo bajo el cursor", () => {
    const at = { x: 650, y: 120 };
    const before = screenToWorld(frame, at);
    const view = zoomAt(frame, at, 2);
    expect(view.zoom).toBe(200);
    const after = screenToWorld({ ...frame, view }, at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it("el zoom se limita a [MIN, MAX]", () => {
    expect(zoomAt(frame, { x: 0, y: 0 }, 1e12).zoom).toBe(20000);
    expect(zoomAt(frame, { x: 0, y: 0 }, 1e-12).zoom).toBe(0.5);
  });

  it("arrastrar el contenido 100 px a la derecha y 50 abajo mueve el centro -1 m en X y +0.5 m en Z", () => {
    const v = panBy(frame.view, 100, 50);
    expect(v.cx).toBeCloseTo(2, 12);
    expect(v.cz).toBeCloseTo(2, 12);
  });

  it("encuadra una viga de 6 m en 800 px con margen de 80 px: zoom = 640 / 6 limitado a 200", () => {
    const b = { minX: 0, maxX: 6, minZ: 0, maxZ: 0 };
    const v = fitView(b, frame.vp);
    expect(v.cx).toBe(3);
    expect(v.cz).toBe(0);
    expect(v.zoom).toBeCloseTo(Math.min(640 / 6, 200), 9);
    expect(fitView({ minX: 0, maxX: 600, minZ: 0, maxZ: 300 }, frame.vp).zoom).toBeCloseTo(640 / 600, 9);
    expect(fitView(null, frame.vp).zoom).toBe(60);
    expect(fitView({ minX: 1, maxX: 1, minZ: 1, maxZ: 1 }, frame.vp).zoom).toBe(200); // un solo nudo
  });

  it("límites del modelo", () => {
    expect(modelBounds({ nodes: [] })).toBeNull();
    expect(modelBounds({ nodes: [{ id: "a", x: -1, y: 0, z: 2 }, { id: "b", x: 5, y: 0, z: -3 }] })).toEqual({
      minX: -1, maxX: 5, minZ: -3, maxZ: 2,
    });
  });
});

describe("rejilla", () => {
  it("el paso es de la serie 1-2-5 y deja >= 24 px entre líneas", () => {
    expect(gridStep(100)).toBe(0.5); // 0.24 m mínimo -> 0.5 m (50 px)
    expect(gridStep(60)).toBe(0.5); // 0.4 m -> 0.5 m
    expect(gridStep(10)).toBe(5); // 2.4 m -> 5 m
    expect(gridStep(1000)).toBe(0.05); // 0.024 m -> 0.05 m
    expect(gridStep(1)).toBe(50);
    for (const z of [0.7, 3, 17, 60, 250, 9000]) expect(gridStep(z) * z).toBeGreaterThanOrEqual(24 - 1e-9);
  });

  it("snapToGrid redondea al múltiplo más cercano sin -0 ni ruido binario", () => {
    expect(snapToGrid(2.76, 0.5)).toBe(3);
    expect(snapToGrid(2.7, 0.5)).toBe(2.5);
    expect(snapToGrid(-0.1, 0.5)).toBe(0);
    expect(Object.is(snapToGrid(-0.1, 0.5), -0)).toBe(false);
    expect(snapToGrid(0.30000000000000004, 0.1)).toBe(0.3);
  });
});

describe("hit-testing", () => {
  const project: Project = {
    ...createEmptyProject(),
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "B", x: 6, y: 0, z: 0 },
      { id: "C", x: 6, y: 0, z: 3 },
    ],
    members: [
      { id: "M1", i: "A", j: "B", material: "MAT1", section: "SEC1" },
      { id: "M2", i: "B", j: "C", material: "MAT1", section: "SEC1" },
    ],
  };
  const A = worldToScreen(frame, 0, 0);
  const B = worldToScreen(frame, 6, 0);

  it("distancia punto-segmento", () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5); // más allá del extremo
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5); // segmento degenerado
  });

  it("selecciona el nudo dentro de la tolerancia y el más cercano", () => {
    expect(hitNode(project, frame, { x: A.x + 5, y: A.y - 5 })).toBe("A"); // 7.07 px < 9
    expect(hitNode(project, frame, { x: A.x + 10, y: A.y })).toBeNull();
    expect(hitNode(project, frame, A, 9, new Set(["A"]))).toBeNull();
  });

  it("selecciona la barra por distancia al segmento (6 px)", () => {
    expect(hitMember(project, frame, { x: (A.x + B.x) / 2, y: A.y + 5 })).toBe("M1");
    expect(hitMember(project, frame, { x: (A.x + B.x) / 2, y: A.y + 7 })).toBeNull();
    expect(hitMember(project, frame, { x: B.x + 4, y: (A.y + worldToScreen(frame, 6, 3).y) / 2 })).toBe("M2");
  });

  it("caja: nudos dentro y barras con ambos extremos dentro, en cualquier orden de esquinas", () => {
    const sel = boxSelect(project, frame, { x: B.x + 10, y: A.y + 10 }, { x: A.x - 10, y: A.y - 10 });
    expect(sel.nodes.sort()).toEqual(["A", "B"]);
    expect(sel.members).toEqual(["M1"]);
    const all = boxSelect(project, frame, { x: 0, y: 0 }, { x: 800, y: 600 });
    expect(all.members).toEqual(["M1", "M2"]);
  });

  it("captura: nudo > rejilla > libre", () => {
    const near = snapPoint(project, frame, { x: B.x + 3, y: B.y - 3 }, { grid: true });
    expect(near).toEqual({ x: 6, z: 0, kind: "node", nodeId: "B" });
    // A 100 px/m el paso de rejilla es 0.5 m: 3.26 m -> 3.5 m
    const p = worldToScreen(frame, 3.26, 1.1);
    const grid = snapPoint(project, frame, p, { grid: true });
    expect(grid).toMatchObject({ x: 3.5, z: 1, kind: "grid", nodeId: null });
    const free = snapPoint(project, frame, p, { grid: false });
    expect(free.kind).toBe("free");
    expect(free.x).toBeCloseTo(3.26, 9);
    expect(snapPoint(project, frame, B, { grid: true, exclude: new Set(["B"]) }).kind).toBe("grid");
  });
});
