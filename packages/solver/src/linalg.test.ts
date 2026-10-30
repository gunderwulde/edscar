/**
 * Tests de álgebra lineal propia. Esperados calculados a mano (ADR-005 §4 para la cercha) o por construcción
 * (b = K·x con x elegido), nunca tomados de la salida del código.
 */
import { describe, expect, it } from "vitest";
import {
  cloneSkyline,
  createSkyline,
  invertSPD,
  ldlFactor,
  ldlSolve,
  mechanismMode,
  normInf,
  orthonormalize,
  pinvWithNull,
  skyAdd,
  skyGet,
  skyIndex,
  skyMatVec,
  skyNormInf,
} from "./linalg";
import type { Skyline } from "./linalg";

/** Construye una skyline a partir de una matriz densa simétrica y un perfil. */
function fromDense(a: number[][], first: number[]): Skyline {
  const s = createSkyline(Int32Array.from(first));
  for (let j = 0; j < a.length; j++) {
    for (let i = first[j] ?? 0; i <= j; i++) skyAdd(s, i, j, a[i]?.[j] ?? 0);
  }
  return s;
}

describe("skyline: almacenamiento", () => {
  it("rechaza perfiles inválidos", () => {
    expect(() => createSkyline(Int32Array.from([0, 2]))).toThrow(RangeError);
    expect(() => createSkyline(Int32Array.from([-1]))).toThrow(RangeError);
  });

  it("indexa, suma simétricamente y devuelve 0 fuera del perfil", () => {
    const s = createSkyline(Int32Array.from([0, 0, 1]));
    expect(s.val.length).toBe(1 + 2 + 2);
    skyAdd(s, 1, 0, 3);
    skyAdd(s, 0, 1, 1);
    expect(skyGet(s, 0, 1)).toBe(4);
    expect(skyGet(s, 1, 0)).toBe(4);
    expect(skyIndex(s, 0, 2)).toBe(-1);
    expect(skyGet(s, 0, 2)).toBe(0);
    expect(() => {
      skyAdd(s, 0, 2, 1);
    }).toThrow(RangeError);
  });

  it("producto matriz-vector y norma ∞ de [[4, 1], [1, −3]]", () => {
    const s = fromDense(
      [
        [4, 1],
        [1, -3],
      ],
      [0, 0],
    );
    expect(Array.from(skyMatVec(s, [1, 2]))).toEqual([6, -5]);
    expect(skyNormInf(s)).toBe(5);
    expect(normInf([1, -7, 3])).toBe(7);
    const c = cloneSkyline(s);
    c.val[0] = 99;
    expect(skyGet(s, 0, 0)).toBe(4);
  });
});

describe("LDLᵀ skyline", () => {
  it("resuelve el sistema de la cercha de ADR-005 §4 con sus pivotes", () => {
    const K = [
      [212520, -107520, 80640],
      [-107520, 215040, 0],
      [80640, 0, 120960],
    ];
    const s = fromDense(K, [0, 0, 0]);
    const r = ldlFactor(s, 1e-12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d2 = 215040 - 107520 ** 2 / 212520; // 160 642.53 (ADR)
    expect(skyGet(r.factor, 0, 0)).toBeCloseTo(212520, 6);
    expect(skyGet(r.factor, 1, 1)).toBeCloseTo(d2, 6);
    expect(skyGet(r.factor, 2, 2)).toBeCloseTo(80000, 6);
    // Mínima relación d_k/K_kk = 80000/120960 = 0.661 (ADR: 1; 0.747; 0.661).
    expect(r.minIndex).toBe(2);
    expect(r.minRatio).toBeCloseTo(80000 / 120960, 12);
    const x = ldlSolve(r.factor, [0, 0, -60]);
    expect(x[0]).toBeCloseTo(8 / 21000, 15);
    expect(x[1]).toBeCloseTo(4 / 21000, 15);
    expect(x[2]).toBeCloseTo(-7.5e-4, 15);
  });

  it("respeta perfiles con huecos (tridiagonal, x = [1, 2, 3, 4])", () => {
    const K = [
      [4, 1, 0, 0],
      [1, 4, 1, 0],
      [0, 1, 4, 1],
      [0, 0, 1, 4],
    ];
    const s = fromDense(K, [0, 0, 1, 2]);
    const r = ldlFactor(s, 1e-12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const x = ldlSolve(r.factor, [6, 12, 18, 19]);
    [1, 2, 3, 4].forEach((v, k) => {
      expect(x[k]).toBeCloseTo(v, 13);
    });
  });

  it("perfil con ceros dentro de la envolvente", () => {
    const K = [
      [2, 0, 1],
      [0, 3, 0],
      [1, 0, 2],
    ];
    const s = fromDense(K, [0, 1, 0]);
    const r = ldlFactor(s, 1e-12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // x = [1, 1, 1] => b = [3, 3, 3]
    const x = ldlSolve(r.factor, [3, 3, 3]);
    for (const v of x) expect(v).toBeCloseTo(1, 14);
  });

  it("detecta singularidad y devuelve el modo de mecanismo [[1, 1], [1, 1]] → (−1, 1)", () => {
    const s = fromDense(
      [
        [1, 1],
        [1, 1],
      ],
      [0, 0],
    );
    const r = ldlFactor(s, 1e-12);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.index).toBe(1);
    expect(r.ratio).toBe(0);
    expect(Array.from(mechanismMode(r.factor, r.index))).toEqual([-1, 1]);
  });

  it("modo de mecanismo en una cadena: K·x = 0 salvo en la fila del pivote", () => {
    // Muelles en serie sin apoyo: K = k·[[1, −1, 0], [−1, 2, −1], [0, −1, 1]] (singular, núcleo (1, 1, 1)).
    const K = [
      [1, -1, 0],
      [-1, 2, -1],
      [0, -1, 1],
    ];
    const r = ldlFactor(fromDense(K, [0, 0, 1]), 1e-12);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.index).toBe(2);
    const m = Array.from(mechanismMode(r.factor, r.index));
    for (const v of m) expect(v).toBeCloseTo(1, 14);
  });

  it("NaN en la diagonal ⇒ singular (criterio negado de ADR-005 §3.3)", () => {
    const s = fromDense([[NaN]], [0]);
    const r = ldlFactor(s, 1e-12);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.index).toBe(0);
    expect(Number.isNaN(r.ratio)).toBe(true);
  });

  it("pivote negativo ⇒ singular", () => {
    const r = ldlFactor(
      fromDense(
        [
          [1, 2],
          [2, 1],
        ],
        [0, 0],
      ),
      1e-12,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ratio).toBe(-3); // d2 = 1 − 4 = −3; K22 = 1
  });

  it("diagonal nula ⇒ singular con relación 0", () => {
    const r = ldlFactor(fromDense([[0]], [0]), 1e-12);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ratio).toBe(0);
  });

  it("pivote relativo por debajo de τ ⇒ singular; por encima ⇒ ok", () => {
    // [[1, 1], [1, 1 + ε]]: d2 = ε, K22 = 1 + ε.
    const mk = (eps: number): Skyline =>
      fromDense(
        [
          [1, 1],
          [1, 1 + eps],
        ],
        [0, 0],
      );
    expect(ldlFactor(mk(1e-14), 1e-12).ok).toBe(false);
    const r = ldlFactor(mk(1e-9), 1e-12);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.minRatio).toBeCloseTo(1e-9, 14);
  });
});

describe("matrices densas pequeñas", () => {
  it("invierte [[4, 2], [2, 3]] = (1/8)·[[3, −2], [−2, 4]]", () => {
    const inv = invertSPD([
      [4, 2],
      [2, 3],
    ]);
    expect(inv[0]?.[0]).toBeCloseTo(3 / 8, 15);
    expect(inv[0]?.[1]).toBeCloseTo(-2 / 8, 15);
    expect(inv[1]?.[0]).toBeCloseTo(-2 / 8, 15);
    expect(inv[1]?.[1]).toBeCloseTo(4 / 8, 15);
  });

  it("rechaza matrices no definidas positivas", () => {
    expect(() =>
      invertSPD([
        [1, 2],
        [2, 1],
      ]),
    ).toThrow(RangeError);
  });

  it("ortonormaliza por Gram-Schmidt", () => {
    const q = orthonormalize([
      [2, 0],
      [1, 1],
    ]);
    expect(q[0]).toEqual([1, 0]);
    expect(q[1]?.[0]).toBeCloseTo(0, 15);
    expect(q[1]?.[1]).toBeCloseTo(1, 15);
  });

  it("pseudoinversa con núcleo conocido: [[1, −1], [−1, 1]]⁺ = ¼·[[1, −1], [−1, 1]]", () => {
    // a = 2·v·vᵀ con v = (1, −1)/√2 ⇒ a⁺ = (1/2)·v·vᵀ.
    const p = pinvWithNull(
      [
        [1, -1],
        [-1, 1],
      ],
      [[1, 1]],
    );
    expect(p[0]?.[0]).toBeCloseTo(0.25, 15);
    expect(p[0]?.[1]).toBeCloseTo(-0.25, 15);
    expect(p[1]?.[1]).toBeCloseTo(0.25, 15);
  });

  it("pseudoinversa independiente de la escala: (λ·[[1, −1], [−1, 1]])⁺ = ¼λ⁻¹·[[1, −1], [−1, 1]] con λ ∈ {1e-3, 1e12}", () => {
    for (const lam of [1e-3, 1e12]) {
      const p = pinvWithNull(
        [
          [lam, -lam],
          [-lam, lam],
        ],
        [[1, 1]],
      );
      const e = 1 / (4 * lam);
      expect(Math.abs((p[0]?.[0] ?? NaN) - e)).toBeLessThan(1e-14 * e);
      expect(Math.abs((p[0]?.[1] ?? NaN) + e)).toBeLessThan(1e-14 * e);
      expect(Math.abs((p[1]?.[1] ?? NaN) - e)).toBeLessThan(1e-14 * e);
    }
  });

  it("pseudoinversa de la matriz nula (todo núcleo, traza 0 ⇒ c = 1): matriz nula", () => {
    const p = pinvWithNull(
      [
        [0, 0],
        [0, 0],
      ],
      [
        [1, 0],
        [0, 1],
      ],
    );
    expect(p.flat().map((v) => v + 0)).toEqual([0, 0, 0, 0]);
  });

  it("pseudoinversa sin núcleo = inversa", () => {
    const p = pinvWithNull([[4]], []);
    expect(p[0]?.[0]).toBe(0.25);
  });
});
