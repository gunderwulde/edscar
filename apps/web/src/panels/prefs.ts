/**
 * Preferencias de la interfaz (idioma, unidades de presentación, tema). Pequeño almacén externo propio con
 * `useSyncExternalStore`; persiste en localStorage cuando existe. No toca el modelo (que es siempre SI).
 */
import { useSyncExternalStore } from "react";
import type { UnitSystem } from "./units";

export type Lang = "es" | "en";
export type Theme = "auto" | "light" | "dark";
export interface Prefs { lang: Lang; units: UnitSystem; theme: Theme }

const KEY = "edscar.prefs.v1";
const DEFAULTS: Prefs = { lang: "es", units: "SI", theme: "auto" };

function read(): Prefs {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY);
    if (!raw) return DEFAULTS;
    const o = JSON.parse(raw) as Partial<Prefs>;
    return {
      lang: o.lang === "en" ? "en" : "es",
      units: o.units === "imperial" ? "imperial" : "SI",
      theme: o.theme === "light" || o.theme === "dark" ? o.theme : "auto",
    };
  } catch {
    return DEFAULTS;
  }
}

let state: Prefs = read();
const listeners = new Set<() => void>();

function applyToDocument(p: Prefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.lang = p.lang;
  if (p.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", p.theme);
}
applyToDocument(state);

export const getPrefs = (): Prefs => state;

export function setPrefs(patch: Partial<Prefs>): void {
  state = { ...state, ...patch };
  applyToDocument(state);
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sin almacenamiento: la preferencia vale solo para la sesión */
  }
  for (const l of [...listeners]) l();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
  );
}
