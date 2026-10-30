/** Punto de entrada del Web Worker del solver (lo carga `createBrowserSolverClient`). */
import { attachSolverWorker } from "./handler";

attachSolverWorker(self);
