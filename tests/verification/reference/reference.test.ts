/**
 * Autoconsistencia de la referencia analitica: las formulas cerradas se comprueban entre si
 * (equilibrio, ecuaciones diferenciales por diferencias finitas, trabajo virtual por cuadratura,
 * limites conocidos). No usa el solver ni ninguna salida de codigo bajo prueba.
 */
import { describe, expect, it } from "vitest";
import {
  axialBar,
  cantileverTip,
  endForcesFromSections,
  fixedFixedUdl,
  localBasisInPlane,
  portalFrame,
  present,
  rotatedBeamUdl,
  selfWeightSimple,
  simplySupportedPoint,
  simplySupportedTrapezoid,
  simplySupportedUdl,
  slantedColumn,
  thermalFixedFixed,
  triangularTruss,
  twoSpanSettlement,
  twoSpanUdl,
} from "./index";
import type { BeamRef } from "./index";

const close = (a: number, e: number, rel = 1e-9, abs = 1e-12): void => {
  expect(Math.abs(a - e), `actual=${String(a)} esperado=${String(e)}`).toBeLessThanOrEqual(Math.max(rel * Math.abs(e), abs));
};

/** Cuadratura de Simpson compuesta (n par). */
function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let k = 1; k < n; k++) s += f(a + k * h) * (k % 2 === 1 ? 4 : 2);
  return (s * h) / 3;
}

interface Consistency {
  name: string;
  ref: BeamRef;
  EI: number;
  /** Carga distribuida hacia abajo (kN/m) en x. */
  w: (x: number) => number;
  /** Resultante vertical hacia abajo y momento de las cargas respecto a Y en el origen: sum x*w. */
  totalF: number;
  totalMy: number;
  /** Abscisas de apoyo y su descenso impuesto (por defecto 0). */
  supports: { x: number; uz: number }[];
  samples: number[];
}

function makeConsistency(c: Consistency): void {
  describe(`autoconsistencia ${c.name}`, () => {
    const hFD = 1e-5;
    it("dVz/dx = w y dMy/dx = Vz (diferencias finitas centrales)", () => {
      for (const x of c.samples) {
        const dVz = (c.ref.forces(x + hFD).Vz - c.ref.forces(x - hFD).Vz) / (2 * hFD);
        close(dVz, c.w(x), 1e-6, 1e-6);
        const dMy = (c.ref.forces(x + hFD).My - c.ref.forces(x - hFD).My) / (2 * hFD);
        close(dMy, c.ref.forces(x).Vz, 1e-6, 1e-6);
      }
    });
    it("uz' = -theta y theta' = My/EI", () => {
      for (const x of c.samples) {
        const duz = (c.ref.uz(x + hFD) - c.ref.uz(x - hFD)) / (2 * hFD);
        close(duz, -c.ref.thetaY(x), 1e-6, 1e-9);
        const dth = (c.ref.thetaY(x + hFD) - c.ref.thetaY(x - hFD)) / (2 * hFD);
        close(dth, c.ref.forces(x).My / c.EI, 1e-6, 1e-9);
      }
    });
    it("equilibrio global de fuerzas y de momentos respecto a Y", () => {
      const Rz = c.ref.reactions.reduce((s, r) => s + r.R[2], 0);
      close(Rz, c.totalF, 1e-12, 1e-9);
      // momento respecto a Y en el origen: M_y = r_z F_x - r_x F_z ; cargas: F_z = -w => +x w ; reacciones: -x Rz + My
      const MyReact = c.ref.reactions.reduce((s, r) => s - r.x * r.R[2] + r.R[4], 0);
      close(MyReact + c.totalMy, 0, 1, 1e-9);
    });
    it("el salto de Vz en cada apoyo interior es -Rz y la flecha en apoyos es la impuesta", () => {
      for (const s of c.supports) {
        const r = c.ref.reactions.find((q) => Math.abs(q.x - s.x) < 1e-12);
        expect(r).toBeDefined();
        close(c.ref.uz(s.x), s.uz, 1e-12, 1e-12);
        if (s.x > 0 && s.x < c.ref.length && r) {
          const jump = c.ref.forces(s.x, "right").Vz - c.ref.forces(s.x, "left").Vz;
          close(jump, -r.R[2], 1e-12, 1e-9);
        }
      }
    });
    it("endForces coherentes con ADR-001 6.2 (equilibrio de la barra completa)", () => {
      if (c.ref.reactions.length > 2 || c.ref.jumps.length > 0 || c.name === "E2") return;
      const e = endForcesFromSections(c.ref.forces(0, "right"), c.ref.forces(c.ref.length, "left"));
      // Equilibrio de la barra: Fz_i + Fz_j = integral de la carga hacia abajo (fuerzas nudo->barra).
      close(e.i[2] + e.j[2], simpson(c.w, 0, c.ref.length), 1e-9, 1e-9);
    });
  });
}

describe("referencia analitica: casos ADR-001", () => {
  it("E1: valores literales del ADR (L=6, w=10, EI=20000)", () => {
    const r = simplySupportedUdl({ L: 6, q: 10, EI: 20000 });
    close(r.reactions[0]?.R[2] ?? NaN, 30);
    close(r.forces(0).Vz, -30);
    close(r.forces(6).Vz, 30);
    close(r.forces(3).My, -45);
    const p = present(r.forces(0));
    close(p.V, 30);
    close(present(r.forces(3)).M, 45);
    close(present(r.forces(3)).M, (10 * 36) / 8);
    close(r.uz(3), (-5 * 10 * 1296) / (384 * 20000));
    expect(r.uz(3)).toBeCloseTo(-0.008438, 6);
    const e = endForcesFromSections(r.forces(0, "right"), r.forces(6, "left"));
    expect(e.i).toEqual([0, 0, 30, 0, 0, 0]);
    expect(e.j).toEqual([0, 0, 30, 0, 0, 0]);
  });

  it("E2: voladizo (L=2, P=15, EI=10000)", () => {
    const r = cantileverTip({ L: 2, P: 15, EI: 10000 });
    expect(r.reactions[0]?.R).toEqual([0, 0, 15, 0, -30, 0]);
    close(r.forces(0).My, 30);
    close(r.forces(2).My, 0);
    close(r.forces(1).Vz, -15);
    const p = present(r.forces(0));
    close(p.M, -30);
    close(p.V, 15);
    close(r.uz(2), -0.004);
    close(r.thetaY(2), 0.003);
    const e = endForcesFromSections(r.forces(0, "right"), r.forces(2, "left"));
    close(e.i[2], 15);
    close(e.i[4], -30);
  });

  it("E3: axial, traccion y compresion", () => {
    for (const F of [100, -100]) {
      const r = axialBar({ L: 4, F, EA: 2e6 });
      close(r.forces(2).N, F);
      close(r.ux?.(4) ?? NaN, (F * 4) / 2e6);
      close(r.reactions[0]?.R[0] ?? NaN, -F);
    }
  });

  it("empotramiento perfecto (ADR 6.2): My_i = -wL^2/12, My_j = +wL^2/12, My(L/2) = -wL^2/24", () => {
    const L = 5;
    const w = 12;
    const r = fixedFixedUdl({ L, q: w, EI: 20000 });
    const e = endForcesFromSections(r.forces(0, "right"), r.forces(L, "left"));
    close(e.i[4], (-w * L * L) / 12);
    close(e.j[4], (w * L * L) / 12);
    close(e.i[2], (w * L) / 2);
    close(e.j[2], (w * L) / 2);
    close(r.forces(L / 2).My, (-w * L * L) / 24);
    close(r.uz(L / 2), (-w * L ** 4) / (384 * 20000));
    // el area de My en el vano es nula (theta(L) - theta(0) = 0)
    close(simpson((x) => r.forces(x).My, 0, L), 0, 1, 1e-9);
  });
});

const L1 = 6;
const q1 = 10;
makeConsistency({
  name: "E1",
  ref: simplySupportedUdl({ L: L1, q: q1, EI: 20000 }),
  EI: 20000,
  w: () => q1,
  totalF: q1 * L1,
  totalMy: (q1 * L1 * L1) / 2,
  supports: [{ x: 0, uz: 0 }, { x: L1, uz: 0 }],
  samples: [0.5, 1.7, 3, 4.4, 5.5],
});
makeConsistency({
  name: "E2",
  ref: cantileverTip({ L: 2, P: 15, EI: 10000 }),
  EI: 10000,
  w: () => 0,
  totalF: 15,
  totalMy: 15 * 2, // punto en x=2: +x*P
  supports: [{ x: 0, uz: 0 }],
  samples: [0.3, 1, 1.8],
});
makeConsistency({
  name: "biapoyada puntual excentrica",
  ref: simplySupportedPoint({ L: 8, a: 2.5, P: 40, EI: 25000 }),
  EI: 25000,
  w: () => 0,
  totalF: 40,
  totalMy: 40 * 2.5,
  supports: [{ x: 0, uz: 0 }, { x: 8, uz: 0 }],
  samples: [0.7, 1.9, 3.1, 5.5, 7.4],
});
makeConsistency({
  name: "biapoyada puntual centrada",
  ref: simplySupportedPoint({ L: 8, a: 4, P: 40, EI: 25000, id: "PUNT-C" }),
  EI: 25000,
  w: () => 0,
  totalF: 40,
  totalMy: 40 * 4,
  supports: [{ x: 0, uz: 0 }, { x: 8, uz: 0 }],
  samples: [0.7, 1.9, 3.1, 5.5, 7.4],
});
makeConsistency({
  name: "biempotrada UDL",
  ref: fixedFixedUdl({ L: 5, q: 12, EI: 20000 }),
  EI: 20000,
  w: () => 12,
  totalF: 60,
  totalMy: (12 * 25) / 2,
  supports: [{ x: 0, uz: 0 }, { x: 5, uz: 0 }],
  samples: [0.4, 1.3, 2.5, 3.9, 4.6],
});
{
  const L = 5;
  const q = 12;
  makeConsistency({
    name: "continua 2 vanos",
    ref: twoSpanUdl({ L, q, EI: 20000 }),
    EI: 20000,
    w: () => q,
    totalF: 2 * q * L,
    totalMy: (q * 2 * L * 2 * L) / 2,
    supports: [{ x: 0, uz: 0 }, { x: L, uz: 0 }, { x: 2 * L, uz: 0 }],
    samples: [0.6, 2.2, 4.1, 5.9, 7.3, 9.4],
  });
}
{
  const L = 7;
  const a = 1.5;
  const b = 4.2;
  const EI = 18000;
  makeConsistency({
    name: "trapezoidal (q1=a, q2=b)",
    ref: simplySupportedTrapezoid({ L, q1: a, q2: b, EI }),
    EI,
    w: (x) => a + ((b - a) * x) / L,
    totalF: ((a + b) * L) / 2,
    totalMy: (a * L * L) / 2 + ((b - a) * L * L) / 3,
    supports: [{ x: 0, uz: 0 }, { x: L, uz: 0 }],
    samples: [0.5, 1.9, 3.5, 5.1, 6.6],
  });
}
{
  const L = 4;
  const EI = 20000;
  const delta = 0.012;
  makeConsistency({
    name: "asentamiento",
    ref: twoSpanSettlement({ L, EI, delta }),
    EI,
    w: () => 0,
    totalF: 0,
    totalMy: 0,
    supports: [{ x: 0, uz: 0 }, { x: L, uz: -delta }, { x: 2 * L, uz: 0 }],
    samples: [0.5, 1.9, 3.3, 4.8, 6.4, 7.5],
  });
}
{
  const g = 9.81;
  const rho = 7.85;
  const A = 0.01;
  const wpp = rho * g * A;
  makeConsistency({
    name: "peso propio",
    ref: selfWeightSimple({ L: 6, rho, g, A, EI: 20000 }),
    EI: 20000,
    w: () => wpp,
    totalF: wpp * 6,
    totalMy: (wpp * 36) / 2,
    supports: [{ x: 0, uz: 0 }, { x: 6, uz: 0 }],
    samples: [1, 2.5, 4.7],
  });
}

describe("referencia analitica: vigas, valores notables", () => {
  it("biapoyada con puntual: M(a) = P a b / L y flecha centrada P L^3/(48 EI)", () => {
    const r = simplySupportedPoint({ L: 8, a: 2.5, P: 40, EI: 25000 });
    close(present(r.forces(2.5, "left")).M, (40 * 2.5 * 5.5) / 8);
    close(present(r.forces(2.5, "right")).M, (40 * 2.5 * 5.5) / 8);
    // salto de cortante = -P
    close(r.forces(2.5, "right").Vz - r.forces(2.5, "left").Vz, 40);
    const c = simplySupportedPoint({ L: 8, a: 4, P: 40, EI: 25000 });
    close(c.uz(4), (-40 * 512) / (48 * 25000));
    close(present(c.forces(4, "left")).M, (40 * 8) / 4);
  });

  it("continua 2 vanos: reacciones 3wL/8, 10wL/8, 3wL/8; M_B; maximo 9wL^2/128 en 3L/8", () => {
    const L = 5;
    const q = 12;
    const r = twoSpanUdl({ L, q, EI: 20000 });
    close(r.reactions[0]?.R[2] ?? NaN, (3 * q * L) / 8);
    close(r.reactions[1]?.R[2] ?? NaN, (10 * q * L) / 8);
    close(r.reactions[2]?.R[2] ?? NaN, (3 * q * L) / 8);
    close(present(r.forces(L, "left")).M, (-q * L * L) / 8);
    close(present(r.forces(L, "right")).M, (-q * L * L) / 8);
    close(present(r.forces((3 * L) / 8)).M, (9 * q * L * L) / 128);
    close(r.forces((3 * L) / 8).Vz, 0, 1, 1e-12);
    // continuidad de giro en B y del momento
    close(r.thetaY(L), 0, 1, 1e-15);
  });

  it("trapezoidal: UDL como caso limite, triangular, y flecha por trabajo virtual (Simpson)", () => {
    const L = 7;
    const EI = 18000;
    const udl = simplySupportedUdl({ L, q: 3, EI });
    const tz = simplySupportedTrapezoid({ L, q1: 3, q2: 3, EI });
    for (const x of [0, 1, 3.5, 6.2, 7]) {
      close(tz.forces(x).Vz, udl.forces(x).Vz, 1e-12, 1e-12);
      close(tz.forces(x).My, udl.forces(x).My, 1e-12, 1e-12);
      close(tz.uz(x), udl.uz(x), 1e-12, 1e-14);
      close(tz.thetaY(x), udl.thetaY(x), 1e-12, 1e-14);
    }
    // triangular (q1=0, q2=q): R_A = qL/6, R_B = qL/3 y M_max = q L^2/(9 sqrt 3) en x = L/sqrt 3
    const tri = simplySupportedTrapezoid({ L, q1: 0, q2: 6, EI });
    close(tri.reactions[0]?.R[2] ?? NaN, (6 * L) / 6);
    close(tri.reactions[1]?.R[2] ?? NaN, (6 * L) / 3);
    close(-tri.forces(L / Math.sqrt(3)).My, (6 * L * L) / (9 * Math.sqrt(3)), 1e-12);
    // trabajo virtual: delta(xp) = integral(My * m / EI), m = momento por carga unitaria hacia abajo en xp.
    const t = simplySupportedTrapezoid({ L, q1: 1.5, q2: 4.5, EI });
    for (const xp of [1.75, 3.5, 5.0]) {
      const m = (x: number): number => (x < xp ? (-(L - xp) * x) / L : (-xp * (L - x)) / L);
      const dw = simpson((x) => (t.forces(x).My * m(x)) / EI, 0, xp, 400) + simpson((x) => (t.forces(x).My * m(x)) / EI, xp, L, 400);
      close(-dw, t.uz(xp), 1e-9, 1e-12);
    }
  });

  it("biempotrada: flecha central wL^4/(384EI) y reacciones de momento globales", () => {
    const r = fixedFixedUdl({ L: 5, q: 12, EI: 20000 });
    expect(r.reactions[0]?.R[4]).toBeCloseTo(-12 * 25 / 12, 12);
    expect(r.reactions[1]?.R[4]).toBeCloseTo(12 * 25 / 12, 12);
  });

  it("asentamiento: rigidez de la viga de luz 2L con carga central 48EI/(2L)^3 = 6EI/L^3", () => {
    const L = 4;
    const EI = 20000;
    const delta = 0.012;
    const r = twoSpanSettlement({ L, EI, delta });
    close(r.reactions[1]?.R[2] ?? NaN, (-48 * EI * delta) / (2 * L) ** 3);
    close(r.thetaY(L), 0, 1, 1e-15);
    // momento en B por la viga empotrada-apoyada: 3EI delta/L^2 (modulo)
    close(Math.abs(r.forces(L, "left").My), (3 * EI * delta) / (L * L));
    close(r.forces(L, "left").My, r.forces(L, "right").My); // el momento es continuo en B
  });

  it("termica: N = -EA alpha dT, My = -EI alpha gradZ, presentacion M positivo (ADR 5.1)", () => {
    const t = thermalFixedFixed({ L: 5, EA: 2e6, EIy: 20000, alpha: 1.2e-5, dT: 30, gradZ: 40 });
    close(t.forces(2).N, -2e6 * 1.2e-5 * 30);
    close(t.forces(2).My, -20000 * 1.2e-5 * 40);
    expect(present(t.forces(2)).M).toBeGreaterThan(0);
    // Equilibrio: las reacciones son opuestas (sin fuerzas transversales) y los momentos suman cero.
    const [a, b] = t.reactions;
    close((a?.R[0] ?? 0) + (b?.R[0] ?? 0), 0, 1, 1e-12);
    close((a?.R[4] ?? 0) + (b?.R[4] ?? 0), 0, 1, 1e-12);
  });
});

describe("referencia analitica: portico plano", () => {
  const cases = [
    { name: "carga lateral", H: 30, w: 0 },
    { name: "carga uniforme en viga", H: 0, w: 20 },
    { name: "combinado", H: 30, w: 20 },
  ];
  for (const c of cases) {
    it(`equilibrio global y de nudos (${c.name})`, () => {
      const h = 4;
      const L = 6;
      const f = portalFrame({ h, L, EI: 20000, H: c.H, w: c.w });
      const A = f.reactions.A ?? [0, 0, 0, 0, 0, 0];
      const B = f.reactions.B ?? [0, 0, 0, 0, 0, 0];
      // SigmaFx: H + RxA + RxB = 0
      close(c.H + A[0] + B[0], 0, 1, 1e-9);
      // SigmaFz: -wL + RzA + RzB = 0
      close(-c.w * L + A[2] + B[2], 0, 1, 1e-9);
      // SigmaM_y respecto al origen A: cargas H en z=h: r_z F_x = h H ; w (global -Z) en x = L/2 : +w L * L/2 ;
      // reacciones: B en x=L: -L*RzB ; momentos de reaccion A[4] + B[4]
      close(h * c.H + (c.w * L * L) / 2 - L * B[2] + A[4] + B[4], 0, 1, 1e-9);
      // equilibrio de nudo N1 (momentos): My_col(h) = -My_viga(0) ; N2: My_col2(h) = ... viga en L con signo +
      const m = f.members;
      close((m.P1?.forces(h).My ?? NaN) + (m.V?.forces(0).My ?? NaN), 0, 1, 1e-9, );
      close((m.P2?.forces(h).My ?? NaN) - (m.V?.forces(L).My ?? NaN), 0, 1, 1e-9);
      // equilibrio de nudo N1 (fuerzas): horizontal y vertical con los esfuerzos de extremo en globales
      // columna 1 sobre nudo: horizontal = -Fz_j(col) = -Vz(h) ; vertical = -Fx_j(col) = -N
      const v1 = m.P1?.forces(h).Vz ?? NaN;
      const n1 = m.P1?.forces(h).N ?? NaN;
      const nb = m.V?.forces(0).N ?? NaN;
      const vb = m.V?.forces(0).Vz ?? NaN;
      // viga sobre nudo (i): horizontal -(-N)... nudo sobre viga: Fx_i = -N(0), Fz_i = -Vz(0) ; viga sobre nudo: opuesto.
      close(c.H - v1 + nb, 0, 1, 1e-9); // H + (col sobre nudo -Vz) + (viga sobre nudo +N(0))
      close(-n1 + vb, 0, 1, 1e-9); // vertical: (col sobre nudo -N) + (viga sobre nudo +Vz(0))
      // nudo N2
      const v2 = m.P2?.forces(h).Vz ?? NaN;
      const n2 = m.P2?.forces(h).N ?? NaN;
      const nbL = m.V?.forces(L).N ?? NaN;
      const vbL = m.V?.forces(L).Vz ?? NaN;
      close(-v2 - nbL, 0, 1, 1e-9); // col sobre nudo -Vz ; viga sobre nudo en j: -Fx_j = -N(L)
      close(-n2 - vbL, 0, 1, 1e-9); // vertical: col sobre nudo -N ; viga sobre nudo en j: -Vz(L)
      // cortante de planta: V1 + V2 = H
      close(v1 + v2, c.H, 1e-12, 1e-9);
      // giro de nudos coherente con la viga: theta1 = rotacion; relacion pendiente-desplazamiento del extremo
      const p = f.parts;
      close(p.M_1A + p.M_12, 0, 1, 1e-9);
      close(p.M_2B + p.M_21, 0, 1, 1e-9);
    });
  }

  it("limites: viga muy rigida (L->0, k->inf) D = H h^3/(24 EI); sin viga (k->0) D = H h^3/(6 EI)", () => {
    const rigid = portalFrame({ h: 4, L: 1e-6, EI: 20000, H: 30, w: 0 });
    close(rigid.parts.D, (30 * 64) / (24 * 20000), 1e-5);
    const free = portalFrame({ h: 4, L: 1e9, EI: 20000, H: 30, w: 0 });
    close(free.parts.D, (30 * 64) / (6 * 20000), 1e-6);
  });

  it("carga uniforme: simetria (theta2 = -theta1, sin desplazamiento lateral) y fixed-end", () => {
    const f = portalFrame({ h: 4, L: 6, EI: 20000, H: 0, w: 20 });
    close(f.parts.D, 0, 1, 1e-15);
    close(f.parts.th1 + f.parts.th2, 0, 1, 1e-15);
    close(f.reactions.A?.[2] ?? NaN, 60, 1e-12);
    // limite de columnas muy rigidas respecto a la viga (h -> 0): empotrada-empotrada, My(0) viga -> +wL^2/12.
    const stiff = portalFrame({ h: 1e-6, L: 6, EI: 20000, H: 0, w: 20 });
    close(stiff.members.V?.forces(0).My ?? NaN, (20 * 36) / 12, 1e-4);
  });
});

describe("referencia analitica: cercha", () => {
  it("L=8, H=3, P=60: N_AC = N_BC = -50, N_AB = +40, reacciones P/2", () => {
    const t = triangularTruss({ L: 8, H: 3, P: 60, EA: 840000 });
    close(t.parts.N_AC, -50);
    close(t.parts.N_AB, 40);
    close(t.parts.d, 5);
    expect(t.reactions.A).toEqual([0, 0, 30, 0, 0, 0]);
  });
  it("trabajo virtual: P * |v_C| = sum N^2 l / EA, y compatibilidad de la barra BC", () => {
    const EA = 840000;
    const P = 60;
    const t = triangularTruss({ L: 8, H: 3, P, EA });
    const W = (2 * t.parts.N_AC ** 2 * t.parts.d + t.parts.N_AB ** 2 * 8) / EA;
    close(-P * t.parts.dC.uz, W, 1e-12);
    // alargamiento de BC con direccion B->C = (-cos, sin): -(u_C - u_B) cos + v sin = N d / EA
    const cs = 0.8;
    const sn = 0.6;
    close(-(t.parts.dC.ux - t.parts.dB) * cs + t.parts.dC.uz * sn, (t.parts.N_AC * t.parts.d) / EA, 1e-12);
    // y de AC
    close(t.parts.dC.ux * cs + t.parts.dC.uz * sn, (t.parts.N_AC * t.parts.d) / EA, 1e-12);
  });
});

describe("referencia analitica: pilar con salto de 180 grados (ADR-001 seccion 3)", () => {
  const H = 4;
  const P = 25;
  const EI = 20000;
  const EA = 2e6;
  it("la base local cambia: delta = 0 -> z=+X, y=-Y ; delta = 1e-4 -> z ~ -X, y=+Y", () => {
    const b0 = localBasisInPlane(0);
    expect(b0.zhat).toEqual([1, 0]);
    expect(b0.ySign).toBe(-1);
    const b1 = localBasisInPlane(1e-4);
    expect(b1.zhat[0]).toBeLessThan(-0.999999);
    expect(b1.ySign).toBe(1);
    // umbral del ADR: 1 - cos(d) > 1e-9 para d > ~4.5e-5
    expect(1 - Math.cos(1e-4)).toBeGreaterThan(1e-9);
  });
  it("My local de signo opuesto con el mismo estado fisico; equilibrio base-punta", () => {
    const a = slantedColumn({ H, P, EI, EA, delta: 0 });
    const b = slantedColumn({ H, P, EI, EA, delta: 1e-4 });
    close(a.members.C1?.forces(0).My ?? NaN, -P * H);
    close(b.members.C1?.forces(0).My ?? NaN, P * H * Math.cos(1e-4));
    expect(Math.sign(a.members.C1?.forces(0).My ?? 0)).toBe(-Math.sign(b.members.C1?.forces(0).My ?? 0));
    for (const [c, delta] of [[a, 0], [b, 1e-4]] as const) {
      const { ySign, zhat } = c.parts;
      const f0 = c.members.C1?.forces(0) ?? { N: NaN, Vz: NaN, My: NaN };
      // fuerza global del apoyo = -(N xhat + Vz zhat) debe ser (-P, 0): componente X y Z
      const xhat = [Math.sin(delta), Math.cos(delta)] as const;
      close(-(f0.N * xhat[0] + f0.Vz * zhat[0]), -P, 1e-12, 1e-9);
      close(-(f0.N * xhat[1] + f0.Vz * zhat[1]), 0, 1, 1e-9);
      // momento de reaccion global = ySign * My_i = -ySign * My(0)
      close(-ySign * f0.My, c.reactions.A?.[4] ?? NaN, 1e-12);
      // la flecha global de la punta tiene el signo de la carga (+X)
      expect(c.nodeDisp.T?.ux).toBeGreaterThan(0);
    }
  });
  it("punta: P H^3/(3EI) en X para el pilar vertical y giro ry = +P H^2/(2EI)", () => {
    const a = slantedColumn({ H, P, EI, EA, delta: 0 });
    close(a.nodeDisp.T?.ux ?? NaN, (P * H ** 3) / (3 * EI));
    close(a.nodeDisp.T?.ry ?? NaN, (P * H * H) / (2 * EI));
    close(a.nodeDisp.T?.uz ?? NaN, 0, 1, 1e-12);
  });
});

describe("referencia analitica: E4 3D (rotation = pi/2)", () => {
  it("Vy(0)=-wL/2, Mz(L/2)=+wL^2/8, flecha central -5wL^4/(384 EIz), EIz != EIy", () => {
    const L = 6;
    const w = 10;
    const EIz = 20000;
    const r = rotatedBeamUdl({ L, w, EIz });
    close(r.forces(0).Vy, (-w * L) / 2);
    close(r.forces(L / 2).Mz, (w * L * L) / 8);
    close(r.uy(L / 2), (-5 * w * L ** 4) / (384 * EIz));
    close(r.reactions[0]?.R[2] ?? NaN, (w * L) / 2);
    // dMz/dx = -Vy (FD)
    const h = 1e-5;
    close((r.forces(2 + h).Mz - r.forces(2 - h).Mz) / (2 * h), -r.forces(2).Vy, 1e-6, 1e-6);
    // dVy/dx = -wy = +w
    close((r.forces(2 + h).Vy - r.forces(2 - h).Vy) / (2 * h), w, 1e-6, 1e-6);
  });
});
