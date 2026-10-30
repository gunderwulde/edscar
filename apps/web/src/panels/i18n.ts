/**
 * Internacionalización propia (ES por defecto, EN). Sin librerías: un diccionario por idioma, claves tipadas y
 * sustitución de `{parámetros}`. El diccionario inglés debe tener exactamente las mismas claves (lo comprueba tsc).
 */
import { getPrefs, usePrefs, type Lang } from "./prefs";
import { en } from "./dict.en";
import { es } from "./dict.es";

export type MessageKey = keyof typeof es;
export type Params = Record<string, string | number>;

const DICTS: Record<Lang, Record<MessageKey, string>> = { es, en };

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const raw = DICTS[lang][key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

export type TFunction = (key: MessageKey, params?: Params) => string;

/** Traductor fuera de React (usa el idioma actual). */
export const tNow: TFunction = (key, params) => translate(getPrefs().lang, key, params);

/** Hook: traductor reactivo al idioma de las preferencias. */
export function useT(): TFunction {
  const { lang } = usePrefs();
  return (key, params) => translate(lang, key, params);
}
