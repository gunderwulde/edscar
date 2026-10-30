/**
 * Protocolo de mensajes entre el hilo principal y el Worker del solver (ADR-006).
 * Solo datos clonables (structured clone): sin funciones ni clases. Unidades y ejes: los de @edscar/solver (SI, ADR-001).
 * Cualquier cambio incompatible incrementa SOLVER_PROTOCOL_VERSION.
 */
import type { SolveRequest, SolveResult } from "@edscar/solver";

export const SOLVER_PROTOCOL_VERSION = 1;

/** Mensajes del hilo principal al Worker. `id` lo asigna el cliente y se devuelve en la respuesta. */
export type SolverWorkerRequest =
  | { id: number; kind: "ping" }
  | { id: number; kind: "solve"; request: SolveRequest };

/** Mensajes del Worker al hilo principal. `error` = fallo inesperado o mensaje mal formado (no un error del modelo:
 *  esos llegan como `solved` con `result.status` distinto de "ok"). `id` = -1 si la petición no traía id legible. */
export type SolverWorkerResponse =
  | { id: number; kind: "pong"; protocolVersion: number }
  | { id: number; kind: "solved"; result: SolveResult }
  | { id: number; kind: "error"; message: string };

/**
 * Extremo de un canal de mensajes: lo cumplen `Worker`, el `self` de un Worker dedicado y `MessagePort`
 * (en tests se usa un `MessageChannel`).
 */
export interface MessageEndpoint<In, Out> {
  postMessage(message: Out): void;
  onmessage: ((event: MessageEvent<In>) => void) | null;
}

/** Comprobación en tiempo de ejecución de un mensaje entrante al Worker. */
export function isSolverWorkerRequest(data: unknown): data is SolverWorkerRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number") return false;
  if (d.kind === "ping") return true;
  return d.kind === "solve" && typeof d.request === "object" && d.request !== null;
}
