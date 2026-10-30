/**
 * Store del editor (escrito desde cero, sin React ni librerías de estado). API: getState / subscribe / dispatch.
 *
 * - Los cambios del modelo son SIEMPRE comandos (`dispatch`). Cada uno se valida con `validateProject`: si falla,
 *   el estado queda intacto y se devuelven (y guardan en `lastErrors`) los errores.
 * - Historial por comandos serializables, sin límite. `beginGroup/endGroup` agrupan varios comandos en una sola
 *   entrada (un arrastre = un undo); `cancelGroup` los revierte sin dejar rastro.
 * - El estado es inmutable: cada cambio produce un objeto nuevo (apto para `useSyncExternalStore`).
 */
import type { Id, Project, ValidationError } from "@edscar/model";
import type { SolveResult, SolveStatus } from "@edscar/solver";
import { createEmptyProject, deleteSelectionCommand, type SupportPreset } from "./builders";
import { applyCommand, combine, commandLabel, type Command } from "./commands";
import {
  clearDraft, defaultStorage, loadDraft, parseProjectText, saveDraft, serializeProject,
  type DraftResult, type StorageLike,
} from "./persistence";

export interface Selection { nodes: Id[]; members: Id[]; loads: Id[] }
export type SelectionMode = "replace" | "add" | "toggle" | "remove";
export type Tool = "select" | "node" | "member" | "support";
export type DiagramChoice = "none" | "N" | "V" | "M";

/** Vista: (cx, cz) = punto del modelo (m) en el centro del lienzo; zoom en píxeles por metro. */
export interface ViewState { cx: number; cz: number; zoom: number }
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 20000;

export interface DisplayOptions {
  grid: boolean;
  /** Captura a la rejilla (siempre se captura a nudos cercanos). */
  snap: boolean;
  loads: boolean;
  deformed: boolean;
  /** Factor de la deformada; null = automático. */
  deformScale: number | null;
  diagram: DiagramChoice;
  reactions: boolean;
}

/** Último resultado recibido y el caso que se muestra. */
export interface ResultsState {
  /** Caso mostrado/por resolver (id de LoadCase) o null. */
  caseId: Id | null;
  result: SolveResult | null;
  /** Caso y revisión del proyecto con que se calculó `result`. */
  resultCaseId: Id | null;
  resultRevision: number | null;
}

export type SolverPhase = "idle" | "solving" | "done" | "failed";
export interface SolverState {
  phase: SolverPhase;
  /** true si el último resultado recibido es status "ok"; null si no hay. */
  ok: boolean | null;
  status: SolveStatus | null;
  /** Mensaje del solver (avisos o motivo del fallo) para mostrarlo al usuario. */
  message: string | null;
}

export interface HistoryEntry { label: string; forward: Command; inverse: Command }
export interface HistorySummary { undoCount: number; redoCount: number; undoLabel: string | null; redoLabel: string | null }

export interface EditorState {
  project: Project;
  /** Se incrementa con cada cambio del proyecto (comando, undo/redo, carga de proyecto). */
  revision: number;
  selection: Selection;
  tool: Tool;
  supportPreset: SupportPreset;
  activePattern: Id | null;
  hiddenPatterns: readonly Id[];
  view: ViewState;
  display: DisplayOptions;
  results: ResultsState;
  solver: SolverState;
  history: HistorySummary;
  file: { name: string | null; savedRevision: number };
  /** Errores del último comando rechazado (null tras un comando aceptado). */
  lastErrors: readonly ValidationError[] | null;
}

export type DispatchResult = { ok: true } | { ok: false; errors: ValidationError[] };

export interface StoreOptions {
  project?: Project;
  /** Almacenamiento del borrador; por defecto `localStorage` si está disponible. null = sin borrador. */
  storage?: StorageLike | null;
}

export interface EditorStore {
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
  dispatch(command: Command): DispatchResult;

  undo(): boolean;
  redo(): boolean;
  beginGroup(label?: string): void;
  endGroup(): void;
  /** Revierte lo hecho dentro del grupo abierto y lo descarta (p. ej. Esc durante un arrastre). */
  cancelGroup(): void;
  isGrouping(): boolean;
  /** Copia serializable del historial (más antiguo primero en `undo`; el próximo rehacer es el último de `redo`). */
  getHistory(): { undo: readonly HistoryEntry[]; redo: readonly HistoryEntry[] };

  select(sel: Partial<Selection>, mode?: SelectionMode): void;
  clearSelection(): void;
  selectAll(): void;
  /** Borra la selección actual (un solo paso de undo). */
  deleteSelection(): DispatchResult;

  setTool(tool: Tool): void;
  setSupportPreset(preset: SupportPreset): void;
  setActivePattern(id: Id | null): void;
  setPatternVisible(id: Id, visible: boolean): void;
  setView(view: Partial<ViewState>): void;
  setDisplay(display: Partial<DisplayOptions>): void;
  clearErrors(): void;

  setResultCase(caseId: Id | null): void;
  solveStarted(): void;
  solveFinished(caseId: Id, revision: number, result: SolveResult): void;
  solveFailed(message: string): void;
  /** Cancelación: el cálculo en curso deja de esperarse; conserva el último resultado. */
  solveCancelled(): void;
  clearResults(): void;

  newProject(analysis?: Project["analysis"]): void;
  replaceProject(project: Project, fileName?: string | null): DispatchResult;
  /** Parsea (con migración), valida y sustituye el proyecto actual por el del texto de un `.edscar.json`. */
  openProjectText(text: string, fileName?: string | null): DispatchResult;
  /** Texto `.edscar.json` del proyecto actual; no cambia el estado (usar `markSaved` al guardarlo). */
  exportProjectText(): string;
  markSaved(fileName?: string | null): void;
  saveDraft(): DraftResult;
  restoreDraft(): DispatchResult;
  discardDraft(): void;
}

const EMPTY_SELECTION: Selection = { nodes: [], members: [], loads: [] };
const IDLE_SOLVER: SolverState = { phase: "idle", ok: null, status: null, message: null };
const EMPTY_RESULTS: ResultsState = { caseId: null, result: null, resultCaseId: null, resultRevision: null };

const DEFAULT_DISPLAY: DisplayOptions = {
  grid: true, snap: true, loads: true, deformed: true, deformScale: null, diagram: "M", reactions: true,
};

const DEFAULT_VIEW: ViewState = { cx: 3, cz: 1.5, zoom: 60 };

const EMPTY_HISTORY: HistorySummary = { undoCount: 0, redoCount: 0, undoLabel: null, redoLabel: null };

/** Fusiona movimientos consecutivos del mismo nudo (un arrastre deja un solo `node.move` por nudo). */
function coalesceMoves(entries: readonly HistoryEntry[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const e of entries) {
    if (e.forward.type === "node.move") {
      const id = e.forward.payload.id;
      let k = out.length - 1;
      while (k >= 0 && out[k]?.forward.type === "node.move" && (out[k]?.forward as { payload: { id: Id } }).payload.id !== id) k--;
      const prev = out[k];
      if (k >= 0 && prev?.forward.type === "node.move") {
        out[k] = { label: prev.label, forward: e.forward, inverse: prev.inverse };
        continue;
      }
    }
    out.push(e);
  }
  return out;
}

const uniq = (ids: readonly Id[]): Id[] => [...new Set(ids)];

export function createEditorStore(options: StoreOptions = {}): EditorStore {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const listeners = new Set<() => void>();
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let groupDepth = 0;
  let groupLabel: string | undefined;
  let groupEntries: HistoryEntry[] = [];

  const project0 = options.project ?? createEmptyProject();
  let state: EditorState = {
    project: project0, revision: 0, selection: EMPTY_SELECTION, tool: "select", supportPreset: "pinned",
    activePattern: project0.patterns[0]?.id ?? null, hiddenPatterns: [], view: DEFAULT_VIEW, display: DEFAULT_DISPLAY,
    results: { ...EMPTY_RESULTS, caseId: project0.cases[0]?.id ?? null }, solver: IDLE_SOLVER, history: EMPTY_HISTORY,
    file: { name: null, savedRevision: 0 }, lastErrors: null,
  };

  const summary = (): HistorySummary => ({
    undoCount: undoStack.length, redoCount: redoStack.length,
    undoLabel: undoStack[undoStack.length - 1]?.label ?? null,
    redoLabel: redoStack[redoStack.length - 1]?.label ?? null,
  });

  const set = (patch: Partial<EditorState>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  /** Mantiene coherentes selección, patrón activo, visibilidad y caso con el proyecto. */
  const reconcile = (project: Project): Partial<EditorState> => {
    const nodes = new Set(project.nodes.map((n) => n.id));
    const members = new Set(project.members.map((m) => m.id));
    const loads = new Set(project.loads.map((l) => l.id));
    const patterns = new Set(project.patterns.map((p) => p.id));
    const sel = state.selection;
    const selection: Selection = {
      nodes: sel.nodes.filter((i) => nodes.has(i)),
      members: sel.members.filter((i) => members.has(i)),
      loads: sel.loads.filter((i) => loads.has(i)),
    };
    const same = selection.nodes.length === sel.nodes.length && selection.members.length === sel.members.length &&
      selection.loads.length === sel.loads.length;
    const cases = new Set(project.cases.map((c) => c.id));
    const caseId = state.results.caseId !== null && cases.has(state.results.caseId)
      ? state.results.caseId
      : (project.cases[0]?.id ?? null);
    return {
      selection: same ? sel : selection,
      activePattern: state.activePattern !== null && patterns.has(state.activePattern)
        ? state.activePattern
        : (project.patterns[0]?.id ?? null),
      hiddenPatterns: state.hiddenPatterns.filter((i) => patterns.has(i)),
      results: caseId === state.results.caseId ? state.results : { ...state.results, caseId },
    };
  };

  const commit = (project: Project): void => {
    const patch = reconcile(project);
    set({ ...patch, project, revision: state.revision + 1, lastErrors: null });
  };

  const fail = (errors: ValidationError[]): DispatchResult => {
    set({ lastErrors: errors });
    return { ok: false, errors };
  };

  const pushHistory = (entry: HistoryEntry): void => {
    undoStack = [...undoStack, entry];
    redoStack = [];
  };

  const dispatch = (command: Command): DispatchResult => {
    const r = applyCommand(state.project, command);
    if (!r.ok) return fail(r.errors);
    const entry: HistoryEntry = { label: groupLabel ?? commandLabel(command), forward: command, inverse: r.inverse };
    if (groupDepth > 0) groupEntries.push({ ...entry, label: commandLabel(command) });
    else pushHistory(entry);
    state = { ...state, history: summary() };
    commit(r.project);
    return { ok: true };
  };

  const flushGroup = (): void => {
    const entries = coalesceMoves(groupEntries);
    groupEntries = [];
    const label = groupLabel;
    groupLabel = undefined;
    if (entries.length === 0) return;
    if (entries.length === 1 && entries[0]) {
      pushHistory(label ? { ...entries[0], label } : entries[0]);
    } else {
      pushHistory({
        label: label ?? "Varios cambios",
        forward: combine(entries.map((e) => e.forward), label),
        inverse: combine(entries.map((e) => e.inverse).reverse(), label),
      });
    }
    set({ history: summary() });
  };

  const replace = (project: Project, fileName: string | null): DispatchResult => {
    undoStack = [];
    redoStack = [];
    groupDepth = 0;
    groupEntries = [];
    groupLabel = undefined;
    const revision = state.revision + 1;
    set({
      project, revision, selection: EMPTY_SELECTION, activePattern: project.patterns[0]?.id ?? null, hiddenPatterns: [],
      results: { ...EMPTY_RESULTS, caseId: project.cases[0]?.id ?? null }, solver: IDLE_SOLVER, history: EMPTY_HISTORY,
      file: { name: fileName, savedRevision: revision }, lastErrors: null,
    });
    return { ok: true };
  };

  const step = (from: "undo" | "redo"): boolean => {
    if (groupDepth > 0) return false;
    const stack = from === "undo" ? undoStack : redoStack;
    const entry = stack[stack.length - 1];
    if (!entry) return false;
    const r = applyCommand(state.project, from === "undo" ? entry.inverse : entry.forward);
    if (!r.ok) {
      fail(r.errors);
      return false;
    }
    if (from === "undo") {
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, entry];
    } else {
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, entry];
    }
    state = { ...state, history: summary() };
    commit(r.project);
    return true;
  };

  const normSel = (sel: Partial<Selection>): Selection => {
    const p = state.project;
    const nodes = new Set(p.nodes.map((n) => n.id));
    const members = new Set(p.members.map((m) => m.id));
    const loads = new Set(p.loads.map((l) => l.id));
    return {
      nodes: uniq(sel.nodes ?? []).filter((i) => nodes.has(i)),
      members: uniq(sel.members ?? []).filter((i) => members.has(i)),
      loads: uniq(sel.loads ?? []).filter((i) => loads.has(i)),
    };
  };

  const combineSel = (a: readonly Id[], b: readonly Id[], mode: SelectionMode): Id[] => {
    switch (mode) {
      case "replace": return [...b];
      case "add": return uniq([...a, ...b]);
      case "remove": return a.filter((i) => !b.includes(i));
      case "toggle": return [...a.filter((i) => !b.includes(i)), ...b.filter((i) => !a.includes(i))];
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    undo: () => step("undo"),
    redo: () => step("redo"),
    beginGroup(label) {
      if (groupDepth === 0) groupLabel = label;
      groupDepth++;
    },
    endGroup() {
      if (groupDepth === 0) return;
      groupDepth--;
      if (groupDepth === 0) flushGroup();
    },
    cancelGroup() {
      if (groupDepth === 0) return;
      const entries = groupEntries;
      groupDepth = 0;
      groupEntries = [];
      groupLabel = undefined;
      if (entries.length === 0) return;
      const r = applyCommand(state.project, combine(entries.map((e) => e.inverse).reverse()));
      if (r.ok) commit(r.project);
      else fail(r.errors);
    },
    isGrouping: () => groupDepth > 0,
    getHistory: () => ({ undo: undoStack, redo: redoStack }),

    select(sel, mode = "replace") {
      const next = normSel(sel);
      const cur = state.selection;
      set({
        selection: {
          nodes: combineSel(cur.nodes, next.nodes, mode),
          members: combineSel(cur.members, next.members, mode),
          loads: combineSel(cur.loads, next.loads, mode),
        },
      });
    },
    clearSelection: () => {
      if (state.selection !== EMPTY_SELECTION) set({ selection: EMPTY_SELECTION });
    },
    selectAll() {
      const p = state.project;
      set({ selection: { nodes: p.nodes.map((n) => n.id), members: p.members.map((m) => m.id), loads: [] } });
    },
    deleteSelection() {
      const cmd = deleteSelectionCommand(state.selection);
      return cmd ? dispatch(cmd) : { ok: true };
    },

    setTool: (tool) => {
      set({ tool });
    },
    setSupportPreset: (supportPreset) => {
      set({ supportPreset });
    },
    setActivePattern(id) {
      if (id === null || state.project.patterns.some((p) => p.id === id)) set({ activePattern: id });
    },
    setPatternVisible(id, visible) {
      const hidden = state.hiddenPatterns.filter((i) => i !== id);
      set({ hiddenPatterns: visible ? hidden : [...hidden, id] });
    },
    setView(view) {
      const next = { ...state.view, ...view };
      if (!Number.isFinite(next.cx) || !Number.isFinite(next.cz) || !Number.isFinite(next.zoom)) return;
      set({ view: { ...next, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom)) } });
    },
    setDisplay: (display) => {
      set({ display: { ...state.display, ...display } });
    },
    clearErrors: () => {
      if (state.lastErrors) set({ lastErrors: null });
    },

    setResultCase(caseId) {
      if (caseId === null || state.project.cases.some((c) => c.id === caseId)) {
        set({ results: { ...state.results, caseId } });
      }
    },
    solveStarted: () => {
      set({ solver: { ...state.solver, phase: "solving" } });
    },
    solveFinished(caseId, revision, result) {
      set({
        results: { ...state.results, result, resultCaseId: caseId, resultRevision: revision },
        solver: { phase: "done", ok: result.status === "ok", status: result.status, message: result.message ?? null },
      });
    },
    solveFailed: (message) => {
      set({ solver: { phase: "failed", ok: false, status: null, message } });
    },
    solveCancelled: () => {
      if (state.solver.phase === "solving") set({ solver: { ...state.solver, phase: "idle" } });
    },
    clearResults: () => {
      set({ results: { ...EMPTY_RESULTS, caseId: state.results.caseId }, solver: IDLE_SOLVER });
    },

    newProject: (analysis) => {
      replace(createEmptyProject(analysis), null);
    },
    replaceProject: (project, fileName = null) => {
      const r = applyCommand(project, combine([]));
      return r.ok ? replace(project, fileName) : fail(r.errors);
    },
    openProjectText(text, fileName = null) {
      const r = parseProjectText(text);
      return r.ok ? replace(r.project, fileName) : fail(r.errors);
    },
    exportProjectText: () => serializeProject(state.project),
    markSaved: (fileName) => {
      set({ file: { name: fileName === undefined ? state.file.name : fileName, savedRevision: state.revision } });
    },
    saveDraft: () => saveDraft(storage, state.project),
    restoreDraft() {
      const d = loadDraft(storage);
      if (!d.ok) {
        const errors = [{ path: "", code: "draft", message: d.reason }];
        return d.missing ? { ok: false, errors } : fail(errors);
      }
      return replace(d.project, null);
    },
    discardDraft: () => {
      clearDraft(storage);
    },
  };
}

/** true si el proyecto tiene cambios sin guardar. */
export const isDirty = (s: EditorState): boolean => s.revision !== s.file.savedRevision;

/** Resultado del caso mostrado, con indicador de si el proyecto cambió desde que se calculó. */
export function visibleResult(s: Pick<EditorState, "results" | "revision">): { result: SolveResult; stale: boolean } | null {
  const r = s.results;
  if (!r.result || r.caseId === null || r.resultCaseId !== r.caseId) return null;
  return { result: r.result, stale: r.resultRevision !== s.revision };
}

/** Guarda el borrador tras `delayMs` de calma tras cada cambio del proyecto. Devuelve la función de parada. */
export function autosaveDraft(store: EditorStore, delayMs = 1000): () => void {
  let last = store.getState().revision;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = store.subscribe(() => {
    const rev = store.getState().revision;
    if (rev === last) return;
    last = rev;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      store.saveDraft();
    }, delayMs);
  });
  return () => {
    unsub();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** Descripción accesible de la selección ("2 nudos, 1 barra"). */
export function describeSelection(sel: Selection): string {
  const part = (n: number, one: string, many: string): string[] => (n === 0 ? [] : [`${String(n)} ${n === 1 ? one : many}`]);
  const parts = [...part(sel.nodes.length, "nudo", "nudos"), ...part(sel.members.length, "barra", "barras"), ...part(sel.loads.length, "carga", "cargas")];
  return parts.length === 0 ? "Sin selección" : parts.join(", ");
}
