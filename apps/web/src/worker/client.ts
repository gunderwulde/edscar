/** Lado hilo principal del protocolo: API con promesas sobre un extremo de mensajes. */
import type { SolveRequest, SolveResult } from "@edscar/solver";
import type { MessageEndpoint, SolverWorkerRequest, SolverWorkerResponse } from "./protocol";

export interface SolverClient {
  /** Comprueba que el Worker responde; devuelve su versión de protocolo. */
  ping(): Promise<number>;
  /** Resuelve un caso. Los errores del modelo llegan en `result.status`; la promesa solo se rechaza por fallos del canal. */
  solve(request: SolveRequest): Promise<SolveResult>;
  /** Rechaza las peticiones pendientes y deja de escuchar. */
  dispose(): void;
}

interface Pending {
  expect: SolverWorkerResponse["kind"];
  resolve: (r: SolverWorkerResponse) => void;
  reject: (e: Error) => void;
}

export function createSolverClient(
  endpoint: MessageEndpoint<SolverWorkerResponse, SolverWorkerRequest>,
  onDispose?: () => void,
): SolverClient {
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, Pending>();

  endpoint.onmessage = (event) => {
    const res = event.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.kind === "error") p.reject(new Error(res.message));
    else if (res.kind !== p.expect) p.reject(new Error(`Respuesta inesperada del Worker: ${res.kind}`));
    else p.resolve(res);
  };

  const send = (req: SolverWorkerRequest, expect: Pending["expect"]): Promise<SolverWorkerResponse> => {
    if (disposed) return Promise.reject(new Error("Cliente del solver cerrado"));
    return new Promise((resolve, reject) => {
      pending.set(req.id, { expect, resolve, reject });
      endpoint.postMessage(req);
    });
  };

  return {
    async ping() {
      const r = await send({ id: nextId++, kind: "ping" }, "pong");
      return r.kind === "pong" ? r.protocolVersion : Number.NaN;
    },
    async solve(request) {
      const r = await send({ id: nextId++, kind: "solve", request }, "solved");
      if (r.kind !== "solved") throw new Error("Respuesta inesperada del Worker");
      return r.result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      endpoint.onmessage = null;
      for (const p of pending.values()) p.reject(new Error("Cliente del solver cerrado"));
      pending.clear();
      onDispose?.();
    },
  };
}

/** Cliente sobre un Web Worker real (módulo ES); `dispose` termina el Worker. */
export function createBrowserSolverClient(): SolverClient {
  const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module", name: "edscar-solver" });
  return createSolverClient(worker, () => {
    worker.terminate();
  });
}
