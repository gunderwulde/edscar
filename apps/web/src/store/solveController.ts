/**
 * Controlador del solver: lanza el cálculo en el Worker con debounce y cancelación (sin React).
 * - Cada cambio del proyecto o del caso mostrado reprograma el cálculo (si `auto`).
 * - "Cancelar" = ignorar la respuesta de peticiones superadas (el Worker termina su cálculo, pero su resultado
 *   no llega al store). Solo se publica la respuesta de la última petición.
 * - Actualiza `store.solver` (solving / ok / error + mensaje) y `store.results`.
 */
import type { EditorStore } from "@edscar/ui-state";
import type { SolverClient } from "../worker/client";

export interface SolveControllerOptions {
  /** Espera tras el último cambio antes de calcular (ms). Por defecto 250. */
  debounceMs?: number;
  /** Recalcular automáticamente al cambiar el modelo. Por defecto true. */
  auto?: boolean;
}

export interface SolveController {
  /** Se suscribe al store y, si `auto`, programa un primer cálculo. Idempotente. */
  start(): void;
  /** Programa un cálculo tras el debounce. */
  schedule(): void;
  /** Calcula ya (cancela lo pendiente). Resuelve cuando termina o queda superado. */
  solveNow(): Promise<void>;
  /** Descarta el cálculo pendiente y la respuesta del que esté en curso. */
  cancel(): void;
  setAuto(auto: boolean): void;
  /** Cancela y deja de escuchar el store. */
  dispose(): void;
}

export function createSolveController(
  store: EditorStore,
  client: SolverClient,
  options: SolveControllerOptions = {},
): SolveController {
  const debounceMs = options.debounceMs ?? 250;
  let auto = options.auto ?? true;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsub: (() => void) | undefined;
  let seen = { revision: -1, caseId: null as string | null };

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const run = async (explicit = true): Promise<void> => {
    clearTimer();
    const { project, revision, results } = store.getState();
    const caseId = results.caseId;
    const mine = ++seq;
    if (caseId === null) {
      if (explicit) store.solveFailed("No hay ningún caso de carga: crea un caso para calcular");
      else store.clearResults();
      return;
    }
    store.solveStarted();
    try {
      const result = await client.solve({ project, caseId });
      if (mine === seq) store.solveFinished(caseId, revision, result);
    } catch (e) {
      if (mine === seq) store.solveFailed(e instanceof Error ? e.message : String(e));
    }
  };

  const schedule = (): void => {
    clearTimer();
    seq++; // supera cualquier petición en curso
    timer = setTimeout(() => {
      void run(false);
    }, debounceMs);
  };

  const cancel = (): void => {
    clearTimer();
    seq++;
    store.solveCancelled();
  };

  return {
    start() {
      if (unsub) return;
      const s = store.getState();
      seen = { revision: s.revision, caseId: s.results.caseId };
      unsub = store.subscribe(() => {
        const cur = store.getState();
        if (cur.revision === seen.revision && cur.results.caseId === seen.caseId) return;
        seen = { revision: cur.revision, caseId: cur.results.caseId };
        if (auto) schedule();
      });
      if (auto) schedule();
    },
    schedule,
    solveNow: () => run(true),
    cancel,
    setAuto(value) {
      auto = value;
      if (!value) cancel();
    },
    dispose() {
      unsub?.();
      unsub = undefined;
      clearTimer();
      seq++;
    },
  };
}
