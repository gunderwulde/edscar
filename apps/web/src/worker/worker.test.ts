// Ida y vuelta real del protocolo del Worker sobre un MessageChannel (structured clone incluido).
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@edscar/model";
import type { Solver } from "@edscar/solver";
import { createSolverClient, type SolverClient } from "./client";
import { attachSolverWorker, handleSolverRequest } from "./handler";
import {
  SOLVER_PROTOCOL_VERSION,
  isSolverWorkerRequest,
  type MessageEndpoint,
  type SolverWorkerRequest,
  type SolverWorkerResponse,
} from "./protocol";

/** Viga biapoyada de 6 m con 10 kN/m hacia abajo (mismo modelo que el ejemplo de @edscar/model). */
const beam: Project = {
  schemaVersion: 1,
  units: "SI",
  analysis: "2D-XZ",
  nodes: [
    { id: "A", x: 0, y: 0, z: 0 },
    { id: "B", x: 6, y: 0, z: 0 },
  ],
  members: [{ id: "E1", i: "A", j: "B", material: "M1", section: "S1" }],
  materials: [{ id: "M1", name: "M", E: 2e8, G: 8e7, density: 0, alpha: 1.2e-5 }],
  sections: [{ id: "S1", name: "S", A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 1e-5 }],
  supports: [
    { id: "SA", node: "A", fixed: [true, true, true, false, false, false] },
    { id: "SB", node: "B", fixed: [false, true, true, false, false, false] },
  ],
  patterns: [{ id: "G", name: "G", kind: "D", selfWeightFactor: 0 }],
  loads: [{ id: "L1", pattern: "G", type: "member-uniform", member: "E1", w: [0, 0, -10], frame: "global" }],
  cases: [{ id: "C1", name: "C1", type: "static-linear", terms: [{ pattern: "G", factor: 1 }] }],
  combinations: [],
  settings: { gravity: [0, 0, -9.81] },
};

const opened: { port1: MessagePort; port2: MessagePort }[] = [];
function channel(solver?: Solver): { client: SolverClient; main: MessagePort } {
  const ch = new MessageChannel();
  opened.push(ch);
  attachSolverWorker(ch.port1, solver);
  const main = ch.port2;
  return { client: createSolverClient(main), main };
}

afterEach(() => {
  for (const ch of opened.splice(0)) {
    ch.port1.close();
    ch.port2.close();
  }
});

describe("protocolo del Worker del solver", () => {
  it("ping ⇒ pong con la versión de protocolo", async () => {
    const { client } = channel();
    await expect(client.ping()).resolves.toBe(SOLVER_PROTOCOL_VERSION);
  });

  it("solve ida y vuelta: reacciones wL/2 = 30 kN en la viga biapoyada", async () => {
    const { client } = channel();
    const r = await client.solve({ project: beam, caseId: "C1" });
    expect(r.status).toBe("ok");
    expect(r.reactions.A?.[2]).toBeCloseTo(30, 9);
    expect(r.reactions.B?.[2]).toBeCloseTo(30, 9);
  });

  it("los errores del modelo llegan como resultado, no como rechazo", async () => {
    const { client } = channel();
    const r = await client.solve({ project: beam, caseId: "NO-EXISTE" });
    expect(r.status).not.toBe("ok");
  });

  it("una excepción del solver se convierte en rechazo con su mensaje", async () => {
    const throwing: Solver = {
      solve: () => {
        throw new Error("boom");
      },
    };
    const { client } = channel(throwing);
    await expect(client.solve({ project: beam, caseId: "C1" })).rejects.toThrow("boom");
  });

  it("mensaje mal formado ⇒ respuesta error", async () => {
    const ch = new MessageChannel();
    opened.push(ch);
    attachSolverWorker(ch.port1);
    const reply = new Promise<unknown>((resolve) => {
      ch.port2.onmessage = (e: MessageEvent) => {
        resolve(e.data);
      };
    });
    ch.port2.postMessage({ id: 7, kind: "desconocido" });
    await expect(reply).resolves.toEqual({ id: 7, kind: "error", message: "Mensaje no reconocido por el Worker del solver" });
  });

  it("dispose rechaza las peticiones pendientes y las posteriores", async () => {
    const sent: SolverWorkerRequest[] = [];
    const endpoint: MessageEndpoint<SolverWorkerResponse, SolverWorkerRequest> = {
      postMessage: (m) => sent.push(m),
      onmessage: null,
    };
    const client = createSolverClient(endpoint);
    const p = client.ping();
    client.dispose();
    await expect(p).rejects.toThrow("cerrado");
    await expect(client.ping()).rejects.toThrow("cerrado");
    expect(sent).toHaveLength(1);
  });

  it("respuesta de tipo inesperado ⇒ rechazo", async () => {
    const endpoint: MessageEndpoint<SolverWorkerResponse, SolverWorkerRequest> = {
      postMessage: (m) => {
        queueMicrotask(() => endpoint.onmessage?.({ data: { id: m.id, kind: "pong", protocolVersion: 1 } } as MessageEvent<SolverWorkerResponse>));
      },
      onmessage: null,
    };
    const client = createSolverClient(endpoint);
    await expect(client.solve({ project: beam, caseId: "C1" })).rejects.toThrow("inesperada");
  });

  it("isSolverWorkerRequest y handleSolverRequest", () => {
    expect(isSolverWorkerRequest(null)).toBe(false);
    expect(isSolverWorkerRequest({ kind: "ping" })).toBe(false);
    expect(isSolverWorkerRequest({ id: 1, kind: "solve" })).toBe(false);
    expect(isSolverWorkerRequest({ id: 1, kind: "solve", request: {} })).toBe(true);
    const solver: Solver = {
      solve: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- se prueba la rama de valores que no son Error
        throw "texto";
      },
    };
    expect(handleSolverRequest({ id: 3, kind: "solve", request: { project: beam, caseId: "C1" } }, solver)).toEqual({
      id: 3,
      kind: "error",
      message: "texto",
    });
  });
});
