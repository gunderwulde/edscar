/**
 * Porticos planos, cerchas y pilares: soluciones por formulas cerradas documentadas.
 * Plano X-Z con Z arriba (ADR-001). Barras horizontales: x=+X, y=+Y, z=+Z. Barras exactamente verticales
 * (x=+Z): z=+X, y=-Y (ADR-001 seccion 3).
 */
import type { CaseRef, Dof6, Forces, MemberRef } from "./types";
import { dof } from "./types";

/* ------------------------------------------------------------------------------------------------
 * Portico plano de un vano, bases empotradas, EI igual en las tres barras, axil rigido (idealizacion).
 *
 * Nudos: A=(0,0,0), N1=(0,0,h), N2=(L,0,h), B=(L,0,0). Barras: P1 A->N1, V N1->N2, P2 B->N2.
 * Cargas: H (kN, +X) en N1; w (kN/m, hacia -Z) sobre la viga V.
 *
 * Derivacion por pendiente-desplazamiento (momentos de extremo M_ij sobre la barra, positivos en sentido
 * horario con X a la derecha y Z arriba; el horario equivale a +Y global, por la regla de la mano derecha):
 *   M_ij = (2EI/l)(2 th_i + th_j - 3 psi) + FEM_ij ,  psi = giro de cuerda (horario +).
 *   Columnas: psi = D/h (D = desplazamiento lateral comun de N1 y N2, viga axialmente rigida).
 *   Viga: psi = 0 ; FEM_12 = -wL^2/12 , FEM_21 = +wL^2/12.
 *   Equilibrio de nudos: M_1A + M_12 = 0 ; M_2B + M_21 = 0.
 *   Cortante: H = -(M_A1 + M_1A + M_B2 + M_2B)/h.
 * Con k = h/L y f1 = h w L^2/(24 EI), sumando y restando las ecuaciones de nudo:
 *   th1 + th2 = 6 D/(h (2+3k)) ;  th1 - th2 = 2 f1/(2+k) ;
 *   D = H h^3 (2+3k)/(12 EI (1+6k)).
 * Comprobaciones limite: k->inf D = H h^3/(24 EI) (dos voladizos con H/2); k->0 D = H h^3/(6 EI).
 *
 * Esfuerzos (por equilibrio, ADR-001 6.2):
 *   Columnas (x local = +Z, y local = -Y): V_c = -(M_base + M_top)/h = Vz (constante);
 *     My(x) = M_base + V_c x (My(0) = M_base porque y local = -Y); N = N_c.
 *   Viga: Vz(x) = Vz0 + w x ; My(x) = -M_12 + Vz0 x + w x^2/2 ; Vz0 = (M_12 + M_21 - wL^2/2)/L ;
 *     N_v = V_1 - H (equilibrio horizontal del nudo N1).
 *   Axil de columnas: N_1 = Vz0 (nudo N1), N_2 = -(Vz0 + wL) (nudo N2). Reacciones verticales:
 *     R_A = -N_1, R_B = Vz0 + wL. Horizontales: -V_1, -V_2. Momentos de reaccion (Y global): M_A1, M_B2.
 * Hipotesis: la deformacion axil se desprecia; el modelo usa A grande (error relativo del orden de EI/(EA h^2)).
 * ------------------------------------------------------------------------------------------------ */
export function portalFrame(p: { h: number; L: number; EI: number; H: number; w: number }): CaseRef & {
  /** Magnitudes intermedias para autoconsistencia. */
  parts: { D: number; th1: number; th2: number; M_A1: number; M_1A: number; M_B2: number; M_2B: number; M_12: number; M_21: number };
} {
  const { h, L, EI, H, w } = p;
  const k = h / L;
  const D = (H * h ** 3 * (2 + 3 * k)) / (12 * EI * (1 + 6 * k));
  const f1 = (h * w * L * L) / (24 * EI);
  const S = (6 * D) / (h * (2 + 3 * k));
  const Dif = (2 * f1) / (2 + k);
  const th1 = (S + Dif) / 2;
  const th2 = (S - Dif) / 2;
  const c = (2 * EI) / h;
  const M_A1 = c * (th1 - (3 * D) / h);
  const M_1A = c * (2 * th1 - (3 * D) / h);
  const M_B2 = c * (th2 - (3 * D) / h);
  const M_2B = c * (2 * th2 - (3 * D) / h);
  const cb = (2 * EI) / L;
  const M_12 = cb * (2 * th1 + th2) - (w * L * L) / 12;
  const M_21 = cb * (2 * th2 + th1) + (w * L * L) / 12;

  const V1 = -(M_A1 + M_1A) / h;
  const V2 = -(M_B2 + M_2B) / h;
  const Vz0 = (M_12 + M_21 - (w * L * L) / 2) / L;
  const VzL = Vz0 + w * L;
  const N1 = Vz0;
  const N2 = -VzL;
  const Nv = V1 - H;

  const col = (Mb: number, V: number, N: number): MemberRef => ({
    length: h,
    forces: (x): Forces => ({ N, Vz: V, My: Mb + V * x }),
    jumps: [],
  });
  const beam: MemberRef = {
    length: L,
    forces: (x): Forces => ({ N: Nv, Vz: Vz0 + w * x, My: -M_12 + Vz0 * x + (w * x * x) / 2 }),
    jumps: [],
  };
  return {
    id: "PORT",
    reactions: {
      A: dof(-V1, 0, -N1, 0, M_A1, 0),
      B: dof(-V2, 0, VzL, 0, M_B2, 0),
    },
    members: { P1: col(M_A1, V1, N1), V: beam, P2: col(M_B2, V2, N2) },
    nodeDisp: {
      N1: { ux: D, uz: 0, ry: th1 },
      N2: { ux: D, uz: 0, ry: th2 },
    },
    parts: { D, th1, th2, M_A1, M_1A, M_B2, M_2B, M_12, M_21 },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Cercha triangular isostatica: A=(0,0,0) apoyo fijo (ux,uz), B=(L,0,0) rodillo (uz), C=(L/2,0,H) con
 * P hacia abajo. Barras biarticuladas AB (A->B), AC (A->C), BC (B->C). d = sqrt((L/2)^2 + H^2),
 * sin(al) = H/d, cos(al) = L/(2d), tan(al) = 2H/L.
 * Derivacion: R_A = R_B = P/2. Nudo C: 2 N_c sin(al) = -P  =>  N_AC = N_BC = -P/(2 sin al) (compresion).
 * Nudo A (horizontal): N_AB + N_AC cos(al) = 0  =>  N_AB = P/(2 tan al) (traccion).
 * Desplazamientos: ux_B = N_AB L/(EA) (A fijo); por simetria ux_C = ux_B/2; acortamiento de AC:
 *   dd = |N_AC| d/(EA) = u_C cos(al) + v_C sin(al) con signo (-dd) => v_C = (-dd - u_C cos(al))/sin(al).
 * (Se contrasta con el trabajo virtual en reference.test.ts: P*|v_C| = sum N^2 l/(EA).)
 * ------------------------------------------------------------------------------------------------ */
export function triangularTruss(p: { L: number; H: number; P: number; EA: number }): CaseRef & {
  parts: { N_AB: number; N_AC: number; dC: { ux: number; uz: number }; dB: number; d: number };
} {
  const { L, H, P, EA } = p;
  const d = Math.hypot(L / 2, H);
  const sn = H / d;
  const cs = L / 2 / d;
  const tn = sn / cs;
  const N_AC = -P / (2 * sn);
  const N_AB = P / (2 * tn);
  const uB = (N_AB * L) / EA;
  const uC = uB / 2;
  const dd = (Math.abs(N_AC) * d) / EA;
  const vC = (-dd - uC * cs) / sn;
  const bar = (len: number, N: number): MemberRef => ({
    length: len,
    forces: (): Forces => ({ N, Vz: 0, My: 0 }),
    jumps: [],
  });
  return {
    id: "CERCHA",
    reactions: { A: dof(0, 0, P / 2), B: dof(0, 0, P / 2) },
    members: { AB: bar(L, N_AB), AC: bar(d, N_AC), BC: bar(d, N_AC) },
    nodeDisp: { A: { ux: 0, uz: 0 }, B: { ux: uB, uz: 0 }, C: { ux: uC, uz: vC } },
    parts: { N_AB, N_AC, dC: { ux: uC, uz: vC }, dB: uB, d },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Pilar en voladizo casi vertical (salto de 180 grados en el eje local, ADR-001 seccion 3).
 * Barra de A=(0,0,0) a C=(H sin d, 0, H cos d), longitud H, empotrada en A, fuerza P en +X global en C.
 * Ejes locales por la regla del ADR: x = (s,0,c) (s=sin d, c=cos d).
 *   Si |x.Z| > 1 - 1e-9 (d = 0): z = +X, y = -Y.  Si no: z = Z - (Z.x)x normalizado = (-c, 0, s), y = z x x = +Y.
 * Carga en locales: P_x = P s, P_z = P (z.X) = P zx  (zx = +1 vertical exacto; -c inclinado).
 * Voladizo (flexion en x-z con Iy): Vz = P_z ; My(x) = P_z (x - H) (My(H) = 0 y dMy/dx = Vz) ; N = P_x.
 * uz_local(H) = P_z H^3/(3 EI) ; theta_y(H) = -P_z H^2/(2 EI) ; ux_local(H) = P_x H/(EA).
 * Globales en la punta: u = ux_l*x_hat + uz_l*z_hat ; ry = ySign * theta_y (ySign = y.Y = -1 vertical, +1 inclinado).
 * Reaccion en A: Fx = -P ; Fz = 0 ; My global = -P H c (momento de P respecto a A: r x F, Y: r_z F_x = H c P).
 * Con d=0: My(0) = -P H ; con d=1e-4: My(0) = +P H c  => My local de signo opuesto (el aviso del ADR).
 * ------------------------------------------------------------------------------------------------ */
export function localBasisInPlane(delta: number): {
  xhat: readonly [number, number];
  zhat: readonly [number, number];
  ySign: 1 | -1;
} {
  const s = Math.sin(delta);
  const c = Math.cos(delta);
  const xhat: readonly [number, number] = [s, c]; // (X, Z)
  if (Math.abs(c) > 1 - 1e-9) {
    return { xhat, zhat: [1, 0], ySign: -1 };
  }
  return { xhat, zhat: [-c, s], ySign: 1 };
}

export function slantedColumn(p: { H: number; P: number; EI: number; EA: number; delta: number }): CaseRef & {
  parts: { Pz: number; Px: number; ySign: 1 | -1; zhat: readonly [number, number] };
} {
  const { H, P, EI, EA, delta } = p;
  const c = Math.cos(delta);
  const { xhat, zhat, ySign } = localBasisInPlane(delta);
  const Px = P * xhat[0]; // P . xhat (P = (P, 0))
  const Pz = P * zhat[0];
  const uzl = (Pz * H ** 3) / (3 * EI);
  const thy = (-Pz * H * H) / (2 * EI);
  const uxl = (Px * H) / EA;
  const tip = {
    ux: uxl * xhat[0] + uzl * zhat[0],
    uz: uxl * xhat[1] + uzl * zhat[1],
    ry: ySign * thy,
  };
  const member: MemberRef = {
    length: H,
    forces: (x: number): Forces => ({ N: Px, Vz: Pz, My: Pz * (x - H) }),
    jumps: [],
  };
  const reactions: Dof6 = dof(-P, 0, 0, 0, -P * H * c, 0);
  return {
    id: delta === 0 ? "PILAR0" : "PILARD",
    reactions: { A: reactions },
    members: { C1: member },
    nodeDisp: { T: tip },
    parts: { Pz, Px, ySign, zhat },
  };
}
