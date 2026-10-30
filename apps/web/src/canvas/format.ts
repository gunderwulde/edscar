/** Formato de números y colores de patrón para el lienzo. */

/** Número legible: hasta 3 decimales si |v| < 1, 2 si no; exponencial si es muy pequeño/grande. Sin ceros finales. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a < 0.0005 || a >= 1e6) return v.toExponential(1).replace("e+", "e");
  const s = Number(v.toFixed(a < 1 ? 3 : 2));
  return s === 0 ? "0" : String(s);
}

export const PATTERN_COLOR_COUNT = 8;

/** Color CSS (variable de tema) del patrón según su posición en `project.patterns`. */
export function patternColor(index: number): string {
  const k = ((index % PATTERN_COLOR_COUNT) + PATTERN_COLOR_COUNT) % PATTERN_COLOR_COUNT;
  return `var(--ec-pat-${String(k)})`;
}
