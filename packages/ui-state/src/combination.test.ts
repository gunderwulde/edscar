import { describe, expect, it } from "vitest";
import { addCaseCommand, addPatternCommand, createEmptyProject, nextId } from "./builders";
import { applyCommand, commandLabel, type Command } from "./commands";

function base() {
  let p = createEmptyProject();
  for (const c of [
    addPatternCommand(p, { name: "G", kind: "D" }),
  ]) {
    const r = applyCommand(p, c);
    if (!r.ok) throw new Error("base");
    p = r.project;
  }
  const rc = applyCommand(p, addCaseCommand(p, { name: "CG", terms: [{ pattern: "P1", factor: 1 }] }));
  if (!rc.ok) throw new Error("base case");
  return rc.project;
}

describe("combinaciones como entidad de comandos", () => {
  it("añade, edita y borra una combinación con inverso exacto", () => {
    const p0 = base();
    const id = nextId(p0, "combination");
    expect(id).toBe("U1");
    const add: Command = {
      type: "combination.add",
      payload: { item: { id, name: "ELU", kind: "ULS", terms: [{ ref: "C1", refType: "case", factor: 1.35 }] } },
    };
    const a = applyCommand(p0, add);
    if (!a.ok) throw new Error("add");
    expect(a.project.combinations).toHaveLength(1);

    const upd = applyCommand(a.project, { type: "combination.update", payload: { id, patch: { name: "ELU 2" } } });
    if (!upd.ok) throw new Error("update");
    expect(upd.project.combinations[0]?.name).toBe("ELU 2");
    const back = applyCommand(upd.project, upd.inverse);
    if (!back.ok) throw new Error("inverse");
    expect(back.project.combinations[0]?.name).toBe("ELU");

    const rem = applyCommand(upd.project, { type: "combination.remove", payload: { id } });
    if (!rem.ok) throw new Error("remove");
    expect(rem.project.combinations).toHaveLength(0);
    const restored = applyCommand(rem.project, rem.inverse);
    if (!restored.ok) throw new Error("restore");
    expect(restored.project.combinations[0]?.name).toBe("ELU 2");
  });

  it("rechaza una combinación que cita un caso inexistente y etiqueta los comandos", () => {
    const p0 = base();
    const r = applyCommand(p0, {
      type: "combination.add",
      payload: { item: { id: "U1", name: "x", kind: "ULS", terms: [{ ref: "NOPE", refType: "case", factor: 1 }] } },
    });
    expect(r.ok).toBe(false);
    expect(commandLabel({ type: "combination.add", payload: { item: { id: "U1", name: "x", kind: "ULS", terms: [] } } })).toBe("Crear combinación");
    expect(commandLabel({ type: "combination.remove", payload: { id: "U1" } })).toBe("Borrar combinación");
  });
});
