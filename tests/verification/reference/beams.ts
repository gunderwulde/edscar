/**
 * Soluciones analiticas de vigas rectas horizontales (x = +X, z = +Z arriba, y = +Y; ADR-001 seccion 3).
 * Cargas dadas como magnitudes positivas "hacia abajo" (wz = -q). Valores crudos del ADR (seccion 6):
 *   dVz/dx = -wz = +q ,  dMy/dx = Vz ,  My = EI * dtheta/dx ,  theta = -duz/dx  =>  EI*uz'' = -My.
 * Fuentes: resistencia de materiales clasica (Euler-Bernoulli) y ADR-001 (E1, E2, E3, seccion 6.2, 5.1);
 * cada formula se re-deriva en el comentario y se comprueba en reference.test.ts.
 */
import type { BeamRef, Forces, Poly, Side } from "./types";
import { dof, evalPoly, integratePoly, scalePoly } from "./types";

const EPS = 1e-9;
const isLeft = (x: number, x0: number, side?: Side): boolean =>
  x < x0 - EPS || (Math.abs(x - x0) <= EPS && side === "left");

/**
 * E1 (ADR-001): biapoyada, carga uniforme q hacia abajo.
 * Derivacion: R = qL/2. Vz(x) = -R + q x. My(x) = -R x + q x^2/2 (My(0)=0).
 * EI uz'' = -My -> uz' = -(q x^3/6 - R x^2/2)/EI + c1; uz(0)=uz(L)=0 =>
 * uz(x) = -q x (L^3 - 2 L x^2 + x^3)/(24 EI);  theta = -uz' = q (L^3 - 6 L x^2 + 4 x^3)/(24 EI).
 * Centro: uz(L/2) = -5 q L^4/(384 EI); My(L/2) = -q L^2/8 (presentacion M = +qL^2/8).
 */
export function simplySupportedUdl(p: { L: number; q: number; EI: number }): BeamRef {
  const { L, q, EI } = p;
  const R = (q * L) / 2;
  return {
    id: "E1",
    length: L,
    reactions: [
      { x: 0, R: dof(0, 0, R) },
      { x: L, R: dof(0, 0, R) },
    ],
    forces: (x) => ({ N: 0, Vz: q * x - R, My: (q * x * x) / 2 - R * x }),
    uz: (x) => (-q * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI),
    thetaY: (x) => (q * (L ** 3 - 6 * L * x * x + 4 * x ** 3)) / (24 * EI),
    jumps: [],
  };
}

/**
 * Biapoyada con carga puntual P hacia abajo a distancia a del apoyo izquierdo (b = L - a).
 * Derivacion: R_A = P b/L, R_B = P a/L.
 *  x < a: Vz = -P b/L, My = -P b x/L.   x > a: Vz = +P a/L, My = -P a (L-x)/L. My(a) = -P a b/L.
 *  Flecha (x <= a): uz = -P b x (L^2 - b^2 - x^2)/(6 EI L)  (EI uz'' = -My = P b x/L, uz(0)=uz(L)=0).
 *  Tramo derecho por simetria con xi = L - x y a<->b: uz = -P a xi (L^2 - a^2 - xi^2)/(6 EI L).
 *  theta = -uz'. Centrada (a = L/2): uz(L/2) = -P L^3/(48 EI), My(L/2) = -P L/4.
 */
export function simplySupportedPoint(p: { L: number; a: number; P: number; EI: number; id?: string }): BeamRef {
  const { L, a, P, EI } = p;
  const b = L - a;
  return {
    id: p.id ?? "PUNT",
    length: L,
    reactions: [
      { x: 0, R: dof(0, 0, (P * b) / L) },
      { x: L, R: dof(0, 0, (P * a) / L) },
    ],
    forces: (x, side): Forces =>
      isLeft(x, a, side)
        ? { N: 0, Vz: (-P * b) / L, My: (-P * b * x) / L }
        : { N: 0, Vz: (P * a) / L, My: (-P * a * (L - x)) / L },
    uz: (x) => {
      if (x <= a) return (-P * b * x * (L * L - b * b - x * x)) / (6 * EI * L);
      const xi = L - x;
      return (-P * a * xi * (L * L - a * a - xi * xi)) / (6 * EI * L);
    },
    thetaY: (x) => {
      // theta = -uz'
      if (x <= a) return (P * b * (L * L - b * b - 3 * x * x)) / (6 * EI * L);
      const xi = L - x;
      return (-P * a * (L * L - a * a - 3 * xi * xi)) / (6 * EI * L);
    },
    jumps: [a],
  };
}

/**
 * E2 (ADR-001): voladizo empotrado en x=0, P hacia abajo en x=L.
 * Derivacion: Vz = -P; My(x) = P (L - x) (My(L)=0). Reaccion: Fz = +P, My global = -P L.
 * EI uz'' = -P (L - x) -> uz = -P x^2 (3L - x)/(6 EI); theta = -uz' = P x (2L - x)/(2 EI).
 * Punta: uz = -P L^3/(3 EI), theta = +P L^2/(2 EI).
 */
export function cantileverTip(p: { L: number; P: number; EI: number }): BeamRef {
  const { L, P, EI } = p;
  return {
    id: "E2",
    length: L,
    reactions: [{ x: 0, R: dof(0, 0, P, 0, -P * L, 0) }],
    forces: (x) => ({ N: 0, Vz: -P, My: P * (L - x) }),
    uz: (x) => (-P * x * x * (3 * L - x)) / (6 * EI),
    thetaY: (x) => (P * x * (2 * L - x)) / (2 * EI),
    jumps: [],
  };
}

/**
 * E3 (ADR-001): barra axial, i empotrado, fuerza F en +X aplicada en j (F<0 compresion).
 * N = F constante (tension positiva); ux = F x/(E A); reaccion en i: -F.
 */
export function axialBar(p: { L: number; F: number; EA: number }): BeamRef {
  const { L, F, EA } = p;
  return {
    id: "E3",
    length: L,
    reactions: [{ x: 0, R: dof(-F) }],
    forces: () => ({ N: F, Vz: 0, My: 0 }),
    uz: () => 0,
    thetaY: () => 0,
    ux: (x) => (F * x) / EA,
    jumps: [],
  };
}

/**
 * Biempotrada con carga uniforme q (ADR-001 6.2, empotramiento perfecto).
 * Derivacion: R = qL/2 por simetria; Vz = q x - qL/2. My(x) = q x^2/2 - qL x/2 + M0 con
 * theta(0)=theta(L)=0 => integral de My en [0, L] = 0 => M0 = qL^2/12.
 * My(0) = My(L) = +qL^2/12 (presentacion -qL^2/12), My(L/2) = -qL^2/24.
 * Reacciones de momento globales (eje y local = +Y): en x=0: -qL^2/12; en x=L: +qL^2/12.
 * uz = -q x^2 (L-x)^2/(24 EI); theta = q x (L-x)(L-2x)/(12 EI); uz(L/2) = -qL^4/(384 EI).
 */
export function fixedFixedUdl(p: { L: number; q: number; EI: number }): BeamRef {
  const { L, q, EI } = p;
  const M0 = (q * L * L) / 12;
  return {
    id: "BIEMP",
    length: L,
    reactions: [
      { x: 0, R: dof(0, 0, (q * L) / 2, 0, -M0, 0) },
      { x: L, R: dof(0, 0, (q * L) / 2, 0, M0, 0) },
    ],
    forces: (x) => ({ N: 0, Vz: q * x - (q * L) / 2, My: (q * x * x) / 2 - (q * L * x) / 2 + M0 }),
    uz: (x) => (-q * x * x * (L - x) ** 2) / (24 * EI),
    thetaY: (x) => (q * x * (L - x) * (L - 2 * x)) / (12 * EI),
    jumps: [],
  };
}

/**
 * Viga continua de 2 vanos iguales L con carga uniforme q (abscisa global x en [0, 2L]).
 * Derivacion (ecuacion de tres momentos con M_A = M_C = 0, vanos y EI iguales):
 *   2 M_B (L + L) = -q L^3/4 - q L^3/4 => |M_B| = q L^2/8 (hogging). Reacciones: A = C = 3qL/8, B = 10 qL/8.
 * Vano 1: Vz = q x - 3qL/8; My = q x^2/2 - 3qL x/8  (My(L) = +qL^2/8, presentacion -qL^2/8).
 * Maximo positivo (presentacion) en x = 3L/8: M = 9qL^2/128.
 * Flecha vano 1 (theta(L)=0 por simetria, uz(0)=uz(L)=0): uz = -q x (2x^3 - 3L x^2 + L^3)/(48 EI);
 *   theta = (q/EI)(x^3/6 - 3L x^2/16 + L^3/48).
 * Vano 2 (xi = x - L): espejo: Vz = q xi - 5qL/8; My = q xi^2/2 - 5qL xi/8 + qL^2/8;
 *   uz2(xi) = uz1(L - xi); theta2(xi) = -theta1(L - xi).
 */
export function twoSpanUdl(p: { L: number; q: number; EI: number }): BeamRef {
  const { L, q, EI } = p;
  const u1 = (x: number): number => (-q * x * (2 * x ** 3 - 3 * L * x * x + L ** 3)) / (48 * EI);
  const th1 = (x: number): number => (q / EI) * (x ** 3 / 6 - (3 * L * x * x) / 16 + L ** 3 / 48);
  return {
    id: "CONT2",
    length: 2 * L,
    reactions: [
      { x: 0, R: dof(0, 0, (3 * q * L) / 8) },
      { x: L, R: dof(0, 0, (10 * q * L) / 8) },
      { x: 2 * L, R: dof(0, 0, (3 * q * L) / 8) },
    ],
    forces: (x, side) => {
      if (isLeft(x, L, side)) return { N: 0, Vz: q * x - (3 * q * L) / 8, My: (q * x * x) / 2 - (3 * q * L * x) / 8 };
      const xi = x - L;
      return {
        N: 0,
        Vz: q * xi - (5 * q * L) / 8,
        My: (q * xi * xi) / 2 - (5 * q * L * xi) / 8 + (q * L * L) / 8,
      };
    },
    uz: (x) => (x <= L ? u1(x) : u1(2 * L - x)),
    thetaY: (x) => (x <= L ? th1(x) : -th1(2 * L - x)),
    jumps: [],
  };
}

/**
 * Biapoyada con carga trapezoidal que cubre todo el vano (a=0, b=L): q1 en x=0, q2 en x=L, hacia abajo.
 * Derivacion: q(x) = q1 + (q2-q1) x/L. Resultante W = (q1+q2) L/2.
 *   R_A = L (2 q1 + q2)/6, R_B = L (q1 + 2 q2)/6 (momentos respecto a los apoyos).
 *   Vz(x) = -R_A + q1 x + (q2-q1) x^2/(2L);  My(x) = -R_A x + q1 x^2/2 + (q2-q1) x^3/(6L).
 *   Flecha por doble integracion exacta de EI uz'' = -My con uz(0)=uz(L)=0.
 */
export function simplySupportedTrapezoid(p: { L: number; q1: number; q2: number; EI: number }): BeamRef {
  const { L, q1, q2, EI } = p;
  const RA = (L * (2 * q1 + q2)) / 6;
  const RB = (L * (q1 + 2 * q2)) / 6;
  const Vz: Poly = [-RA, q1, (q2 - q1) / (2 * L)];
  const My: Poly = [0, -RA, q1 / 2, (q2 - q1) / (6 * L)];
  const slope0: Poly = integratePoly(scalePoly(My, -1 / EI)); // uz' sin constante
  const g: Poly = integratePoly(slope0); // uz parcial con uz(0)=0
  const c1 = -evalPoly(g, L) / L;
  return {
    id: "TRAPEZ",
    length: L,
    reactions: [
      { x: 0, R: dof(0, 0, RA) },
      { x: L, R: dof(0, 0, RB) },
    ],
    forces: (x) => ({ N: 0, Vz: evalPoly(Vz, x), My: evalPoly(My, x) }),
    uz: (x) => evalPoly(g, x) + c1 * x,
    thetaY: (x) => -(evalPoly(slope0, x) + c1),
    jumps: [],
  };
}

/**
 * Viga continua de 2 vanos iguales sin cargas, con descenso delta del apoyo central B
 * (support-displacement d = [0, 0, -delta, 0, 0, 0]).
 * Derivacion: por simetria theta_B = 0. Cada vano es una viga empotrada en B (giro nulo) y apoyada en A
 * con desnivel delta: F = 3 EI delta/L^3 y M_B = 3 EI delta/L^2. Equilibrio: B se tira hacia abajo con 6EI delta/L^3
 * (rigidez de una viga de luz 2L con carga central: 48EI/(2L)^3 = 6EI/L^3), A y C empujan hacia arriba 3EI delta/L^3.
 * Reacciones: A = C = +3k ; B = -6k, con k = EI delta/L^3.
 * Vano 1: Vz = -3k; My = -3k x. uz = delta (x^3/(2L^3) - 3x/(2L)); theta = delta (3/(2L) - 3x^2/(2L^3)).
 * Vano 2 (espejo): Vz = +3k ; My = -3k (2L - x); uz2 = uz1(2L - x); theta2 = -theta1(2L - x).
 */
export function twoSpanSettlement(p: { L: number; EI: number; delta: number }): BeamRef {
  const { L, EI, delta } = p;
  const k = (EI * delta) / L ** 3;
  const u1 = (x: number): number => delta * (x ** 3 / (2 * L ** 3) - (3 * x) / (2 * L));
  const th1 = (x: number): number => delta * (3 / (2 * L) - (3 * x * x) / (2 * L ** 3));
  return {
    id: "ASENT",
    length: 2 * L,
    reactions: [
      { x: 0, R: dof(0, 0, 3 * k) },
      { x: L, R: dof(0, 0, -6 * k) },
      { x: 2 * L, R: dof(0, 0, 3 * k) },
    ],
    forces: (x, side) =>
      isLeft(x, L, side) ? { N: 0, Vz: -3 * k, My: -3 * k * x } : { N: 0, Vz: 3 * k, My: -3 * k * (2 * L - x) },
    uz: (x) => (x <= L ? u1(x) : u1(2 * L - x)),
    thetaY: (x) => (x <= L ? th1(x) : -th1(2 * L - x)),
    jumps: [],
  };
}

/**
 * Termica en barra biempotrada (ADR-001 5.1): N = E A (u' - alpha dT) con u = 0 => N = -E A alpha dT;
 * My = E Iy (theta' - alpha gradZ) con theta = 0 => My = -E Iy alpha gradZ (ADR). Vz = 0.
 * Reacciones globales (eje y local = +Y), de endForces (Fx_i = -N, My_i = -My(0), Fx_j = N, My_j = My(L)):
 * i: [ -N, 0, 0, 0, -My, 0 ]; j: [ N, 0, 0, 0, My, 0 ]. Desplazamientos y giros nulos.
 */
export function thermalFixedFixed(p: {
  L: number;
  EA: number;
  EIy: number;
  alpha: number;
  dT: number;
  gradZ: number;
}): BeamRef {
  const { L, EA, EIy, alpha, dT, gradZ } = p;
  const N = -EA * alpha * dT;
  const My = -EIy * alpha * gradZ;
  return {
    id: "TERM",
    length: L,
    reactions: [
      { x: 0, R: dof(-N, 0, 0, 0, -My, 0) },
      { x: L, R: dof(N, 0, 0, 0, My, 0) },
    ],
    forces: () => ({ N, Vz: 0, My }),
    uz: () => 0,
    thetaY: () => 0,
    ux: () => 0,
    jumps: [],
  };
}

/**
 * Peso propio: w = densidad [t/m3] * g [m/s2] * A [m2] en kN/m (t * m/s2 = kN), hacia -Z con gravity=[0,0,-g].
 * Equivale a E1 con q = w.
 */
export function selfWeightSimple(p: { L: number; rho: number; g: number; A: number; EI: number }): BeamRef {
  const q = p.rho * p.g * p.A;
  return { ...simplySupportedUdl({ L: p.L, q, EI: p.EI }), id: "PP" };
}
