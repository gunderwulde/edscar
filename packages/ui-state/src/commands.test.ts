import { describe, expect, it } from "vitest";
import type { Project } from "@edscar/model";
import {
  addCaseCommand, addLoadCommand, addMemberCommand, addNodeCommand, addPatternCommand, applyCommand,
  assignPropertiesCommand, beamE1Commands, beamE1Project, classifySupport, combine, commandLabel,
  createEmptyProject, deleteSelectionCommand, nextId, setSupportCommand, SUPPORT_PRESETS, uniformLoad,
  type Command,
} from "./index";

/** Aplica y exige éxito. */
function ok(p: Project, c: Command): { project: Project; inverse: Command } {
  const r = applyCommand(p, c);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
  return r;
}

describe("comandos básicos", () => {
  it("añade un nudo en el plano X-Z (y = 0) y el inverso lo quita", () => {
    const p0 = createEmptyProject();
    const { project, inverse } = ok(p0, addNodeCommand(p0, 2.5, 1));
    expect(project.nodes).toEqual([{ id: "N1", x: 2.5, y: 0, z: 1 }]);
    expect(ok(project, inverse).project).toEqual(p0);
  });

  it("no muta el proyecto de entrada y comparte estructura de lo no tocado", () => {
    const p0 = beamE1Project();
    const before = structuredClone(p0);
    const r = ok(p0, { type: "node.move", payload: { id: "B", x: 8, z: 0 } });
    expect(p0).toEqual(before);
    expect(r.project.members).toBe(p0.members);
  });

  it("mover un nudo cambia x y z, deja y, y su inverso devuelve la posición anterior", () => {
    const p0 = beamE1Project();
    const { project, inverse } = ok(p0, { type: "node.move", payload: { id: "B", x: 8, z: 0 } });
    expect(project.nodes.find((n) => n.id === "B")).toEqual({ id: "B", x: 8, y: 0, z: 0 });
    expect(inverse).toEqual({ type: "node.move", payload: { id: "B", x: 6, z: 0 } });
  });

  it("rechaza mover un nudo a coordenadas no finitas o inexistente", () => {
    const p0 = beamE1Project();
    expect(applyCommand(p0, { type: "node.move", payload: { id: "B", x: NaN, z: 0 } }).ok).toBe(false);
    const r = applyCommand(p0, { type: "node.move", payload: { id: "ZZ", x: 1, z: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("not-found");
  });

  it("rechaza id duplicado, id vacío y comandos desconocidos", () => {
    const p0 = beamE1Project();
    const dup = applyCommand(p0, addNodeCommand(p0, 1, 0, "A"));
    expect(dup.ok ? "" : dup.errors[0]?.code).toBe("duplicate-id");
    const empty = applyCommand(p0, { type: "node.add", payload: { item: { id: "", x: 0, y: 0, z: 0 } } });
    expect(empty.ok).toBe(false);
    const unknown = applyCommand(p0, { type: "wall.add", payload: {} } as unknown as Command);
    expect(unknown.ok ? "" : unknown.errors[0]?.code).toBe("bad-command");
    const noOp = applyCommand(p0, { type: "node.explode", payload: {} } as unknown as Command);
    expect(noOp.ok).toBe(false);
    const malformed = applyCommand(p0, { type: "node.add", payload: null } as unknown as Command);
    expect(malformed.ok).toBe(false);
  });

  it("rechaza leaving 2D: un nudo con y distinto de 0 en 2D-XZ", () => {
    const p0 = createEmptyProject();
    const r = applyCommand(p0, { type: "node.add", payload: { item: { id: "N1", x: 0, y: 1, z: 0 } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "2d-out-of-plane")).toBe(true);
  });

  it("añadir con índice restaura la posición original", () => {
    let p = createEmptyProject();
    for (const id of ["a", "b", "c"]) p = ok(p, { type: "node.add", payload: { item: { id, x: 0, y: 0, z: 0 } } }).project;
    const r = ok(p, { type: "node.add", payload: { item: { id: "x", x: 1, y: 0, z: 0 }, index: 1 } });
    expect(r.project.nodes.map((n) => n.id)).toEqual(["a", "x", "b", "c"]);
    const far = ok(p, { type: "node.add", payload: { item: { id: "y", x: 1, y: 0, z: 0 }, index: 99 } });
    expect(far.project.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "y"]);
  });
});

describe("rechazo por validación", () => {
  it("una barra con material inexistente se rechaza y el proyecto no cambia", () => {
    const p0 = beamE1Project();
    const r = applyCommand(p0, addMemberCommand(p0, "A", "B", { material: "NOPE" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "dangling-ref")).toBe(true);
    expect(p0.members).toHaveLength(1);
  });

  it("acortar la barra por debajo del extremo b de una carga parcial se rechaza", () => {
    // Carga trapezoidal en [1, 5] sobre una barra de 6 m; mover B a x = 4 deja L = 4 < b = 5.
    const p0 = beamE1Project();
    const withTrap = ok(
      p0,
      addLoadCommand(p0, {
        type: "member-trapezoid", pattern: "G", member: "E1", w1: [0, 0, -2], w2: [0, 0, -6], frame: "global", a: 1, b: 5,
      }),
    ).project;
    const r = applyCommand(withTrap, { type: "node.move", payload: { id: "B", x: 4, z: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "load-range")).toBe(true);
    // Mover a x = 5 (L = 5 = b) sí es válido.
    expect(applyCommand(withTrap, { type: "node.move", payload: { id: "B", x: 5, z: 0 } }).ok).toBe(true);
  });

  it("un batch es atómico: si un paso falla no se aplica ninguno", () => {
    const p0 = beamE1Project();
    const batch = combine([addNodeCommand(p0, 1, 0, "N9"), addNodeCommand(p0, 2, 0, "A")]);
    expect(applyCommand(p0, batch).ok).toBe(false);
  });

  it("no se puede borrar un material en uso (referencia colgante)", () => {
    const p0 = beamE1Project();
    expect(applyCommand(p0, { type: "material.remove", payload: { id: "MAT1" } }).ok).toBe(false);
    expect(applyCommand(p0, { type: "section.remove", payload: { id: "SEC1" } }).ok).toBe(false);
  });
});

describe("borrado con cascada e inverso exacto", () => {
  it("borrar un nudo elimina sus barras, apoyo y cargas; deshacer lo restaura idéntico (orden incluido)", () => {
    const p0 = beamE1Project();
    const withNodal = ok(p0, addLoadCommand(p0, { type: "nodal", pattern: "G", node: "B", f: [0, 0, -5], m: [0, 0, 0] })).project;
    const r = ok(withNodal, { type: "node.remove", payload: { id: "A" } });
    expect(r.project.nodes.map((n) => n.id)).toEqual(["B"]);
    expect(r.project.members).toEqual([]);
    expect(r.project.supports.map((s) => s.id)).toEqual(["SB"]);
    expect(r.project.loads.map((l) => l.id)).toEqual(["L2"]); // L1 era de la barra E1
    expect(ok(r.project, r.inverse).project).toEqual(withNodal);
  });

  it("borrar una barra elimina sus cargas", () => {
    const p0 = beamE1Project();
    const r = ok(p0, { type: "member.remove", payload: { id: "E1" } });
    expect(r.project.loads).toEqual([]);
    expect(ok(r.project, r.inverse).project).toEqual(p0);
  });

  it("borrar un patrón elimina sus cargas y sus términos en los casos, y se restaura", () => {
    const p0 = beamE1Project();
    const r = ok(p0, { type: "pattern.remove", payload: { id: "G" } });
    expect(r.project.patterns).toEqual([]);
    expect(r.project.loads).toEqual([]);
    expect(r.project.cases[0]?.terms).toEqual([]);
    expect(ok(r.project, r.inverse).project).toEqual(p0);
  });

  it("borrar caso, material y sección sin uso se invierte exactamente", () => {
    let p = beamE1Project();
    p = ok(p, { type: "material.add", payload: { item: { id: "M2", name: "x", E: 1, G: 1, density: 0, alpha: 0 } } }).project;
    p = ok(p, { type: "section.add", payload: { item: { id: "S2", name: "x", A: 1, Iy: 1, Iz: 1, J: 0 } } }).project;
    for (const c of [
      { type: "material.remove", payload: { id: "M2" } },
      { type: "section.remove", payload: { id: "S2" } },
      { type: "case.remove", payload: { id: "C1" } },
      { type: "load.remove", payload: { id: "L1" } },
      { type: "support.remove", payload: { id: "SA" } },
    ] as Command[]) {
      const r = ok(p, c);
      expect(ok(r.project, r.inverse).project).toEqual(p);
    }
  });

  it("borra varios elementos intercalados y reconstruye el orden original", () => {
    let p = createEmptyProject();
    for (const id of ["a", "b", "c", "d", "e"]) p = ok(p, { type: "node.add", payload: { item: { id, x: 0, y: 0, z: 0 } } }).project;
    const batch = combine([
      { type: "node.remove", payload: { id: "b" } },
      { type: "node.remove", payload: { id: "d" } },
    ]);
    const r = ok(p, batch);
    expect(r.project.nodes.map((n) => n.id)).toEqual(["a", "c", "e"]);
    expect(ok(r.project, r.inverse).project.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("update", () => {
  it("asignar material y sección a varias barras; el inverso restaura", () => {
    let p = beamE1Project();
    p = ok(p, { type: "material.add", payload: { item: { id: "M2", name: "H", E: 3e7, G: 1.25e7, density: 2.5, alpha: 1e-5 } } }).project;
    p = ok(p, addNodeCommand(p, 3, 2, "C")).project;
    p = ok(p, addMemberCommand(p, "B", "C", { id: "E2" })).project;
    const r = ok(p, assignPropertiesCommand(["E1", "E2"], { material: "M2" }));
    expect(r.project.members.map((m) => m.material)).toEqual(["M2", "M2"]);
    expect(ok(r.project, r.inverse).project).toEqual(p);
  });

  it("assignPropertiesCommand admite solo sección", () => {
    const c = assignPropertiesCommand(["E1"], { section: "SEC1" });
    expect(c).toEqual({ type: "member.update", payload: { id: "E1", patch: { section: "SEC1" } } });
  });

  it("unset elimina una propiedad opcional y el inverso la devuelve; y viceversa", () => {
    const p0 = beamE1Project();
    const a = ok(p0, { type: "member.update", payload: { id: "E1", patch: { rotation: Math.PI } } });
    expect(a.project.members[0]?.rotation).toBe(Math.PI);
    expect(a.inverse).toEqual({ type: "member.update", payload: { id: "E1", patch: {}, unset: ["rotation"] } });
    const b = ok(a.project, { type: "member.update", payload: { id: "E1", patch: {}, unset: ["rotation"] } });
    expect(b.project).toEqual(p0);
    expect(ok(b.project, b.inverse).project).toEqual(a.project);
  });

  it("no permite cambiar el id ni claves peligrosas, y valida el resultado", () => {
    const p0 = beamE1Project();
    expect(applyCommand(p0, { type: "node.update", payload: { id: "A", patch: { id: "Z" } } }).ok).toBe(false);
    const bad = JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown>;
    expect(applyCommand(p0, { type: "node.update", payload: { id: "A", patch: bad } }).ok).toBe(false);
    expect(applyCommand(p0, { type: "node.update", payload: { id: "A", patch: { x: "texto" } } }).ok).toBe(false);
    expect(applyCommand(p0, { type: "node.update", payload: { id: "ZZ", patch: { x: 1 } } }).ok).toBe(false);
  });

  it("editar una carga (valor de la uniforme)", () => {
    const p0 = beamE1Project();
    const r = ok(p0, { type: "load.update", payload: { id: "L1", patch: { w: [0, 0, -20] } } });
    expect(r.project.loads[0]).toMatchObject({ w: [0, 0, -20] });
    expect(ok(r.project, r.inverse).project).toEqual(p0);
  });
});

describe("apoyos", () => {
  it("support.set sustituye el apoyo del nudo y el inverso lo restaura en su posición", () => {
    const p0 = beamE1Project();
    const r = ok(p0, setSupportCommand(p0, "A", "fixed"));
    expect(r.project.supports).toHaveLength(2);
    expect(r.project.supports[0]).toEqual({ id: "SA", node: "A", fixed: SUPPORT_PRESETS.fixed });
    expect(ok(r.project, r.inverse).project).toEqual(p0);
  });

  it("support.set en un nudo libre añade con id nuevo y el inverso lo quita", () => {
    let p = beamE1Project();
    p = ok(p, addNodeCommand(p, 3, 0, "M")).project;
    const r = ok(p, setSupportCommand(p, "M", "pinned"));
    expect(r.project.supports.at(-1)).toMatchObject({ id: "R3", node: "M" });
    expect(ok(r.project, r.inverse).project).toEqual(p);
  });

  it("support.set rechaza un id ya usado por otro nudo", () => {
    const p0 = beamE1Project();
    const r = applyCommand(p0, { type: "support.set", payload: { item: { id: "SA", node: "B", fixed: SUPPORT_PRESETS.pinned } } });
    expect(r.ok).toBe(false);
  });

  it("clasifica los apoyos habituales", () => {
    expect(classifySupport(SUPPORT_PRESETS.pinned)).toBe("pinned");
    expect(classifySupport(SUPPORT_PRESETS["roller-x"])).toBe("roller-x");
    expect(classifySupport(SUPPORT_PRESETS["roller-z"])).toBe("roller-z");
    expect(classifySupport(SUPPORT_PRESETS.fixed)).toBe("fixed");
    expect(classifySupport([false, true, false, true, false, false])).toBeNull();
  });
});

describe("serialización y utilidades", () => {
  it("los comandos sobreviven a JSON y reproducen el mismo proyecto", () => {
    let direct = createEmptyProject();
    let viaJson = createEmptyProject();
    for (const c of beamE1Commands()) {
      direct = ok(direct, c).project;
      viaJson = ok(viaJson, JSON.parse(JSON.stringify(c)) as Command).project;
    }
    expect(viaJson).toEqual(direct);
    expect(direct).toEqual(beamE1Project());
  });

  it("nextId evita ids existentes y reservados", () => {
    const p = beamE1Project();
    expect(nextId(p, "node")).toBe("N3");
    expect(nextId(p, "node", ["N3", "N4"])).toBe("N5");
    expect(nextId(createEmptyProject(), "load")).toBe("L1");
  });

  it("builders de patrón, caso y carga generan ids únicos", () => {
    let p = createEmptyProject();
    p = ok(p, addPatternCommand(p, { name: "Q", kind: "L" })).project;
    p = ok(p, addCaseCommand(p, { name: "c", terms: [{ pattern: "P1", factor: 1 }] })).project;
    expect(p.patterns[0]).toEqual({ id: "P1", name: "Q", kind: "L", selfWeightFactor: 0 });
    expect(p.cases[0]?.id).toBe("C1");
    expect(uniformLoad("P1", "B1", [0, 0, -1])).toMatchObject({ frame: "global" });
  });

  it("deleteSelectionCommand: null sin selección; un batch con cargas, barras y nudos", () => {
    expect(deleteSelectionCommand({ nodes: [], members: [], loads: [] })).toBeNull();
    const c = deleteSelectionCommand({ nodes: ["A"], members: ["E1"], loads: ["L1"] });
    expect(c?.type).toBe("batch");
    const p0 = beamE1Project();
    const r = ok(p0, c as Command);
    expect(r.project.nodes.map((n) => n.id)).toEqual(["B"]);
  });

  it("combine con un solo comando lo devuelve tal cual; commandLabel", () => {
    const c = addNodeCommand(createEmptyProject(), 0, 0);
    expect(combine([c])).toBe(c);
    expect(commandLabel(c)).toBe("Añadir nudo");
    expect(commandLabel(combine([c, c], "Dos"))).toBe("Dos");
    expect(commandLabel(combine([c, c]))).toBe("Varios cambios");
    expect(commandLabel({ type: "x.y", payload: {} } as unknown as Command)).toBe("x.y");
  });
});
