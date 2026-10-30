/**
 * Casos 3D (PENDIENTES DE SOLVER 3D; la referencia si esta autoverificada).
 *
 * E4 (ADR-001): viga horizontal biapoyada L con rotation = pi/2: ejes locales y' = +Z, z' = -Y globales.
 * Carga global [0, 0, -w] => wy' = -w, wz' = 0. Flexion en el plano x-y local con Iz (Iy no interviene).
 * Derivacion: dVy/dx = -wy = +w ; dMz/dx = -Vy ; Mz = EIz * dtheta_z/dx = EIz * uy''.
 *   R = wL/2 : Vy(x) = w x - wL/2 ; Mz(x) = -w x^2/2 + wL x/2 (Mz(L/2) = +wL^2/8, presentacion M = Mz).
 *   uy'' = Mz/EIz => uy(x) = -w x (L^3 - 2 L x^2 + x^3)/(24 EIz) ; el desplazamiento global uz = uy (y' = +Z).
 * Reacciones: +wL/2 en Z (indice 2) en ambos apoyos. N = Vz = My = T = 0.
 */
import type { Dof6 } from "./types";
import { dof } from "./types";

export interface RotatedBeamRef {
  id: string;
  length: number;
  reactions: { x: number; R: Dof6 }[];
  /** Esfuerzos crudos locales en x. */
  forces: (x: number) => { Vy: number; Mz: number };
  /** Desplazamiento transversal local uy (= desplazamiento global en Z). */
  uy: (x: number) => number;
}

export function rotatedBeamUdl(p: { L: number; w: number; EIz: number }): RotatedBeamRef {
  const { L, w, EIz } = p;
  return {
    id: "E4",
    length: L,
    reactions: [
      { x: 0, R: dof(0, 0, (w * L) / 2) },
      { x: L, R: dof(0, 0, (w * L) / 2) },
    ],
    forces: (x) => ({ Vy: w * x - (w * L) / 2, Mz: (-w * x * x) / 2 + (w * L * x) / 2 }),
    uy: (x) => (-w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EIz),
  };
}
