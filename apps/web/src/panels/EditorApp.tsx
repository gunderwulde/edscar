/** Editor completo: <App> del lienzo con todos los paneles de UX montados en sus slots. */
import "./panels.css";
import { App, type AppProps } from "../App";
import { BottomPanel, LeftPanel, NoticeBar, RightPanel, Startup } from "./Panels";
import { TopBar } from "./TopBar";

export interface EditorAppProps extends Omit<AppProps, "slots" | "toolbarProject"> {
  /** Cadena de consulta de la URL (por defecto `window.location.search`); admite `?example=<id>`. */
  search?: string;
}

export function EditorApp({ solver, store, persistDraft, search }: EditorAppProps) {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return (
    <App
      {...(solver ? { solver } : {})}
      {...(store ? { store } : {})}
      {...(persistDraft === undefined ? {} : { persistDraft })}
      toolbarProject={false}
      slots={{
        headerExtra: (
          <>
            <TopBar />
            <Startup search={query} defaultExample={store === undefined && persistDraft !== false} />
          </>
        ),
        toolbarExtra: <NoticeBar />,
        left: <LeftPanel />,
        right: <RightPanel />,
        bottom: <BottomPanel solver={solver} />,
      }}
    />
  );
}
