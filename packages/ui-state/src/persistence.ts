/** Serialización de `.edscar.json` y borrador local (escrito desde cero). Nada aquí lanza por fallos de E/S. */
import { loadProject } from "@edscar/model";
import type { Project, ValidationError } from "@edscar/model";

/** Subconjunto de `Storage` que necesitamos (permite inyectar un doble en tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFT_KEY = "edscar.draft.v1";

/** Texto de un fichero `.edscar.json` (JSON con sangría de 2 espacios). */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export type ParseResult = { ok: true; project: Project } | { ok: false; errors: ValidationError[] };

/** Parsea, migra (migrateProject) y valida (validateProject) el texto de un `.edscar.json`. */
export function parseProjectText(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: "", code: "json-syntax", message: `JSON no válido: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const r = loadProject(raw);
  return r.ok ? { ok: true, project: r.project } : { ok: false, errors: r.errors };
}

/** `localStorage` si existe y es accesible (puede lanzar en navegación privada o sin permisos); si no, null. */
export function defaultStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export type DraftResult = { ok: true } | { ok: false; reason: string };

export function saveDraft(storage: StorageLike | null, project: Project): DraftResult {
  if (!storage) return { ok: false, reason: "Almacenamiento local no disponible" };
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), project }));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** `missing`: no hay borrador (no es un error que mostrar al usuario). */
export type DraftLoad = { ok: true; project: Project; savedAt: string } | { ok: false; reason: string; missing?: boolean };

export function loadDraft(storage: StorageLike | null): DraftLoad {
  if (!storage) return { ok: false, reason: "Almacenamiento local no disponible", missing: true };
  let text: string | null;
  try {
    text = storage.getItem(DRAFT_KEY);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (text === null) return { ok: false, reason: "No hay borrador", missing: true };
  let env: unknown;
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Borrador corrupto" };
  }
  if (typeof env !== "object" || env === null || !("project" in env)) return { ok: false, reason: "Borrador corrupto" };
  const savedAt = "savedAt" in env && typeof env.savedAt === "string" ? env.savedAt : "";
  const r = loadProject(env.project);
  return r.ok ? { ok: true, project: r.project, savedAt } : { ok: false, reason: `Borrador no válido: ${r.errors[0]?.message ?? ""}` };
}

export function clearDraft(storage: StorageLike | null): void {
  try {
    storage?.removeItem(DRAFT_KEY);
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
}
