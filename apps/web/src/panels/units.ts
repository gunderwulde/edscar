/**
 * Unidades de presentación (CLAUDE.md regla 7): el modelo es siempre SI (m, kN, kN·m, °C); aquí solo se convierte
 * para mostrar y para leer lo que escribe el usuario. Escrito desde cero. Factores exactos de las definiciones
 * (1 ft = 0,3048 m; 1 lbf = 4,4482216152605 N; 1 in = 0,0254 m).
 */
export type UnitSystem = "SI" | "imperial";

export type Quantity =
  | "length" // m ↔ ft
  | "smallLength" // desplazamientos: mm ↔ in
  | "force" // kN ↔ kip
  | "moment" // kN·m ↔ kip·ft
  | "distributed" // kN/m ↔ kip/ft
  | "modulus" // kN/m² → MPa ↔ ksi
  | "area" // m² → cm² ↔ in²
  | "inertia" // m⁴ → cm⁴ ↔ in⁴
  | "density" // t/m³ ↔ lb/ft³
  | "alpha" // 1/°C → 10⁻⁶/°C ↔ 10⁻⁶/°F
  | "tempDelta" // °C ↔ °F (incrementos)
  | "gradient" // °C/m ↔ °F/ft
  | "angle" // rad → ° (ambos sistemas)
  | "factor"; // adimensional

interface UnitDef { label: string; factor: number }

const FT = 0.3048;
const IN = 0.0254;
const KIP = 4.4482216152605; // kN por kip

const TABLE: Record<Quantity, Record<UnitSystem, UnitDef>> = {
  length: { SI: { label: "m", factor: 1 }, imperial: { label: "ft", factor: 1 / FT } },
  smallLength: { SI: { label: "mm", factor: 1000 }, imperial: { label: "in", factor: 1 / IN } },
  force: { SI: { label: "kN", factor: 1 }, imperial: { label: "kip", factor: 1 / KIP } },
  moment: { SI: { label: "kN·m", factor: 1 }, imperial: { label: "kip·ft", factor: 1 / (KIP * FT) } },
  distributed: { SI: { label: "kN/m", factor: 1 }, imperial: { label: "kip/ft", factor: FT / KIP } },
  modulus: { SI: { label: "MPa", factor: 1e-3 }, imperial: { label: "ksi", factor: 1 / 6894.757293168 } },
  area: { SI: { label: "cm²", factor: 1e4 }, imperial: { label: "in²", factor: 1 / (IN * IN) } },
  inertia: { SI: { label: "cm⁴", factor: 1e8 }, imperial: { label: "in⁴", factor: 1 / (IN * IN * IN * IN) } },
  density: { SI: { label: "t/m³", factor: 1 }, imperial: { label: "lb/ft³", factor: 62.427960841 } },
  alpha: { SI: { label: "10⁻⁶/°C", factor: 1e6 }, imperial: { label: "10⁻⁶/°F", factor: 1e6 / 1.8 } },
  tempDelta: { SI: { label: "°C", factor: 1 }, imperial: { label: "°F", factor: 1.8 } },
  gradient: { SI: { label: "°C/m", factor: 1 }, imperial: { label: "°F/ft", factor: 1.8 * FT } },
  angle: { SI: { label: "°", factor: 180 / Math.PI }, imperial: { label: "°", factor: 180 / Math.PI } },
  factor: { SI: { label: "", factor: 1 }, imperial: { label: "", factor: 1 } },
};

/** SI → presentación. */
export const toDisplay = (q: Quantity, si: number, sys: UnitSystem): number => si * TABLE[q][sys].factor;
/** Presentación → SI. */
export const fromDisplay = (q: Quantity, shown: number, sys: UnitSystem): number => shown / TABLE[q][sys].factor;
export const unitLabel = (q: Quantity, sys: UnitSystem): string => TABLE[q][sys].label;

/** Texto de un número en la unidad de presentación (hasta 6 cifras significativas, sin ceros finales). */
export function formatQuantity(q: Quantity, si: number, sys: UnitSystem): string {
  return formatPlain(toDisplay(q, si, sys));
}

export function formatPlain(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return Number(v.toPrecision(6)).toExponential().replace("e+", "e");
  return String(Number(v.toPrecision(6)));
}

/**
 * Lee un número escrito por el usuario. Admite coma decimal ("1,5") y espacios; rechaza vacíos, texto y no finitos.
 * Devuelve null si no es un número válido.
 */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "").replace(",", ".");
  if (t === "" || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
