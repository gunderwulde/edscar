import { afterEach, describe, expect, it, vi } from "vitest";
import type { SolveRequest, SolveResult } from "@edscar/solver";
import { addNodeCommand, beamE1Project, createEditorStore, createEmptyProject, visibleResult } from "@edscar/ui-state";
import type { SolverClient } from "../worker/client";
import { createSolveController } from "./solveController";

afterEach(() => {
  vi.useRealTimers();
});

const ok = (tag = ""): SolveResult => ({ status: "ok", message: tag, displacements: {}, reactions: {}, members: [] });

/** Cliente falso: cada `solve` queda pendiente hasta que el test lo resuelva. */
function fakeClient(): SolverClient & {
  calls: SolveRequest[];
  resolveAt(k: number, r: SolveResult): void;
  rejectAt(k: number, e: Error): void;
} {
  const calls: SolveRequest[] = [];
  const settlers: { resolve: (r: SolveResult) => void; reject: (e: Error) => void }[] = [];
  return {
    calls,
    ping: () => Promise.resolve(1),
    solve: (req) =>
      new Promise((resolve, reject) => {
        calls.push(req);
        settlers.push({ resolve, reject });
      }),
    dispose: () => undefined,
    resolveAt: (k, r) => settlers[k]?.resolve(r),
    rejectAt: (k, e) => settlers[k]?.reject(e),
  };
}

const flush = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};

describe("controlador del solver", () => {
  it("debounce: varios cambios seguidos lanzan un solo cálculo con el último proyecto", async () => {
    vi.useFakeTimers();
    const store = createEditorStore({ project: beamE1Project(), storage: null });
    const client = fakeClient();
    const c = createSolveController(store, client, { debounceMs: 200 });
    c.start();
    vi.advanceTimersByTime(199);
    expect(client.calls).toHaveLength(0);
    store.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } });
    vi.advanceTimersByTime(150);
    store.dispatch({ type: "node.move", payload: { id: "B", x: 8, z: 0 } });
    vi.advanceTimersByTime(199);
    expect(client.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.caseId).toBe("C1");
    expect(client.calls[0]?.project.nodes.find((n) => n.id === "B")?.x).toBe(8);
    expect(store.getState().solver.phase).toBe("solving");
    client.resolveAt(0, ok("listo"));
    await flush();
    expect(store.getState().solver).toEqual({ phase: "done", ok: true, status: "ok", message: "listo" });
    expect(visibleResult(store.getState())?.stale).toBe(false);
    c.dispose();
  });

  it("cancelación: la respuesta de una petición superada por otra posterior se descarta", async () => {
    vi.useFakeTimers();
    const store = createEditorStore({ project: beamE1Project(), storage: null });
    const client = fakeClient();
    const c = createSolveController(store, client, { debounceMs: 10 });
    c.start();
    vi.advanceTimersByTime(10);
    expect(client.calls).toHaveLength(1);
    store.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } }); // supera la petición 0
    vi.advanceTimersByTime(10);
    expect(client.calls).toHaveLength(2);
    client.resolveAt(0, ok("vieja")); // llega tarde
    await flush();
    expect(store.getState().results.result).toBeNull();
    expect(store.getState().solver.phase).toBe("solving");
    client.resolveAt(1, ok("nueva"));
    await flush();
    expect(store.getState().results.result?.message).toBe("nueva");
    c.dispose();
  });

  it("cancel(): descarta la respuesta en curso y devuelve el solver a reposo", async () => {
    vi.useFakeTimers();
    const store = createEditorStore({ project: beamE1Project(), storage: null });
    const client = fakeClient();
    const c = createSolveController(store, client, { debounceMs: 10 });
    const p = c.solveNow();
    expect(store.getState().solver.phase).toBe("solving");
    c.cancel();
    expect(store.getState().solver.phase).toBe("idle");
    client.resolveAt(0, ok());
    await p;
    expect(store.getState().results.result).toBeNull();
    c.dispose();
  });

  it("un fallo del canal pone el solver en error con el mensaje; la siguiente petición lo recupera", async () => {
    const store = createEditorStore({ project: beamE1Project(), storage: null });
    const client = fakeClient();
    const c = createSolveController(store, client, { auto: false });
    const p = c.solveNow();
    client.rejectAt(0, new Error("Worker caído"));
    await p;
    expect(store.getState().solver).toEqual({ phase: "failed", ok: false, status: null, message: "Worker caído" });
    const p2 = c.solveNow();
    client.rejectAt(1, "texto" as unknown as Error);
    await p2;
    expect(store.getState().solver.message).toBe("texto");
    const p3 = c.solveNow();
    client.resolveAt(2, { ...ok(), status: "singular", message: "mecanismo" });
    await p3;
    expect(store.getState().solver).toMatchObject({ phase: "done", ok: false, status: "singular", message: "mecanismo" });
  });

  it("sin caso: el cálculo explícito avisa; el automático queda en silencio", async () => {
    vi.useFakeTimers();
    const store = createEditorStore({ project: createEmptyProject(), storage: null });
    const client = fakeClient();
    const c = createSolveController(store, client, { debounceMs: 10 });
    c.start();
    store.dispatch(addNodeCommand(store.getState().project, 0, 0));
    vi.advanceTimersByTime(20);
    expect(client.calls).toHaveLength(0);
    expect(store.getState().solver.phase).toBe("idle");
    await c.solveNow();
    expect(store.getState().solver.phase).toBe("failed");
    expect(store.getState().solver.message).toMatch(/caso de carga/);
    c.dispose();
  });

  it("cambiar el caso mostrado recalcula; con auto desactivado no calcula solo", () => {
    vi.useFakeTimers();
    const store = createEditorStore({ project: beamE1Project(), storage: null });
    store.dispatch({ type: "case.add", payload: { item: { id: "C2", name: "otro", type: "static-linear", terms: [{ pattern: "G", factor: 2 }] } } });
    const client = fakeClient();
    const c = createSolveController(store, client, { debounceMs: 10 });
    c.start();
    c.start(); // idempotente
    vi.advanceTimersByTime(10);
    expect(client.calls).toHaveLength(1);
    store.setResultCase("C2");
    vi.advanceTimersByTime(10);
    expect(client.calls.map((r) => r.caseId)).toEqual(["C1", "C2"]);
    store.setTool("node"); // no cambia revisión ni caso: sin cálculo
    vi.advanceTimersByTime(50);
    expect(client.calls).toHaveLength(2);
    c.setAuto(false);
    store.dispatch({ type: "node.move", payload: { id: "B", x: 7, z: 0 } });
    vi.advanceTimersByTime(50);
    expect(client.calls).toHaveLength(2);
    c.setAuto(true);
    c.schedule();
    vi.advanceTimersByTime(10);
    expect(client.calls).toHaveLength(3);
    c.dispose();
    store.dispatch({ type: "node.move", payload: { id: "B", x: 8, z: 0 } });
    vi.advanceTimersByTime(50);
    expect(client.calls).toHaveLength(3);
  });
});
