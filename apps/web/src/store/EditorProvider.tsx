/** Enlace React ↔ @edscar/ui-state. Sin librerías de estado: solo `useSyncExternalStore`. */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { EditorState, EditorStore } from "@edscar/ui-state";
import type { SolverClient } from "../worker/client";
import { createSolveController, type SolveController } from "./solveController";

interface EditorContextValue { store: EditorStore; controller: SolveController | null }

const EditorContext = createContext<EditorContextValue | null>(null);

export interface EditorProviderProps {
  store: EditorStore;
  /** Cliente del Worker; sin él no hay cálculo (tests de UI). */
  solver?: SolverClient | undefined;
  /** Recalcular al editar (por defecto sí). */
  autoSolve?: boolean;
  debounceMs?: number;
  children: ReactNode;
}

export function EditorProvider({ store, solver, autoSolve = true, debounceMs, children }: EditorProviderProps) {
  const controller = useMemo(
    () => (solver ? createSolveController(store, solver, { auto: autoSolve, ...(debounceMs === undefined ? {} : { debounceMs }) }) : null),
    [store, solver, autoSolve, debounceMs],
  );
  useEffect(() => {
    controller?.start();
    return () => {
      controller?.dispose();
    };
  }, [controller]);
  const value = useMemo(() => ({ store, controller }), [store, controller]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("Falta <EditorProvider> en el árbol de React");
  return ctx;
}

/** El store (comandos, selección, vista…). Estable mientras el proveedor no cambie de store. */
export function useEditorStore(): EditorStore {
  return useEditorContext().store;
}

/** Controlador del solver (`solveNow`, `cancel`, `setAuto`); null si no se pasó cliente del Worker. */
export function useSolveController(): SolveController | null {
  return useEditorContext().controller;
}

/**
 * Suscribe el componente a una parte del estado. El selector debe devolver una referencia ESTABLE (campos del
 * estado como `s.selection`, `s.view`, `s.project`), no objetos nuevos en cada llamada; para valores derivados
 * se selecciona la fuente y se deriva con `useMemo`.
 */
export function useEditorSelector<T>(selector: (state: EditorState) => T): T {
  const { store } = useEditorContext();
  return useSyncExternalStore((l) => store.subscribe(l), () => selector(store.getState()));
}

/** Todo el estado (re-renderiza en cada cambio; preferir `useEditorSelector`). */
export function useEditorState(): EditorState {
  return useEditorSelector((s) => s);
}
