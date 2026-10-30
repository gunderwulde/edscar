/**
 * Tipos del banco de referencia analitica (sin dependencias de @edscar/*).
 * Todo en SI (m, kN, kN*m, rad). Convencion de ejes y signos: ADR-001.
 * Valores "crudos" del ADR-001 seccion 6; la presentacion (seccion 7) se obtiene con `present`.
 */

/** [ux, uy, uz, rx, ry, rz] (ADR-001 seccion 4). */
export type Dof6 = readonly [number, number, number, number, number, number];

export const dof = (ux = 0, uy = 0, uz = 0, rx = 0, ry = 0, rz = 0): Dof6 => [ux, uy, uz, rx, ry, rz];

/** "left" = limite x- ; "right" = limite x+ (ADR-001 6.1). */
export type Side = "left" | "right";

/** Esfuerzos crudos en el plano x-z local. Vy, T, Mz valen 0 en todos los casos planos. */
export interface Forces {
  N: number;
  Vz: number;
  My: number;
}

/** Presentacion ADR-001 seccion 7: V = -Vz, M = -My. */
export interface Presentation {
  N: number;
  V: number;
  M: number;
}

export const present = (f: Forces): Presentation => ({ N: f.N, V: -f.Vz, M: -f.My });

/** Resultado de referencia para una barra (o una linea de barras) de eje x. */
export interface BeamRef {
  /** Identificador del caso (E1, E2...). */
  id: string;
  length: number;
  /** Reacciones en ejes globales en la abscisa x (apoyos). */
  reactions: { x: number; R: Dof6 }[];
  /** Esfuerzos crudos locales en la abscisa global x del eje (side en discontinuidades). */
  forces: (x: number, side?: Side) => Forces;
  /** Flecha local uz (m); positiva hacia +z. */
  uz: (x: number) => number;
  /** Giro thetaY = -duz/dx (rad). */
  thetaY: (x: number) => number;
  /** Desplazamiento axial ux (m); si se omite, se supone 0 donde se pida. */
  ux?: (x: number) => number;
  /** Abscisas interiores con discontinuidad de esfuerzos (cargas puntuales). Los apoyos no cuentan. */
  jumps: number[];
}

/** Referencia por barra de un caso general (porticos, cerchas, pilares). */
export interface MemberRef {
  length: number;
  forces: (x: number, side?: Side) => Forces;
  jumps: number[];
}

export interface CaseRef {
  id: string;
  /** Reacciones por nudo, ejes globales. */
  reactions: Record<string, Dof6>;
  members: Record<string, MemberRef>;
  /** Desplazamientos nodales esperados (solo los componentes dados). */
  nodeDisp: Record<string, Partial<{ ux: number; uz: number; ry: number }>>;
}

/** Fuerzas de extremo (nudo sobre barra, locales) a partir de los esfuerzos (ADR-001 6.2). */
export function endForcesFromSections(
  f0: Forces,
  fL: Forces,
): { i: Dof6; j: Dof6 } {
  return {
    i: [0 - f0.N, 0, 0 - f0.Vz, 0, 0 - f0.My, 0],
    j: [fL.N, 0, fL.Vz, 0, fL.My, 0],
  };
}

/** Polinomios c0 + c1 x + c2 x^2 ... (integracion exacta; sin metodos numericos). */
export type Poly = readonly number[];
export const evalPoly = (p: Poly, x: number): number => p.reduceRight((acc, c) => acc * x + c, 0);
export const integratePoly = (p: Poly): Poly => [0, ...p.map((c, k) => c / (k + 1))];
export const derivePoly = (p: Poly): Poly => p.slice(1).map((c, k) => c * (k + 1));
export const scalePoly = (p: Poly, s: number): Poly => p.map((c) => c * s);
