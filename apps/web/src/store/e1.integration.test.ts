// Integración extremo a extremo (sin DOM): comandos de ui-state -> proyecto validado -> cliente del Worker ->
// handler con el solver real, ida y vuelta por MessageChannel -> store. Valores esperados: ADR-001, ejemplo E1
// (viga biapoyada de 6 m, w = 10 kN/m): reacciones 30/30 kN y M(3) = wL²/8 = 45 kN·m (presentación M = -My).
import { afterEach, describe, expect, it } from "vitest";
import {
  addCaseCommand, addLoadCommand, addMemberCommand, addNodeCommand, addPatternCommand, createEditorStore,
  presentedValue, setSupportCommand, uniformLoad, visibleResult, type Command, type EditorStore,
} from "@edscar/ui-state";
import { createSolverClient } from "../worker/client";
import { attachSolverWorker } from "../worker/handler";
import { createSolveController } from "./solveController";

const opened: MessageChannel[] = [];
afterEach(() => {
  for (const ch of opened.splice(0)) {
    ch.port1.close();
    ch.port2.close();
  }
});

function workerClient() {
  const ch = new MessageChannel();
  opened.push(ch);
  attachSolverWorker(ch.port1);
  return createSolverClient(ch.port2);
}

/** Crea la viga E1 dibujándola como lo haría el usuario: un comando tras otro, cada uno validado. */
function buildBeam(store: EditorStore): void {
  const run = (build: (s: EditorStore) => Command): void => {
    const r = store.dispatch(build(store));
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  };
  // Material y sección del proyecto nuevo, ajustados a EI = 20000 kN·m² (E = 2e8 kN/m², I = 1e-4 m⁴).
  run(() => ({ type: "material.update", payload: { id: "MAT1", patch: { E: 2e8, G: 8e7, density: 0 } } }));
  run(() => ({ type: "section.update", payload: { id: "SEC1", patch: { A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 1e-5 } } }));
  run((s) => addNodeCommand(s.getState().project, 0, 0));
  run((s) => addNodeCommand(s.getState().project, 6, 0));
  run((s) => addMemberCommand(s.getState().project, "N1", "N2"));
  run((s) => setSupportCommand(s.getState().project, "N1", "pinned"));
  run((s) => setSupportCommand(s.getState().project, "N2", "roller-x"));
  run((s) => addPatternCommand(s.getState().project, { name: "Permanente", kind: "D" }));
  run((s) => addLoadCommand(s.getState().project, uniformLoad("P1", "B1", [0, 0, -10])));
  run((s) => addCaseCommand(s.getState().project, { name: "G", terms: [{ pattern: "P1", factor: 1 }] }));
}

describe("E1 de extremo a extremo", () => {
  it("dibujar con comandos, resolver en el Worker y leer reacciones 30/30 kN y M(3) = 45 kN·m", async () => {
    const store = createEditorStore({ storage: null });
    buildBeam(store);
    expect(store.getState().history.undoCount).toBe(10);
    expect(store.getState().results.caseId).toBe("C1");

    const client = workerClient();
    const controller = createSolveController(store, client, { auto: false });
    await controller.solveNow();

    const st = store.getState();
    expect(st.solver).toMatchObject({ phase: "done", ok: true, status: "ok" });
    const shown = visibleResult(st);
    expect(shown?.stale).toBe(false);
    const result = shown?.result;
    expect(result?.status).toBe("ok");
    expect(result?.reactions["N1"]?.[2]).toBeCloseTo(30, 6);
    expect(result?.reactions["N2"]?.[2]).toBeCloseTo(30, 6);

    const stations = result?.members.find((m) => m.member === "B1")?.stations ?? [];
    const mid = stations.find((s) => Math.abs(s.x - 3) < 1e-9);
    expect(mid).toBeDefined();
    if (mid) expect(presentedValue("M", mid)).toBeCloseTo(45, 6);
    const first = stations[0];
    if (first) expect(presentedValue("V", first)).toBeCloseTo(30, 6); // V(0+) = +30 kN (ADR-001)

    // Editar el modelo deja el resultado obsoleto, y deshacer + recalcular vuelve a dar lo mismo.
    store.dispatch({ type: "load.update", payload: { id: "L1", patch: { w: [0, 0, -20] } } });
    expect(visibleResult(store.getState())?.stale).toBe(true);
    await controller.solveNow();
    expect(visibleResult(store.getState())?.result.reactions["N1"]?.[2]).toBeCloseTo(60, 6);
    store.undo();
    await controller.solveNow();
    expect(visibleResult(store.getState())?.result.reactions["N1"]?.[2]).toBeCloseTo(30, 6);
    controller.dispose();
    client.dispose();
  });

  it("quitar un apoyo da un mecanismo: el Worker devuelve un estado sin resultados y el mensaje queda visible", async () => {
    const store = createEditorStore({ storage: null });
    buildBeam(store);
    store.dispatch({ type: "support.remove", payload: { id: "R2" } });
    const client = workerClient();
    const controller = createSolveController(store, client, { auto: false });
    await controller.solveNow();
    expect(store.getState().solver.ok).toBe(false);
    expect(store.getState().solver.status).toBe("singular");
    expect((store.getState().solver.message ?? "").length).toBeGreaterThan(0);
    controller.dispose();
    client.dispose();
  });
});
