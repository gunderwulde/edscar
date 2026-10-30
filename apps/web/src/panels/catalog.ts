/**
 * Valores por defecto ORIENTATIVOS de materiales y secciones (no normativos: comprobar siempre con la ficha del
 * fabricante o las tablas de la norma de producto). Todo en SI (kN/m², t/m³, 1/°C, m², m⁴).
 */
import type { Material, Section } from "@edscar/model";
import type { MessageKey } from "./i18n";

export interface MaterialPreset { key: string; nameKey: MessageKey; values: Omit<Material, "id"> }
export interface SectionPreset { key: string; name: string; values: Omit<Section, "id"> }

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  { key: "steel", nameKey: "mat.steel", values: { name: "Acero S275 (E = 210 GPa)", E: 210e6, G: 80.8e6, density: 7.85, alpha: 1.2e-5 } },
  { key: "concrete", nameKey: "mat.concrete", values: { name: "Hormigón C30/37 (Ecm ≈ 33 GPa)", E: 33e6, G: 13.75e6, density: 2.5, alpha: 1e-5 } },
  { key: "timber", nameKey: "mat.timber", values: { name: "Madera C24 (E0,mean ≈ 11 GPa)", E: 11e6, G: 0.69e6, density: 0.42, alpha: 5e-6 } },
];

const cm2 = 1e-4;
const cm4 = 1e-8;
export const SECTION_PRESETS: readonly SectionPreset[] = [
  { key: "IPE200", name: "IPE 200 (orientativa)", values: { name: "IPE 200 (orientativa)", A: 28.5 * cm2, Iy: 1943 * cm4, Iz: 142 * cm4, J: 7 * cm4 } },
  { key: "IPE300", name: "IPE 300 (orientativa)", values: { name: "IPE 300 (orientativa)", A: 53.8 * cm2, Iy: 8356 * cm4, Iz: 604 * cm4, J: 20.1 * cm4 } },
  { key: "HEB200", name: "HEB 200 (orientativa)", values: { name: "HEB 200 (orientativa)", A: 78.1 * cm2, Iy: 5696 * cm4, Iz: 2003 * cm4, J: 59.5 * cm4 } },
];

/**
 * Sección rectangular b (ancho, eje local y) × h (canto, eje local z). Iy = b h³/12 (flexión en el plano x–z),
 * Iz = h b³/12 y J ≈ a c³ (1/3 − 0,21 (c/a)(1 − c⁴/(12 a⁴))) con a = máx(b, h), c = mín(b, h) (fórmula aproximada
 * habitual de torsión de Saint-Venant para rectángulos macizos).
 */
export function rectangularSection(b: number, h: number): Omit<Section, "id"> {
  const a = Math.max(b, h);
  const c = Math.min(b, h);
  return {
    name: `Rectangular ${String(Math.round(b * 1000))}×${String(Math.round(h * 1000))} mm`,
    A: b * h,
    Iy: (b * h ** 3) / 12,
    Iz: (h * b ** 3) / 12,
    J: a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4))),
  };
}
