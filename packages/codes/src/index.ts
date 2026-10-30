/**
 * @edscar/codes — datos normativos (Eurocódigos + Anexos Nacionales) como datos con cita.
 * M0: solo contrato de tipos. No depende de otros paquetes @edscar.
 */
export const PACKAGE_NAME = "@edscar/codes";

/** Todo valor normativo lleva cita (CLAUDE.md regla 4). */
export interface Citation { standard: string; edition: string; clause: string }
export interface CitedValue<T> { value: T; citation: Citation; unverified?: boolean }

export interface NationalAnnex {
  /** Identificador usado en `Project.settings.codeId`, p. ej. "EN-recommended". */
  id: string;
  country: string;
  /** Expresión de combinación ELU elegida (EN 1990 6.10 o 6.10a/b). */
  uls: CitedValue<"6.10" | "6.10a/b">;
  gammaG: CitedValue<number>;
  gammaQ: CitedValue<number>;
  /** psi0/psi1/psi2 por clave de categoría de acción. */
  psi: Record<string, { psi0: CitedValue<number>; psi1: CitedValue<number>; psi2: CitedValue<number> }>;
}
