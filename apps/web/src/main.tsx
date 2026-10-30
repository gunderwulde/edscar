import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorApp } from "./panels";
import { createBrowserSolverClient } from "./worker/client";

const container = document.getElementById("root");
if (!container) throw new Error("Falta el elemento #root en index.html");

const solver = createBrowserSolverClient();

createRoot(container).render(
  <StrictMode>
    <EditorApp solver={solver} />
  </StrictMode>,
);
