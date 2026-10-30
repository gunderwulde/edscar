/** Lado Worker del protocolo: atiende peticiones con una instancia de `Solver` (sin estado compartido). */
import { createSolver, type Solver } from "@edscar/solver";
import {
  SOLVER_PROTOCOL_VERSION,
  isSolverWorkerRequest,
  type MessageEndpoint,
  type SolverWorkerRequest,
  type SolverWorkerResponse,
} from "./protocol";

/** Respuesta a una petición ya validada. Nunca lanza: un fallo inesperado del solver se devuelve como `error`. */
export function handleSolverRequest(request: SolverWorkerRequest, solver: Solver): SolverWorkerResponse {
  if (request.kind === "ping") {
    return { id: request.id, kind: "pong", protocolVersion: SOLVER_PROTOCOL_VERSION };
  }
  try {
    return { id: request.id, kind: "solved", result: solver.solve(request.request) };
  } catch (e) {
    return { id: request.id, kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Conecta el manejador a un extremo (el `self` del Worker o un `MessagePort` en tests). */
export function attachSolverWorker(
  endpoint: MessageEndpoint<unknown, SolverWorkerResponse>,
  solver: Solver = createSolver(),
): void {
  endpoint.onmessage = (event) => {
    const data = event.data;
    if (!isSolverWorkerRequest(data)) {
      const id = typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "number"
        ? (data as { id: number }).id
        : -1;
      endpoint.postMessage({ id, kind: "error", message: "Mensaje no reconocido por el Worker del solver" });
      return;
    }
    endpoint.postMessage(handleSolverRequest(data, solver));
  };
}
