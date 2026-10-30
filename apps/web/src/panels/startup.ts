/**
 * Arranque de la app: ejemplos (`?example=`), carga por defecto sin borrador y borrador sin guardar.
 * Los ejemplos son ficheros `.edscar.json` en `public/examples`; se leen con `fetch` respetando la base de Vite.
 */
import { beamE1Project, isDirty, serializeProject, type DispatchResult, type EditorStore } from "@edscar/ui-state";

export interface ExampleInfo { id: string; file: string; nameKey: "example.portico" | "example.viga" }

export const EXAMPLES: readonly ExampleInfo[] = [
  { id: "portico-2-plantas", file: "examples/portico-2-plantas.edscar.json", nameKey: "example.portico" },
  { id: "viga-biapoyada", file: "examples/viga-biapoyada.edscar.json", nameKey: "example.viga" },
];

/** Ejemplo que se carga al abrir la app sin borrador. */
export const DEFAULT_EXAMPLE_ID = "portico-2-plantas";

export const findExample = (id: string): ExampleInfo | undefined => EXAMPLES.find((e) => e.id === id);

/** Valor de `?example=` tal cual si hay parámetro no vacío (loadExample informa si no existe); null si no hay. */
export function parseExampleParam(search: string): string | null {
  const v = new URLSearchParams(search).get("example");
  if (v === null || v === "") return null;
  return v;
}

export interface LoadExampleOptions {
  fetchFn?: typeof fetch;
  /** Base de la app (por defecto la de Vite, `import.meta.env.BASE_URL`). */
  baseUrl?: string;
}

/** URL del fichero del ejemplo respetando la base (`/`, `./`, `/edscar/`…). */
export function exampleUrl(info: ExampleInfo, baseUrl: string = import.meta.env.BASE_URL): string {
  const base = baseUrl === "" ? "/" : baseUrl;
  return `${base.endsWith("/") ? base : `${base}/`}${info.file}`;
}

export type LoadExampleResult = { ok: true } | { ok: false; message: string };

/** Carga un ejemplo en el store (sustituye el proyecto; no es deshacible). */
export async function loadExample(store: EditorStore, id: string, opts: LoadExampleOptions = {}): Promise<LoadExampleResult> {
  const info = findExample(id);
  if (!info) return { ok: false, message: `Ejemplo desconocido: "${id}"` };
  const fetchFn = opts.fetchFn ?? (typeof fetch === "function" ? fetch : undefined);
  let text: string | null = null;
  let failure = "";
  if (fetchFn) {
    try {
      const res = await fetchFn(exampleUrl(info, opts.baseUrl));
      if (res.ok) text = await res.text();
      else failure = `HTTP ${String(res.status)}`;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  } else {
    failure = "fetch no disponible";
  }
  if (text === null && id === "viga-biapoyada") text = serializeProject(beamE1Project());
  if (text === null) return { ok: false, message: failure };
  const r: DispatchResult = store.openProjectText(text, `${info.id}.edscar.json`);
  return r.ok ? { ok: true } : { ok: false, message: r.errors[0]?.message ?? "Ejemplo no válido" };
}

/** true si el proyecto del store no tiene geometría (se trata como "sin borrador previo"). */
export const isEmptyProject = (store: EditorStore): boolean => {
  const p = store.getState().project;
  return p.nodes.length === 0 && p.members.length === 0;
};

/**
 * Guarda el borrador tras `delayMs` de calma, pero solo si hay cambios sin guardar: así cargar un ejemplo o abrir un
 * fichero no pisa un borrador anterior hasta que el usuario edite. Devuelve la función de parada.
 */
export function autosaveDirtyDraft(store: EditorStore, delayMs = 1000): () => void {
  let last = store.getState().revision;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = store.subscribe(() => {
    const s = store.getState();
    if (s.revision === last) return;
    last = s.revision;
    if (timer !== undefined) clearTimeout(timer);
    if (!isDirty(s)) return;
    timer = setTimeout(() => {
      store.saveDraft();
    }, delayMs);
  });
  return () => {
    unsub();
    if (timer !== undefined) clearTimeout(timer);
  };
}
