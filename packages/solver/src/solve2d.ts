/**
 * Solver de rigidez directa "2D-XZ" (escrito desde cero). GDL por nudo: [ux, uz, ry] globales.
 * Convenciones: ADR-001. Liberaciones, GDL sin rigidez y mecanismos: ADR-005 (parte 2D).
 *
 * Flujo: validación → cargas del caso en ejes locales → f_emp y comprobaciones de mecanismo interno (§1.3–1.4)
 * → condensación (§1) → eliminación de giros sin rigidez (§2) y chequeo de su carga (§2.5) → ensamblaje skyline
 * → LDLᵀ con criterio de pivote (§3.3–3.4) → residuo (§3.5) → resultados → equilibrio global (§3.6).
 */
import type { Id, Load, Project } from "@edscar/model";
import { validateProject } from "@edscar/model";
import type { DeflectionStation, Dof6, MemberResult, SolveRequest, SolveResult } from "./index";
import type { Condensed, MemberLoads2D, Released6 } from "./element2d";
import {
  condense,
  emptyLoads,
  fixedEndForces,
  hasDoubleSlide,
  internalMechanismError,
  localStiffness,
  stiffnessToGlobal,
  toGlobal6,
  toLocal6,
  transform2D,
  transmitsMy,
} from "./element2d";
import type { LocalAxes, V3 } from "./geometry";
import { localAxes, toLocal } from "./geometry";
import type { Mat } from "./linalg";
import { at, createSkyline, get, ldlFactor, ldlSolve, mechanismMode, normInf, skyAdd, skyMatVec, skyNormInf } from "./linalg";
import type { DeflectionPoint } from "./sections";
import { memberDeflection, memberStations } from "./sections";

/** Tolerancias de ADR-005 (decisiones del propietario, §4 de "Decisiones"). */
export const TOL = {
  pivot: 1e-12,
  pivotWarning: 1e-8,
  residual: 1e-9,
  equilibriumSingular: 1e-6,
  equilibriumWarning: 1e-9,
  eliminatedLoad: 1e-9,
} as const;

const DOF_NAMES = ["ux", "uz", "ry"] as const;

/**
 * Referencia garantizada por `validateProject` (nudos, materiales, secciones, barras y patrones existen) o índice
 * válido por construcción: se afirma el tipo en vez de añadir un valor por defecto que ocultaría un error.
 */
const must = <T>(v: T | undefined): T => v as T;
/** Posición en Dof6 de cada GDL 2D. */
const DOF6_INDEX = [0, 2, 4] as const;

export interface Internal2DResult {
  result: SolveResult;
  /** Deformada local (u, w) por barra; la versión en ejes globales se expone en `result.deflections`. */
  deflections: Record<Id, DeflectionPoint[]>;
}

const empty = (status: SolveResult["status"], message: string): Internal2DResult => ({
  result: { status, message, displacements: {}, reactions: {}, members: [] },
  deflections: {},
});

/** Formato de valores físicos (6 cifras significativas, sin ceros sobrantes). */
export const fmtValue = (v: number): string => String(Number(v.toPrecision(6)));
/** Formato de relaciones adimensionales. */
export const fmtRatio = (v: number): string => (Number.isFinite(v) ? v.toExponential(2) : String(v));

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);

/**
 * Validación previa de propiedades (ADR-005 §3.2) sobre la entrada sin validar, para dar el mensaje por barra:
 * `Barra <id>: <propiedad> debe ser > 0`. (validateProject ya rechaza estos modelos; esto solo mejora el mensaje.)
 */
export function propertyErrors(input: unknown): string[] {
  const p = asRecord(input);
  if (!p) return [];
  const byId = (list: unknown): Map<unknown, Record<string, unknown>> => {
    const m = new Map<unknown, Record<string, unknown>>();
    for (const it of asArray(list)) {
      const r = asRecord(it);
      if (r) m.set(r.id, r);
    }
    return m;
  };
  const mats = byId(p.materials);
  const secs = byId(p.sections);
  const out: string[] = [];
  const bad = (v: unknown): boolean => !(typeof v === "number" && Number.isFinite(v) && v > 0);
  for (const it of asArray(p.members)) {
    const m = asRecord(it);
    if (!m) continue;
    const id = String(m.id);
    const mat = mats.get(m.material);
    const sec = secs.get(m.section);
    if (mat && bad(mat.E)) out.push(`Barra ${id}: E debe ser > 0`);
    if (sec && bad(sec.A)) out.push(`Barra ${id}: A debe ser > 0`);
    if (sec && bad(sec.Iy)) out.push(`Barra ${id}: Iy debe ser > 0`);
  }
  return out;
}

interface MemberData {
  id: Id;
  ni: number;
  nj: number;
  axes: LocalAxes;
  props: { L: number; EA: number; EI: number; alpha: number };
  T: Mat;
  k: Mat;
  rel: Released6;
  loads: MemberLoads2D;
  density: number;
  A: number;
}

/** Resuelve un caso de un proyecto "2D-XZ". Nunca lanza por errores del modelo. */
export function solve2D(request: SolveRequest): Internal2DResult {
  const v = validateProject(request.project);
  if (!v.ok) {
    const msgs = [...propertyErrors(request.project), ...v.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))];
    return empty("invalid-model", msgs.join("; "));
  }
  const project: Project = v.project;
  if (project.analysis !== "2D-XZ") {
    return empty(
      "unsupported",
      'Análisis "3D" no soportado todavía por el solver (previsto en M4, pendiente de ADR); solo se resuelve "2D-XZ"',
    );
  }
  const lc = project.cases.find((c) => c.id === request.caseId);
  if (!lc) return empty("invalid-model", `El caso "${request.caseId}" no existe`);

  // ---- Nudos y barras -------------------------------------------------------------------------
  const nn = project.nodes.length;
  const nodeIndex = new Map(project.nodes.map((n, k) => [n.id, k]));
  const pos: V3[] = project.nodes.map((n) => [n.x, n.y, n.z]);
  const matById = new Map(project.materials.map((m) => [m.id, m]));
  const secById = new Map(project.sections.map((s) => [s.id, s]));

  const members: MemberData[] = project.members.map((m) => {
    const ni = must(nodeIndex.get(m.i));
    const nj = must(nodeIndex.get(m.j));
    const mat = must(matById.get(m.material));
    const sec = must(secById.get(m.section));
    const axes = localAxes(must(pos[ni]), must(pos[nj]), m.rotation ?? 0, true);
    const props = { L: axes.length, EA: mat.E * sec.A, EI: mat.E * sec.Iy, alpha: mat.alpha };
    const ri = m.releases?.i ?? {};
    const rj = m.releases?.j ?? {};
    const rel: Released6 = [
      ri.ux === true,
      ri.uz === true,
      ri.ry === true,
      rj.ux === true,
      rj.uz === true,
      rj.ry === true,
    ];
    return {
      id: m.id,
      ni,
      nj,
      axes,
      props,
      T: transform2D(axes),
      k: localStiffness(props),
      rel,
      loads: emptyLoads(),
      density: mat.density,
      A: sec.A,
    };
  });
  const memberById = new Map(members.map((m) => [m.id, m]));

  // ---- Cargas del caso -----------------------------------------------------------------------
  const nodal = new Float64Array(3 * nn);
  const prescribed = new Float64Array(3 * nn);
  const loadsByPattern = new Map<Id, Load[]>();
  for (const ld of project.loads) {
    const list = loadsByPattern.get(ld.pattern) ?? [];
    list.push(ld);
    loadsByPattern.set(ld.pattern, list);
  }
  const patternById = new Map(project.patterns.map((p) => [p.id, p]));
  const g = project.settings.gravity;
  for (const term of lc.terms) {
    const phi = term.factor;
    const swf = must(patternById.get(term.pattern)).selfWeightFactor;
    if (swf !== 0) {
      for (const m of members) {
        const q = m.density * m.A * swf * phi;
        addDist(m, 0, m.props.L, [q * g[0], q * g[1], q * g[2]], [q * g[0], q * g[1], q * g[2]], "global");
      }
    }
    for (const ld of loadsByPattern.get(term.pattern) ?? []) {
      applyLoad(ld, phi);
    }
  }

  function applyLoad(ld: Load, phi: number): void {
    if (ld.type === "nodal" || ld.type === "support-displacement") {
      const n = must(nodeIndex.get(ld.node));
      if (ld.type === "nodal") {
        nodal[3 * n] = at(nodal, 3 * n) + phi * ld.f[0];
        nodal[3 * n + 1] = at(nodal, 3 * n + 1) + phi * ld.f[2];
        nodal[3 * n + 2] = at(nodal, 3 * n + 2) + phi * ld.m[1];
      } else {
        DOF6_INDEX.forEach((c, r) => {
          prescribed[3 * n + r] = at(prescribed, 3 * n + r) + phi * ld.d[c];
        });
      }
      return;
    }
    const m = must(memberById.get(ld.member));
    const L = m.props.L;
    const sc = (w: V3): V3 => [phi * w[0], phi * w[1], phi * w[2]];
    switch (ld.type) {
      case "member-uniform":
        addDist(m, ld.a ?? 0, ld.b ?? L, sc(ld.w), sc(ld.w), ld.frame);
        break;
      case "member-trapezoid":
        addDist(m, ld.a, ld.b, sc(ld.w1), sc(ld.w2), ld.frame);
        break;
      case "member-point": {
        const a = clamp(ld.relative ? ld.at * L : ld.at, L);
        const p = ld.frame === "local" ? sc(ld.p) : toLocal(m.axes, sc(ld.p));
        if (p[0] !== 0 || p[2] !== 0) m.loads.forces.push({ a, px: p[0], pz: p[2] });
        if (ld.m) {
          const mm = ld.frame === "local" ? sc(ld.m) : toLocal(m.axes, sc(ld.m));
          if (mm[1] !== 0) m.loads.moments.push({ a, my: mm[1] });
        }
        break;
      }
      case "thermal":
        m.loads.dT += phi * ld.dT;
        m.loads.gz += phi * (ld.gradientZ ?? 0);
        break;
    }
  }

  // ---- Por barra: f_emp, mecanismos internos y condensación -----------------------------------
  const errors: string[] = [];
  const condensed: Condensed[] = [];
  for (const m of members) {
    const femp = fixedEndForces(m.props, m.loads);
    if (hasDoubleSlide(m.rel)) {
      errors.push(
        `Barra ${m.id}: las liberaciones uz_i, uz_j (deslizaderas en ambos extremos) no se admiten en v1; la barra transmitiría momento sin cortante`,
      );
      continue;
    }
    const mech = internalMechanismError(m.id, m.props.L, m.rel, femp);
    if (mech) {
      errors.push(mech);
      continue;
    }
    condensed.push(condense(m.k, femp, m.rel, m.props.L));
  }
  if (errors.length > 0) return empty("invalid-model", errors.join("; "));
  const cond = (k: number): Condensed => condensed[k] as Condensed;

  // ---- Clasificación de GDL (§2) --------------------------------------------------------------
  const restrained = new Uint8Array(3 * nn);
  const supported = new Set<number>();
  for (const s of project.supports) {
    const n = must(nodeIndex.get(s.node));
    supported.add(n);
    DOF6_INDEX.forEach((c, r) => {
      if (s.fixed[c]) restrained[3 * n + r] = 1;
    });
  }
  const hasRotStiffness = new Uint8Array(nn);
  members.forEach((m) => {
    if (transmitsMy(m.rel, "i")) hasRotStiffness[m.ni] = 1;
    if (transmitsMy(m.rel, "j")) hasRotStiffness[m.nj] = 1;
  });
  const eliminated = new Uint8Array(3 * nn);
  for (let n = 0; n < nn; n++) if (!hasRotStiffness[n]) eliminated[3 * n + 2] = 1;

  // f*_eq global por barra (Tᵀ·f*_eq = −Tᵀ·f*_emp)
  const feqGlobal = members.map((m, k) => toGlobal6(m.T, cond(k).f.map((x) => -x)));

  // ---- Carga en GDL eliminados no restringidos (§2.5) -----------------------------------------
  const nodeIdOf = (n: number): Id => must(project.nodes[n]).id;
  const elimErrors = checkEliminatedLoads();
  if (elimErrors.length > 0) return empty("invalid-model", elimErrors.join("; "));

  function checkEliminatedLoads(): string[] {
    const out: string[] = [];
    const Lmax = members.reduce((s, m) => Math.max(s, m.props.L), 0);
    let Fmax = 0;
    for (let n = 0; n < nn; n++) Fmax = Math.max(Fmax, Math.abs(at(nodal, 3 * n)), Math.abs(at(nodal, 3 * n + 1)));
    for (const m of members) {
      for (const d of m.loads.dist) {
        const len = d.b - d.a;
        Fmax = Math.max(Fmax, Math.abs(((d.wx1 + d.wx2) / 2) * len), Math.abs(((d.wz1 + d.wz2) / 2) * len));
      }
      for (const f of m.loads.forces) Fmax = Math.max(Fmax, Math.abs(f.px), Math.abs(f.pz));
    }
    for (let n = 0; n < nn; n++) {
      const gdl = 3 * n + 2;
      if (!eliminated[gdl] || restrained[gdl]) continue;
      const cNodal = at(nodal, gdl);
      const contribs: { id: Id; end: "i" | "j"; c: number }[] = [];
      members.forEach((m, k) => {
        const fe = must(feqGlobal[k]);
        if (m.ni === n && at(fe, 2) !== 0) contribs.push({ id: m.id, end: "i", c: at(fe, 2) });
        if (m.nj === n && at(fe, 5) !== 0) contribs.push({ id: m.id, end: "j", c: at(fe, 5) });
      });
      const r = cNodal + contribs.reduce((s, c) => s + c.c, 0);
      const S = Math.abs(cNodal) + contribs.reduce((s, c) => s + Math.abs(c.c), 0) + Lmax * Fmax;
      if (Math.abs(r) <= TOL.eliminatedLoad * S) continue;
      const nodeId = nodeIdOf(n);
      if (contribs.length === 0) {
        out.push(`Nudo ${nodeId}: momento aplicado en ry pero ninguna barra transmite momento a ese nudo (todas articuladas)`);
        continue;
      }
      contribs.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
      const top = contribs[0] as { id: Id; end: "i" | "j"; c: number };
      const others = contribs.slice(1).map((c) => c.id);
      const also = others.length > 0 ? ` (también: ${others.join(", ")})` : "";
      out.push(
        `Barra ${top.id}: su carga produce un momento ${fmtValue(top.c)} kN·m en el extremo ${top.end} (nudo ${nodeId}, GDL ry) que ninguna barra transmite (nudo articulado); revise liberaciones${also}`,
      );
    }
    return out;
  }

  // ---- Numeración y ensamblaje ----------------------------------------------------------------
  const eq = new Int32Array(3 * nn).fill(-1);
  const eqDof: number[] = [];
  for (let gd = 0; gd < 3 * nn; gd++) {
    if (restrained[gd] || eliminated[gd]) continue;
    eq[gd] = eqDof.length;
    eqDof.push(gd);
  }
  const nf = eqDof.length;
  const dofsOf = (m: MemberData): number[] => [0, 1, 2, 3, 4, 5].map((r) => 3 * (r < 3 ? m.ni : m.nj) + (r % 3));
  const first = Int32Array.from({ length: nf }, (_, k) => k);
  for (const m of members) {
    const eqs = dofsOf(m).map((gd) => at(eq, gd)).filter((e) => e >= 0);
    const mn = Math.min(...eqs);
    for (const e of eqs) first[e] = Math.min(at(first, e), mn);
  }
  const K = createSkyline(first);
  const F = new Float64Array(nf);
  // Desplazamientos conocidos (prescritos en GDL restringidos; 0 en el resto).
  const uKnown = new Float64Array(3 * nn);
  for (let gd = 0; gd < 3 * nn; gd++) if (restrained[gd]) uKnown[gd] = at(prescribed, gd);

  members.forEach((m, k) => {
    const kg = stiffnessToGlobal(m.T, cond(k).k);
    const dofs = dofsOf(m);
    const fe = must(feqGlobal[k]);
    dofs.forEach((ga, a) => {
      const ea = at(eq, ga);
      if (ea < 0) return;
      let rhs = at(fe, a);
      dofs.forEach((gb, b) => {
        const eb = at(eq, gb);
        if (eb >= 0) {
          if (eb >= ea) skyAdd(K, ea, eb, get(kg, a, b));
        } else {
          rhs -= get(kg, a, b) * at(uKnown, gb);
        }
      });
      F[ea] = at(F, ea) + rhs;
    });
  });
  for (let e = 0; e < nf; e++) F[e] = at(F, e) + at(nodal, at(eqDof, e));

  // ---- Factorización y resolución (§3) --------------------------------------------------------
  const dofLabel = (gd: number): { node: string; dof: string } => ({
    node: nodeIdOf(Math.floor(gd / 3)),
    dof: must(DOF_NAMES[gd % 3]),
  });
  const warnings: string[] = [];
  let U: ArrayLike<number> = new Float64Array(0);
  if (nf > 0) {
    const fac = ldlFactor(K, TOL.pivot);
    if (!fac.ok) {
      const where = dofLabel(at(eqDof, fac.index));
      const mode = mechanismMode(fac.factor, fac.index);
      return empty(
        "singular",
        `Mecanismo detectado en el nudo ${where.node}, GDL ${where.dof} (pivote relativo ${fmtRatio(fac.ratio)}); modo: ${describeMode(mode)}; revise apoyos y liberaciones`,
      );
    }
    if (fac.minRatio < TOL.pivotWarning) {
      const where = dofLabel(at(eqDof, fac.minIndex));
      const lost = Math.round(Math.log10(1 / fac.minRatio));
      warnings.push(
        `Aviso: sistema mal condicionado en el nudo ${where.node}, GDL ${where.dof} (pivote relativo ${fmtRatio(fac.minRatio)}; se pierden ≈ ${String(lost)} cifras significativas)`,
      );
    }
    U = ldlSolve(fac.factor, F);
    const res = relativeResidual(skyMatVec(K, U), F, skyNormInf(K), U);
    if (!(res <= TOL.residual)) {
      return empty("singular", `Sistema singular o mal condicionado: residuo relativo ${fmtRatio(res)}; posible desbordamiento o error interno`);
    }
  }

  function describeMode(mode: Float64Array): string {
    let maxT = 0;
    let maxR = 0;
    mode.forEach((x, e) => {
      if (at(eqDof, e) % 3 === 2) maxR = Math.max(maxR, Math.abs(x));
      else maxT = Math.max(maxT, Math.abs(x));
    });
    const items: string[] = [];
    mode.forEach((x, e) => {
      const gd = at(eqDof, e);
      const ref = gd % 3 === 2 ? maxR : maxT;
      if (Math.abs(x) >= 1e-3 * ref && x !== 0) {
        const l = dofLabel(gd);
        items.push(`${l.node}.${l.dof}`);
      }
    });
    return items.length > 10 ? `${items.slice(0, 10).join(", ")}, …` : items.join(", ");
  }

  // ---- Resultados -----------------------------------------------------------------------------
  const uAll = Float64Array.from(uKnown);
  for (let e = 0; e < nf; e++) uAll[at(eqDof, e)] = at(U, e);

  const displacements: Record<Id, Dof6> = {};
  project.nodes.forEach((n, k) => {
    displacements[n.id] = [at(uAll, 3 * k), 0, at(uAll, 3 * k + 1), 0, at(uAll, 3 * k + 2), 0];
  });

  const nodeForce = new Float64Array(3 * nn); // Σ Tᵀ·endForces por nudo (fuerzas de barra sobre nudo, cambiadas de signo)
  const memberResults: MemberResult[] = [];
  const deflections: Record<Id, DeflectionPoint[]> = {};
  const globalDeflections: Record<Id, DeflectionStation[]> = {};
  const kernelNotes: string[] = [];
  members.forEach((m, k) => {
    const c = cond(k);
    const dofs = dofsOf(m);
    const ul = toLocal6(
      m.T,
      dofs.map((gd) => at(uAll, gd)),
    );
    const ef = [0, 1, 2, 3, 4, 5].map((r) => {
      if (m.rel[r]) return 0;
      let s = at(c.f, r);
      for (let q = 0; q < 6; q++) s += get(c.k, r, q) * at(ul, q);
      return s;
    });
    const efg = toGlobal6(m.T, ef);
    dofs.forEach((gd, a) => {
      nodeForce[gd] = at(nodeForce, gd) + at(efg, a);
    });
    memberResults.push({
      member: m.id,
      endForces: {
        i: [at(ef, 0), 0, at(ef, 1), 0, at(ef, 2), 0],
        j: [at(ef, 3), 0, at(ef, 4), 0, at(ef, 5), 0],
      },
      stations: memberStations(m.props.L, ef, m.loads),
    });
    // Deformada: u_R con salto mínimo de traslaciones en los bloques con mecanismo interno sin carga (ver
    // `Condensed.recoverAttached`); en el resto, idéntico a la norma mínima de ADR-005 §1.2.
    const local = memberDeflection(m.props, m.loads, c.recoverAttached(ul));
    for (const kb of c.kernelBlocks) {
      kernelNotes.push(
        `Aviso: Barra ${m.id}: mecanismo interno sin carga que lo active (${kb.name}: ${kb.releases.join(", ")}); sus desplazamientos de extremo liberados son indeterminados y la deformada se dibuja unida a los nudos por convención`,
      );
    }
    deflections[m.id] = local;
    globalDeflections[m.id] = local.map((q) => deflectionToGlobal(m.axes, q));
  });

  const reactions: Record<Id, Dof6> = {};
  const reac3 = new Float64Array(3 * nn);
  for (const n of [...supported].sort((a, b) => a - b)) {
    for (let r = 0; r < 3; r++) {
      const gd = 3 * n + r;
      if (restrained[gd]) reac3[gd] = at(nodeForce, gd) - at(nodal, gd);
    }
    reactions[nodeIdOf(n)] = [at(reac3, 3 * n), 0, at(reac3, 3 * n + 1), 0, at(reac3, 3 * n + 2), 0];
  }

  // ---- Equilibrio global (§3.6) ---------------------------------------------------------------
  const items: { n: number; f: readonly number[] }[] = [];
  for (let n = 0; n < nn; n++) {
    items.push({ n, f: [at(nodal, 3 * n), at(nodal, 3 * n + 1), at(nodal, 3 * n + 2)] });
    if (supported.has(n)) items.push({ n, f: [at(reac3, 3 * n), at(reac3, 3 * n + 1), at(reac3, 3 * n + 2)] });
  }
  members.forEach((m, k) => {
    const fe = must(feqGlobal[k]);
    items.push({ n: m.ni, f: fe.slice(0, 3) }, { n: m.nj, f: fe.slice(3, 6) });
  });
  const e = equilibriumError(
    pos.map((p) => [p[0], p[2]] as const),
    items,
  );
  if (!(e <= TOL.equilibriumSingular)) {
    return empty(
      "singular",
      `Sistema singular o mal condicionado: desequilibrio relativo ${fmtRatio(e)}; revise rigideces muy dispares (EA o EI enormes) y liberaciones`,
    );
  }
  if (e > TOL.equilibriumWarning) {
    warnings.push(`Aviso: desequilibrio global relativo ${fmtRatio(e)}; revise rigideces muy dispares (EA o EI enormes)`);
  }
  warnings.push(...kernelNotes);

  const indeterminate: Record<Id, number[]> = {};
  for (let n = 0; n < nn; n++) {
    if (eliminated[3 * n + 2] && !restrained[3 * n + 2]) indeterminate[nodeIdOf(n)] = [4];
  }

  const result: SolveResult = {
    status: "ok",
    ...(warnings.length > 0 ? { message: warnings.join("; ") } : {}),
    displacements,
    reactions,
    members: memberResults,
    ...(Object.keys(indeterminate).length > 0 ? { indeterminateDofs: indeterminate } : {}),
    deflections: globalDeflections,
  };
  return { result, deflections };
}

/**
 * Punto de la deformada local (u axil según x̂, w transversal según ẑ) a ejes globales (ADR-006 §3):
 * d = u·x̂ + w·ẑ. En "2D-XZ" x̂ y ẑ están en el plano X–Z, así que uy = 0 exacto.
 */
export function deflectionToGlobal(ax: LocalAxes, q: DeflectionPoint): DeflectionStation {
  return { x: q.x, d: [q.u * ax.x[0] + q.w * ax.z[0], 0, q.u * ax.x[2] + q.w * ax.z[2]] };
}

function clamp(a: number, L: number): number {
  return Math.min(Math.max(a, 0), L);
}

/** Añade una carga distribuida lineal (por longitud real) a la barra, transformándola a ejes locales. */
function addDist(m: MemberData, a0: number, b0: number, w1: V3, w2: V3, frame: "local" | "global"): void {
  const L = m.props.L;
  const len0 = b0 - a0; // > 0: validateProject exige a < b; el peso propio usa [0, L] con L > 0
  const a = clamp(a0, L);
  const b = clamp(b0, L);
  // validateProject admite b ≤ L + 1e-9: al recortar a [0, L] los valores de extremo se reinterpolan sobre la ley
  // original (si no, un trapecio que sobresale cambiaría de pendiente).
  const lerp = (s: number): V3 => {
    const t = (s - a0) / len0;
    return [w1[0] + (w2[0] - w1[0]) * t, w1[1] + (w2[1] - w1[1]) * t, w1[2] + (w2[2] - w1[2]) * t];
  };
  const g1 = lerp(a);
  const g2 = lerp(b);
  const l1 = frame === "local" ? g1 : toLocal(m.axes, g1);
  const l2 = frame === "local" ? g2 : toLocal(m.axes, g2);
  if (l1[0] === 0 && l1[2] === 0 && l2[0] === 0 && l2[2] === 0) return;
  if (b - a > 1e-9 * L) {
    m.loads.dist.push({ a, b, wx1: l1[0], wx2: l2[0], wz1: l1[2], wz2: l2[2] });
    return;
  }
  // Tramo de longitud ≤ 1e-9·L (también el que queda tras recortar): su interpolación lineal y la malla de
  // estaciones no lo resuelven, pero su resultante puede no ser despreciable (p. ej. 1e8 kN/m en 2e-9 m = 0.2 kN).
  // Se sustituye por la fuerza puntual equivalente en el punto medio: conserva exactamente la resultante y el
  // error de posición es ≤ 0.5e-9·L (el par residual respecto al centroide es ≤ |Δw|·len²/12, despreciable).
  const len = b - a;
  if (!(len > 0)) return;
  const px = ((l1[0] + l2[0]) / 2) * len;
  const pz = ((l1[2] + l2[2]) / 2) * len;
  if (px !== 0 || pz !== 0) m.loads.forces.push({ a: (a + b) / 2, px, pz });
}

/** Residuo relativo ‖K·U − F‖∞ / (‖F‖∞ + ‖K‖∞·‖U‖∞) (ADR-005 §3.5); 0 si el denominador es 0. */
export function relativeResidual(KU: ArrayLike<number>, F: ArrayLike<number>, normK: number, U: ArrayLike<number>): number {
  const r = Array.from(KU, (v, k) => v - at(F, k));
  const den = normInf(F) + normK * normInf(U);
  const num = normInf(r);
  if (den === 0) return num === 0 ? 0 : Infinity;
  return num / den;
}

/**
 * Error de equilibrio global relativo (ADR-005 §3.6) en el plano X–Z. `items`: acciones aplicadas en los nudos
 * (cargas nodales, cargas equivalentes de barra por extremo, reacciones), cada una [Fx, Fz, M_Y].
 * Momentos respecto al centroide de los nudos: M_Y de una fuerza en (dx, dz) = dz·Fx − dx·Fz.
 */
export function equilibriumError(coords: readonly (readonly [number, number])[], items: readonly { n: number; f: readonly number[] }[]): number {
  const nn = coords.length;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of coords) {
    cx += x / nn;
    cz += z / nn;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  let sx = 0;
  let sz = 0;
  let sm = 0;
  let denF = 0;
  let denM = 0;
  for (const it of items) {
    const [x, z] = must(coords[it.n]);
    const fx = at(it.f, 0);
    const fz = at(it.f, 1);
    const my = at(it.f, 2);
    const arm = (z - cz) * fx - (x - cx) * fz;
    sx += fx;
    sz += fz;
    sm += arm + my;
    denF += Math.max(Math.abs(fx), Math.abs(fz));
    denM += Math.abs(arm) + Math.abs(my);
  }
  if (denM === 0) denM = Math.max(maxX - minX, maxZ - minZ) * denF;
  const eF = denF > 0 ? Math.max(Math.abs(sx), Math.abs(sz)) / denF : 0;
  const eM = denM > 0 ? Math.abs(sm) / denM : 0;
  return Math.max(eF, eM);
}
