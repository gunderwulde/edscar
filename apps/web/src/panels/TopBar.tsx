/**
 * Barra superior: archivo (nuevo, abrir, guardar, borrador), ejemplos, deshacer/rehacer con etiqueta, indicador de
 * cambios sin guardar, idioma, unidades, tema y ayuda. Atajos globales: Ctrl+S, Ctrl+O, Ctrl+Z/Y, ?, Alt+1..4.
 */
import { useEffect, useRef, useState } from "react";
import { isDirty } from "@edscar/ui-state";
import { useEditorSelector, useEditorStore } from "../store";
import { useFit } from "./fitContext";
import { HelpDialog } from "./HelpDialog";
import { useT } from "./i18n";
import { setPrefs, usePrefs, type Lang, type Theme } from "./prefs";
import { EXAMPLES, loadExample } from "./startup";
import { MenuButton } from "./ui";
import type { UnitSystem } from "./units";

const DEFAULT_FILE = "proyecto.edscar.json";

/** Descarga un texto como fichero (Blob + enlace temporal). */
export function downloadText(name: string, text: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 0);
  return true;
}

const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function TopBar() {
  const t = useT();
  const store = useEditorStore();
  const fit = useFit();
  const { lang, units, theme } = usePrefs();
  const history = useEditorSelector((s) => s.history);
  const dirty = useEditorSelector(isDirty);
  const fileName = useEditorSelector((s) => s.file.name);
  const fileInput = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<{ label: string; action: () => void } | null>(null);

  /** Ejecuta una acción que sustituye el proyecto; si hay cambios sin guardar pide confirmación. */
  const guarded = (label: string, action: () => void): void => {
    if (isDirty(store.getState())) setPending({ label, action });
    else action();
  };

  const save = (): void => {
    const name = store.getState().file.name ?? DEFAULT_FILE;
    const finalName = name.endsWith(".json") ? name : `${name}.edscar.json`;
    if (downloadText(finalName, store.exportProjectText())) {
      store.markSaved(finalName);
      setMessage({ kind: "ok", text: t("file.saved", { name: finalName }) });
    } else {
      setMessage({ kind: "error", text: t("file.saveFailed") });
    }
  };

  const openFile = (file: File): void => {
    void file.text().then(
      (text) => {
        const r = store.openProjectText(text, file.name);
        if (r.ok) {
          fit();
          setMessage({ kind: "ok", text: t("file.opened", { name: file.name }) });
        } else {
          setMessage({ kind: "error", text: t("file.openFailed", { reason: r.errors.map((e) => (e.path ? `${e.path}: ` : "") + e.message).slice(0, 3).join(" | ") }) });
        }
      },
      (e: unknown) => { setMessage({ kind: "error", text: t("file.openFailed", { reason: e instanceof Error ? e.message : String(e) }) }); },
    );
  };

  const chooseFile = (): void => {
    guarded(t("action.open"), () => { fileInput.current?.click(); });
  };

  const newProject = (): void => {
    guarded(t("action.new"), () => {
      store.newProject();
      store.discardDraft();
      fit();
      setMessage(null);
    });
  };

  const example = (id: string): void => {
    guarded(t("action.example"), () => {
      void loadExample(store, id).then((r) => {
        if (r.ok) {
          fit();
          setMessage({ kind: "ok", text: t("file.exampleLoaded") });
        } else setMessage({ kind: "error", text: t("file.exampleFailed", { reason: r.message }) });
      });
    });
  };

  const restore = (): void => {
    guarded(t("action.restoreDraft"), () => {
      const r = store.restoreDraft();
      if (r.ok) {
        fit();
        setMessage({ kind: "ok", text: t("file.draftRestored") });
      } else setMessage({ kind: "error", text: t("file.noDraft") });
    });
  };

  const discard = (): void => {
    store.discardDraft();
    setMessage({ kind: "ok", text: t("file.draftDiscarded") });
  };

  // Atajos globales. Los del lienzo marcan el evento con preventDefault y aquí se ignoran.
  const handlers = useRef({ save, chooseFile });
  handlers.current = { save, chooseFile };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        handlers.current.save();
      } else if (mod && key === "o") {
        e.preventDefault();
        handlers.current.chooseFile();
      } else if (mod && (key === "z" || key === "y") && !isEditable(e.target)) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) void store.redo();
        else void store.undo();
      } else if ((e.key === "?" || e.key === "F1") && !isEditable(e.target)) {
        e.preventDefault();
        setHelp(true);
      } else if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        const slot = ["left", "canvas", "right", "bottom"][Number(e.key) - 1] ?? "canvas";
        const el = document.querySelector<HTMLElement>(`[data-slot='${slot}']`)?.querySelector<HTMLElement>("button, input, select, [tabindex]:not([tabindex='-1'])");
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [store]);

  return (
    <div className="pn-topbar" role="group" aria-label={t("top.label")}>
      <MenuButton
        label={t("menu.file")}
        items={[
          { id: "new", label: t("action.new"), onSelect: newProject },
          { id: "open", label: t("action.openFile"), onSelect: chooseFile, hint: "Ctrl+O" },
          { id: "save", label: t("action.save"), onSelect: save, hint: "Ctrl+S" },
          { id: "restore", label: t("action.restoreDraft"), onSelect: restore },
          { id: "discard", label: t("action.discardDraft"), onSelect: discard },
        ]}
      />
      <MenuButton label={t("menu.examples")} items={EXAMPLES.map((e) => ({ id: e.id, label: t(e.nameKey), onSelect: () => { example(e.id); } }))} />
      <input
        ref={fileInput}
        type="file"
        accept=".json,.edscar.json,application/json"
        className="pn-sr"
        tabIndex={-1}
        aria-label={t("action.openFile")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" disabled={history.undoCount === 0} title={history.undoLabel ? t("history.undoLabel", { label: history.undoLabel }) : t("history.undo")} onClick={() => void store.undo()}>
        ↶ {history.undoLabel ? t("history.undoLabel", { label: history.undoLabel }) : t("history.undo")}
      </button>
      <button type="button" disabled={history.redoCount === 0} title={history.redoLabel ? t("history.redoLabel", { label: history.redoLabel }) : t("history.redo")} onClick={() => void store.redo()}>
        ↷ {history.redoLabel ? t("history.redoLabel", { label: history.redoLabel }) : t("history.redo")}
      </button>
      <span className={`pn-dirty${dirty ? " pn-dirty-on" : ""}`} role="status">
        {fileName ?? t("file.untitled")} · {dirty ? t("file.unsaved") : t("file.clean")}
      </span>

      <span className="pn-spacer" />
      <label className="pn-inline">
        <span className="pn-sr">{t("pref.lang")}</span>
        <select aria-label={t("pref.lang")} value={lang} onChange={(e) => { setPrefs({ lang: e.target.value as Lang }); }}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="pn-inline">
        <span className="pn-sr">{t("pref.units")}</span>
        <select aria-label={t("pref.units")} value={units} onChange={(e) => { setPrefs({ units: e.target.value as UnitSystem }); }}>
          <option value="SI">{t("pref.units.si")}</option>
          <option value="imperial">{t("pref.units.imperial")}</option>
        </select>
      </label>
      <label className="pn-inline">
        <span className="pn-sr">{t("pref.theme")}</span>
        <select aria-label={t("pref.theme")} value={theme} onChange={(e) => { setPrefs({ theme: e.target.value as Theme }); }}>
          <option value="auto">{t("pref.theme.auto")}</option>
          <option value="light">{t("pref.theme.light")}</option>
          <option value="dark">{t("pref.theme.dark")}</option>
        </select>
      </label>
      <button type="button" aria-label={t("top.help")} title="? / F1" onClick={() => { setHelp(true); }}>?</button>

      {message && <span role={message.kind === "error" ? "alert" : "status"} className={`pn-msg pn-msg-${message.kind}`}>{message.text}</span>}
      {pending && (
        <div role="alertdialog" aria-label={t("confirm.title")} className="pn-confirm">
          <span>{t("confirm.discard", { action: pending.label })}</span>
          <button type="button" onClick={() => { const a = pending.action; setPending(null); a(); }}>{t("confirm.yes")}</button>
          <button type="button" onClick={() => { setPending(null); }}>{t("confirm.no")}</button>
        </div>
      )}
      {help && <HelpDialog onClose={() => { setHelp(false); }} />}
    </div>
  );
}
