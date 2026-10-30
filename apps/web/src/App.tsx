import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createEditorStore, type EditorStore } from "@edscar/ui-state";
import "./app.css";
import { Canvas } from "./canvas";
import { FitContext } from "./panels/fitContext";
import { useT, type MessageKey } from "./panels/i18n";
import { autosaveDirtyDraft } from "./panels/startup";
import { EditorProvider } from "./store";
import { Toolbar } from "./Toolbar";
import type { SolverClient } from "./worker/client";

type SolverStatus = "connecting" | "ready" | "unavailable";

const STATUS_KEY: Record<SolverStatus, MessageKey> = {
  connecting: "solver.connecting",
  ready: "solver.ready",
  unavailable: "solver.unavailable",
};

/**
 * Puntos de montaje para UX/Paneles (ver panels/README.md). Cada slot es opcional; si no se pasa, su zona no se
 * dibuja y el lienzo ocupa el espacio. Los componentes de los slots se renderizan DENTRO de <EditorProvider>, así que
 * pueden usar `useEditorStore`, `useEditorSelector` y `useSolveController` de ./store.
 */
export interface AppSlots {
  /** Dentro de la cabecera, a la derecha del estado del solver (menús, nombre de proyecto…). */
  headerExtra?: ReactNode;
  /** Barra de herramientas adicional, bajo la barra mínima. */
  toolbarExtra?: ReactNode;
  /** Columna izquierda (árbol / tablas / patrones). */
  left?: ReactNode;
  /** Columna derecha (propiedades). */
  right?: ReactNode;
  /** Zona inferior (tablas tipo hoja, resultados numéricos). */
  bottom?: ReactNode;
}

export interface AppProps {
  /** Cliente del Worker del solver; sin él la app arranca igualmente (p. ej. en tests) y no calcula. */
  solver?: SolverClient;
  /** Store ya creado (tests o integración); por defecto la app crea uno propio. */
  store?: EditorStore;
  /** Guardar/recuperar el borrador en localStorage (solo con store propio). Por defecto true. */
  persistDraft?: boolean;
  slots?: AppSlots;
  /** Mostrar Nuevo / Ejemplo viga E1 en la barra mínima (false cuando los paneles ofrecen su menú de archivo). */
  toolbarProject?: boolean;
}

function Shell({ status, slots, toolbarProject }: { status: SolverStatus; slots: AppSlots; toolbarProject: boolean }) {
  const t = useT();
  const [fitSignal, setFitSignal] = useState(0);
  const refit = (): void => {
    setFitSignal((n) => n + 1);
  };
  return (
    <FitContext.Provider value={refit}>
    <div className="app-shell">
      <header className="app-header">
        <h1>Edscar</h1>
        <p role="status">{t(STATUS_KEY[status])}</p>
        <div className="app-header-extra" data-slot="header">{slots.headerExtra}</div>
      </header>
      <Toolbar onFit={refit} onProjectReplaced={refit} showProject={toolbarProject} />
      {slots.toolbarExtra && <div className="app-toolbar-extra" data-slot="toolbar">{slots.toolbarExtra}</div>}
      <div className="app-body">
        {slots.left && <aside className="app-left" data-slot="left" aria-label={t("app.left")}>{slots.left}</aside>}
        <main className="app-canvas" data-slot="canvas">
          <Canvas fitSignal={fitSignal} />
        </main>
        {slots.right && <aside className="app-right" data-slot="right" aria-label={t("app.right")}>{slots.right}</aside>}
      </div>
      {slots.bottom && <section className="app-bottom" data-slot="bottom" aria-label={t("app.bottom")}>{slots.bottom}</section>}
    </div>
    </FitContext.Provider>
  );
}

/** Maquetación del editor 2D: barra de herramientas, lienzo y zonas de montaje para los paneles. */
export function App({ solver, store: external, persistDraft = true, slots = {}, toolbarProject = true }: AppProps) {
  const [status, setStatus] = useState<SolverStatus>(solver ? "connecting" : "unavailable");
  const store = useMemo(() => {
    if (external) return external;
    const s = createEditorStore();
    if (persistDraft) s.restoreDraft();
    return s;
  }, [external, persistDraft]);

  useEffect(() => {
    if (external || !persistDraft) return;
    return autosaveDirtyDraft(store);
  }, [store, external, persistDraft]);

  useEffect(() => {
    if (!solver) return;
    let active = true;
    solver.ping().then(
      () => {
        if (active) setStatus("ready");
      },
      () => {
        if (active) setStatus("unavailable");
      },
    );
    return () => {
      active = false;
    };
  }, [solver]);

  return (
    <EditorProvider store={store} solver={solver}>
      <Shell status={status} slots={slots} toolbarProject={toolbarProject} />
    </EditorProvider>
  );
}
