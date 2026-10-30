/**
 * Álgebra lineal propia del solver (escrita desde cero, sin librerías):
 * - Matriz simétrica en almacenamiento "skyline" (perfil por columnas) y su factorización LDLᵀ sin pivotación
 *   con el criterio de pivote nulo de ADR-005 §3.3: singular si !(d_k > τ·K_kk).
 * - Sustitución progresiva/regresiva, producto matriz-vector y norma ∞.
 * - Modo de mecanismo (ADR-005 §3.9): x_k = 1, x_{>k} = 0, x_{<k} = −L₁₁⁻ᵀ·l_k.
 * - Matrices densas pequeñas: LDLᵀ, inversa y pseudoinversa con núcleo conocido, k⁺ = (k + c·N·Nᵀ)⁻¹ − N·Nᵀ/c.
 *
 * Derivación de LDLᵀ (K = L·D·Lᵀ, L triangular inferior unitaria). Para i < j:
 *   K_ij = Σ_{m<i} L_im·D_m·L_jm + D_i·L_ji. Con g_ij = D_i·L_ji:  g_ij = K_ij − Σ_{m<i} L_im·g_mj,
 *   L_ji = g_ij / D_i  y  D_j = K_jj − Σ_{i<j} L_ji·g_ij.
 * En skyline, la columna j guarda las filas first[j]…j; tras factorizar guarda L_ji (i < j) y D_j en la diagonal.
 * Los sumatorios solo recorren el solape de perfiles, porque fuera del perfil los términos son nulos.
 */

/**
 * Lectura de un índice válido por construcción. Con `noUncheckedIndexedAccess` el tipo incluye `undefined`; se
 * afirma `number` en vez de añadir un `?? 0` defensivo que ocultaría un error de índice. Una LECTURA fuera de rango
 * da `undefined`, que en aritmética se convierte en NaN y lo detectan el criterio de pivote negado y el control de
 * residuo (ADR-005 §3.3 y §3.5). En cambio, un índice NaN o fuera de rango usado para ESCRIBIR (`v[k] = x`) se
 * pierde sin aviso (en un Float64Array se ignora; en un array crea una propiedad ajena): no se propaga. Los
 * índices de escritura se derivan de la numeración de GDL y están acotados por construcción.
 */
export const at = (a: ArrayLike<number>, k: number): number => a[k] as number;

export interface Skyline {
  n: number;
  /** Primera fila almacenada de cada columna (first[j] ≤ j). */
  first: Int32Array;
  /** Inicio de la columna j en `val`; ptr[n] = longitud total. */
  ptr: Int32Array;
  val: Float64Array;
}

/** Crea una matriz skyline nula con el perfil dado. */
export function createSkyline(first: Int32Array): Skyline {
  const n = first.length;
  const ptr = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) {
    const f = at(first, j);
    if (f < 0 || f > j) throw new RangeError(`Perfil inválido en la columna ${String(j)}`);
    ptr[j + 1] = at(ptr, j) + (j - f + 1);
  }
  return { n, first, ptr, val: new Float64Array(at(ptr, n)) };
}

export function cloneSkyline(s: Skyline): Skyline {
  return { n: s.n, first: s.first, ptr: s.ptr, val: Float64Array.from(s.val) };
}


/** Índice en `val` de la entrada (i, j) simétrica, o −1 si está fuera del perfil. */
export function skyIndex(s: Skyline, i: number, j: number): number {
  const r = Math.min(i, j);
  const c = Math.max(i, j);
  const f = at(s.first, c);
  return r < f ? -1 : at(s.ptr, c) + (r - f);
}

/** Suma v en la entrada simétrica (i, j). Lanza si cae fuera del perfil (error de ensamblaje). */
export function skyAdd(s: Skyline, i: number, j: number, v: number): void {
  const k = skyIndex(s, i, j);
  if (k < 0) throw new RangeError(`Entrada (${String(i)}, ${String(j)}) fuera del perfil`);
  s.val[k] = at(s.val, k) + v;
}

export function skyGet(s: Skyline, i: number, j: number): number {
  const k = skyIndex(s, i, j);
  return k < 0 ? 0 : at(s.val, k);
}

/** y = K·x para la matriz simétrica (no factorizada). */
export function skyMatVec(s: Skyline, x: ArrayLike<number>): Float64Array {
  const y = new Float64Array(s.n);
  for (let j = 0; j < s.n; j++) {
    const f = at(s.first, j);
    const p = at(s.ptr, j);
    const xj = at(x, j);
    for (let i = f; i < j; i++) {
      const a = at(s.val, p + i - f);
      y[i] = at(y, i) + a * xj;
      y[j] = at(y, j) + a * at(x, i);
    }
    y[j] = at(y, j) + at(s.val, p + j - f) * xj;
  }
  return y;
}

/** Norma ∞ de la matriz simétrica: máxima suma de fila en valor absoluto. */
export function skyNormInf(s: Skyline): number {
  const rows = new Float64Array(s.n);
  for (let j = 0; j < s.n; j++) {
    const f = at(s.first, j);
    const p = at(s.ptr, j);
    for (let i = f; i < j; i++) {
      const a = Math.abs(at(s.val, p + i - f));
      rows[i] = at(rows, i) + a;
      rows[j] = at(rows, j) + a;
    }
    rows[j] = at(rows, j) + Math.abs(at(s.val, p + j - f));
  }
  let m = 0;
  for (const r of rows) m = Math.max(m, r);
  return m;
}

export function normInf(v: ArrayLike<number>): number {
  let m = 0;
  for (let k = 0; k < v.length; k++) m = Math.max(m, Math.abs(at(v, k)));
  return m;
}

export type LdlResult =
  | {
      ok: true;
      factor: Skyline;
      /** min_k d_k/K_kk y su índice (para el aviso de mal condicionamiento, ADR-005 §3.4). */
      minRatio: number;
      minIndex: number;
    }
  | {
      ok: false;
      /** Factor parcial: columnas 0…index ya calculadas (sirve para el modo de mecanismo). */
      factor: Skyline;
      index: number;
      /** d_k/K_kk en el pivote rechazado (0 si K_kk = 0). */
      ratio: number;
    };

/** Relación d_k/K_kk; 0 si la diagonal original es 0 (evita 0/0). */
const pivotRatio = (d: number, kk: number): number => (kk === 0 ? 0 : d / kk);

/**
 * Factoriza K = L·D·Lᵀ (copia; no modifica `s`). Pivote k rechazado si !(d_k > τ·K_kk), con K_kk la diagonal
 * original (la forma negada captura NaN y trata como singular un pivote negativo o nulo).
 */
export function ldlFactor(s: Skyline, tau: number): LdlResult {
  const a = cloneSkyline(s);
  const { first, ptr, val } = a;
  let minRatio = Infinity;
  let minIndex = -1;
  for (let j = 0; j < a.n; j++) {
    const fj = at(first, j);
    const pj = at(ptr, j);
    // g_ij = K_ij − Σ L_im·g_mj  (se sobrescribe la columna j de arriba abajo).
    for (let i = fj; i < j; i++) {
      const fi = at(first, i);
      const pi = at(ptr, i);
      let sum = at(val, pj + i - fj);
      for (let m = Math.max(fi, fj); m < i; m++) sum -= at(val, pi + m - fi) * at(val, pj + m - fj);
      val[pj + i - fj] = sum;
    }
    // L_ji = g_ij / D_i ;  D_j = K_jj − Σ L_ji·g_ij.
    const kjj = at(val, pj + j - fj);
    let d = kjj;
    for (let i = fj; i < j; i++) {
      const g = at(val, pj + i - fj);
      const l = g / at(val, at(ptr, i) + i - at(first, i));
      val[pj + i - fj] = l;
      d -= l * g;
    }
    val[pj + j - fj] = d;
    const ratio = pivotRatio(d, kjj);
    if (!(d > tau * kjj)) return { ok: false, factor: a, index: j, ratio };
    if (ratio < minRatio) {
      minRatio = ratio;
      minIndex = j;
    }
  }
  return { ok: true, factor: a, minRatio, minIndex };
}

/** Resuelve L·D·Lᵀ·x = b con el factor de `ldlFactor`. */
export function ldlSolve(f: Skyline, b: ArrayLike<number>): Float64Array {
  const { n, first, ptr, val } = f;
  const x = Float64Array.from({ length: n }, (_, k) => at(b, k));
  // L·y = b (L_ji en la columna j).
  for (let j = 0; j < n; j++) {
    const fj = at(first, j);
    const pj = at(ptr, j);
    let s = at(x, j);
    for (let i = fj; i < j; i++) s -= at(val, pj + i - fj) * at(x, i);
    x[j] = s;
  }
  // D·z = y.
  for (let j = 0; j < n; j++) x[j] = at(x, j) / at(val, at(ptr, j) + j - at(first, j));
  // Lᵀ·x = z (regresiva por columnas).
  for (let j = n - 1; j >= 0; j--) {
    const fj = at(first, j);
    const pj = at(ptr, j);
    const xj = at(x, j);
    for (let i = fj; i < j; i++) x[i] = at(x, i) - at(val, pj + i - fj) * xj;
  }
  return x;
}

/**
 * Modo de mecanismo con el factor (parcial) cuyo pivote k falló: x_k = 1, x_{>k} = 0 y
 * L₁₁ᵀ·x₁ = −l_k (l_k = fila k de L). Cumple K₁₁·x₁ + K₁k = 0, es decir, (K·x) es nulo salvo en la fila k (= d_k).
 * Devuelve un vector de longitud n.
 */
export function mechanismMode(f: Skyline, k: number): Float64Array {
  const { n, first, ptr, val } = f;
  const x = new Float64Array(n);
  x[k] = 1;
  const fk = at(first, k);
  const pk = at(ptr, k);
  for (let i = fk; i < k; i++) x[i] = -at(val, pk + i - fk);
  for (let j = k - 1; j >= 0; j--) {
    const fj = at(first, j);
    const pj = at(ptr, j);
    const xj = at(x, j);
    for (let i = fj; i < j; i++) x[i] = at(x, i) - at(val, pj + i - fj) * xj;
  }
  return x;
}

/* ------------------------------------------------------------------------------------------------
 * Matrices densas pequeñas (bloques de barra, 2×2 a 4×4).
 * ---------------------------------------------------------------------------------------------- */

export type Mat = number[][];

export const zeros = (r: number, c: number): Mat => Array.from({ length: r }, () => new Array<number>(c).fill(0));

/** Entrada (i, j) de una matriz densa; índices válidos por construcción (ver `at`). */
export const get = (m: Mat, i: number, j: number): number => (m[i] as number[])[j] as number;

export function setM(m: Mat, i: number, j: number, v: number): void {
  (m[i] as number[])[j] = v;
}

/** Inversa de una matriz simétrica definida positiva pequeña mediante LDLᵀ denso. Lanza si un pivote no es > 0. */
export function invertSPD(a: Mat): Mat {
  const n = a.length;
  const l = zeros(n, n);
  const d = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    let dj = get(a, j, j);
    for (let m = 0; m < j; m++) dj -= get(l, j, m) * get(l, j, m) * at(d, m);
    if (!(dj > 0)) throw new RangeError("invertSPD: matriz no definida positiva");
    d[j] = dj;
    setM(l, j, j, 1);
    for (let i = j + 1; i < n; i++) {
      let s = get(a, i, j);
      for (let m = 0; m < j; m++) s -= get(l, i, m) * get(l, j, m) * at(d, m);
      setM(l, i, j, s / dj);
    }
  }
  const inv = zeros(n, n);
  for (let c = 0; c < n; c++) {
    const x = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = i === c ? 1 : 0;
      for (let m = 0; m < i; m++) s -= get(l, i, m) * at(x, m);
      x[i] = s;
    }
    for (let i = 0; i < n; i++) x[i] = at(x, i) / at(d, i);
    for (let i = n - 1; i >= 0; i--) {
      let s = at(x, i);
      for (let m = i + 1; m < n; m++) s -= get(l, m, i) * at(x, m);
      x[i] = s;
    }
    for (let i = 0; i < n; i++) setM(inv, i, c, at(x, i));
  }
  return inv;
}

/** Ortonormaliza (Gram-Schmidt) una lista de vectores linealmente independientes. */
export function orthonormalize(vs: readonly (readonly number[])[]): number[][] {
  const out: number[][] = [];
  for (const v of vs) {
    const w = [...v];
    for (const q of out) {
      let dot = 0;
      for (let k = 0; k < w.length; k++) dot += at(w, k) * at(q, k);
      for (let k = 0; k < w.length; k++) w[k] = at(w, k) - dot * at(q, k);
    }
    const nrm = Math.hypot(...w);
    out.push(w.map((c) => c / nrm));
  }
  return out;
}

/**
 * Pseudoinversa de Moore-Penrose de una matriz simétrica semidefinida positiva `a` cuyo núcleo está generado
 * EXACTAMENTE por `nullBasis` (vectores linealmente independientes, conocidos en forma cerrada).
 * Con N ortonormal, P = N·Nᵀ y c > 0: a + c·P es regular y a⁺ = (a + c·P)⁻¹ − P/c (a y P actúan en subespacios
 * ortogonales: en la imagen de a, (a + c·P)⁻¹ = a⁺; en el núcleo, = 1/c).
 * La penalización c se escala con la propia matriz, c = traza(a)/n (mismas unidades que a; con r autovalores no
 * nulos λ, c = Σλ/n ∈ [r·λ_min/n, r·λ_max/n], del orden de los de a, así que a + c·P conserva su escala). Con c = 1 fijo, si los autovalores de a son ~λ ≫ 1 la inversa de a + P mezcla
 * escalas 1 y 1/λ y el error de redondeo de a⁺ crece como ε·λ (dependiente de las unidades del modelo).
 * Si traza(a) = 0 (a = 0, todo núcleo) se usa c = 1.
 */
export function pinvWithNull(a: Mat, nullBasis: readonly (readonly number[])[]): Mat {
  const n = a.length;
  const q = orthonormalize(nullBasis);
  const p = zeros(n, n);
  for (const v of q) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) setM(p, i, j, get(p, i, j) + at(v, i) * at(v, j));
  let tr = 0;
  for (let i = 0; i < n; i++) tr += get(a, i, i);
  const c = tr > 0 ? tr / n : 1;
  const m = a.map((row, i) => row.map((x, j) => x + c * get(p, i, j)));
  const inv = invertSPD(m);
  return inv.map((row, i) => row.map((x, j) => x - get(p, i, j) / c));
}
