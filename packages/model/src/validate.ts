/**
 * Validación de un proyecto: estructura (Zod) y reglas semánticas. Original, escrito desde cero.
 * Reglas 2D-XZ: ADR-001 §2.1. Un Support por nudo: ADR-001 §2.2.
 */
import type { Load, Project } from "./index";
import { CURRENT_SCHEMA_VERSION, ProjectSchema } from "./schema";

export interface ValidationError {
  /** Ruta tipo `members[2].i`; cadena vacía = raíz del proyecto. */
  path: string;
  /** Código estable legible por máquina. */
  code: string;
  message: string;
}

export type ValidationResult = { ok: true; project: Project } | { ok: false; errors: ValidationError[] };

/** Tolerancia absoluta (m, rad) de ADR-001 §2.1 y de posiciones en barra. */
const TOL = 1e-9;

const fmtPath = (segments: readonly PropertyKey[]): string => {
  let out = "";
  for (const s of segments) {
    out += typeof s === "number" ? `[${String(s)}]` : out === "" ? String(s) : `.${String(s)}`;
  }
  return out;
};

type Report = (path: string, code: string, message: string) => void;

/** Valida `input` (JSON ya parseado) contra el esquema v1 y las reglas semánticas. */
export function validateProject(input: unknown): ValidationResult {
  const parsed = ProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: fmtPath(i.path), code: "schema", message: i.message })),
    };
  }
  const project: Project = parsed.data;
  const errors: ValidationError[] = [];
  const err: Report = (path, code, message) => {
    errors.push({ path, code, message });
  };
  const idx = (k: number): string => String(k);

  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    err(
      "schemaVersion",
      "schema-version",
      `schemaVersion ${String(project.schemaVersion)} no es la versión actual (${String(CURRENT_SCHEMA_VERSION)}); use migrateProject antes de validar`,
    );
  }

  checkUniqueIds(project, err);

  const nodeById = new Map(project.nodes.map((n) => [n.id, n]));
  const materialIds = new Set(project.materials.map((m) => m.id));
  const sectionIds = new Set(project.sections.map((s) => s.id));
  const patternIds = new Set(project.patterns.map((p) => p.id));
  const caseIds = new Set(project.cases.map((c) => c.id));
  const combinationIds = new Set(project.combinations.map((c) => c.id));
  const memberIds = new Set(project.members.map((m) => m.id));
  const supportByNode = new Map<string, Project["supports"][number]>();
  const lengthOf = new Map<string, number>();

  project.members.forEach((m, k) => {
    const p = `members[${idx(k)}]`;
    const ni = nodeById.get(m.i);
    const nj = nodeById.get(m.j);
    if (!ni) err(`${p}.i`, "dangling-ref", `El nudo "${m.i}" no existe`);
    if (!nj) err(`${p}.j`, "dangling-ref", `El nudo "${m.j}" no existe`);
    if (!materialIds.has(m.material)) err(`${p}.material`, "dangling-ref", `El material "${m.material}" no existe`);
    if (!sectionIds.has(m.section)) err(`${p}.section`, "dangling-ref", `La sección "${m.section}" no existe`);
    if (m.i === m.j) {
      err(p, "member-degenerate", `La barra "${m.id}" une el nudo "${m.i}" consigo mismo`);
    } else if (ni && nj) {
      const L = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
      if (L > 0) lengthOf.set(m.id, L);
      else err(p, "member-zero-length", `La barra "${m.id}" tiene longitud 0 (nudos coincidentes)`);
    }
  });

  project.supports.forEach((s, k) => {
    const p = `supports[${idx(k)}]`;
    if (!nodeById.has(s.node)) err(`${p}.node`, "dangling-ref", `El nudo "${s.node}" no existe`);
    if (supportByNode.has(s.node)) {
      err(`${p}.node`, "duplicate-support", `El nudo "${s.node}" ya tiene un apoyo (máximo uno por nudo)`);
    } else {
      supportByNode.set(s.node, s);
    }
  });

  project.cases.forEach((c, k) => {
    c.terms.forEach((t, q) => {
      if (!patternIds.has(t.pattern)) {
        err(`cases[${idx(k)}].terms[${idx(q)}].pattern`, "dangling-ref", `El patrón "${t.pattern}" no existe`);
      }
    });
  });

  project.combinations.forEach((c, k) => {
    c.terms.forEach((t, q) => {
      const known = t.refType === "case" ? caseIds : combinationIds;
      if (!known.has(t.ref)) {
        const what = t.refType === "case" ? "El caso" : "La combinación";
        err(`combinations[${idx(k)}].terms[${idx(q)}].ref`, "dangling-ref", `${what} "${t.ref}" no existe`);
      }
    });
  });
  checkCombinationCycles(project, err);

  const is2D = project.analysis === "2D-XZ";

  if (is2D) {
    project.nodes.forEach((n, k) => {
      if (Math.abs(n.y) > TOL) {
        err(`nodes[${idx(k)}].y`, "2d-out-of-plane", `En 2D-XZ todos los nudos deben tener y = 0 (nudo "${n.id}": y = ${String(n.y)})`);
      }
    });
    project.members.forEach((m, k) => {
      if (m.rotation !== undefined && !isZeroOrPi(m.rotation)) {
        err(`members[${idx(k)}].rotation`, "2d-rotation", `En 2D-XZ rotation debe ser 0 o π (barra "${m.id}": ${String(m.rotation)})`);
      }
    });
    if (project.settings.gravity[1] !== 0 && project.patterns.some((p) => p.selfWeightFactor !== 0)) {
      err("settings.gravity", "2d-gravity", "En 2D-XZ, con peso propio activo (selfWeightFactor ≠ 0), gravity[1] debe ser 0");
    }
  }

  const checkRange = (a: number, b: number, L: number | undefined, p: string): void => {
    const upper = L === undefined ? Infinity : L + TOL;
    if (!(a >= -TOL && a < b && b <= upper)) {
      const lim = L === undefined ? "" : `, L = ${String(L)} m`;
      err(p, "load-range", `Se exige 0 ≤ a < b ≤ L (a = ${String(a)}, b = ${String(b)}${lim})`);
    }
  };

  const checkLoad = (ld: Load, p: string): void => {
    let L: number | undefined;
    if (ld.type === "nodal" || ld.type === "support-displacement") {
      if (!nodeById.has(ld.node)) err(`${p}.node`, "dangling-ref", `El nudo "${ld.node}" no existe`);
    } else {
      if (!memberIds.has(ld.member)) err(`${p}.member`, "dangling-ref", `La barra "${ld.member}" no existe`);
      L = lengthOf.get(ld.member);
    }

    switch (ld.type) {
      case "nodal":
        if (is2D) {
          if (ld.f[1] !== 0) err(`${p}.f`, "2d-out-of-plane", "En 2D-XZ la fuerza nodal debe tener f[1] = 0");
          if (ld.m[0] !== 0 || ld.m[2] !== 0) {
            err(`${p}.m`, "2d-out-of-plane", "En 2D-XZ el momento nodal solo puede tener m[1] (alrededor de Y)");
          }
        }
        break;
      case "member-uniform":
        checkRange(ld.a ?? 0, ld.b ?? L ?? Infinity, L, p);
        if (is2D && ld.w[1] !== 0) {
          err(`${p}.w`, "2d-out-of-plane", "En 2D-XZ la componente Y (global o local) de w debe ser 0");
        }
        break;
      case "member-trapezoid":
        checkRange(ld.a, ld.b, L, p);
        if (is2D && (ld.w1[1] !== 0 || ld.w2[1] !== 0)) {
          err(`${p}.w1`, "2d-out-of-plane", "En 2D-XZ la componente Y (global o local) de w1 y w2 debe ser 0");
        }
        break;
      case "member-point":
        if (ld.relative) {
          if (!(ld.at >= 0 && ld.at <= 1)) {
            err(`${p}.at`, "load-range", `Con relative = true, at debe estar en [0, 1] (at = ${String(ld.at)})`);
          }
        } else if (!(ld.at >= -TOL && ld.at <= (L === undefined ? Infinity : L + TOL))) {
          err(`${p}.at`, "load-range", `at debe estar en [0, L] (at = ${String(ld.at)}${L === undefined ? "" : `, L = ${String(L)} m`})`);
        }
        if (is2D) {
          if (ld.p[1] !== 0) err(`${p}.p`, "2d-out-of-plane", "En 2D-XZ la componente Y (global o local) de p debe ser 0");
          if (ld.m && (ld.m[0] !== 0 || ld.m[2] !== 0)) {
            err(`${p}.m`, "2d-out-of-plane", "En 2D-XZ el momento puntual solo admite m[1] (alrededor de Y global o my local)");
          }
        }
        break;
      case "thermal":
        if (is2D && ld.gradientY !== undefined && ld.gradientY !== 0) {
          err(`${p}.gradientY`, "2d-out-of-plane", "En 2D-XZ gradientY debe ser 0 o ausente");
        }
        break;
      case "support-displacement": {
        const sup = supportByNode.get(ld.node);
        ld.d.forEach((v, c) => {
          if (v === 0) return;
          if (!sup?.fixed[c]) {
            err(`${p}.d[${idx(c)}]`, "displacement-free-dof", `Desplazamiento impuesto no nulo en un GDL libre (nudo "${ld.node}", GDL ${idx(c)})`);
          } else if (is2D && (c === 1 || c === 3 || c === 5)) {
            err(`${p}.d[${idx(c)}]`, "2d-out-of-plane", "En 2D-XZ los desplazamientos impuestos en uy, rx y rz deben ser 0");
          }
        });
        break;
      }
    }
  };

  project.loads.forEach((ld, k) => {
    const p = `loads[${idx(k)}]`;
    if (!patternIds.has(ld.pattern)) err(`${p}.pattern`, "dangling-ref", `El patrón "${ld.pattern}" no existe`);
    checkLoad(ld, p);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, project };
}

function isZeroOrPi(angle: number): boolean {
  const twoPi = 2 * Math.PI;
  const r = ((angle % twoPi) + twoPi) % twoPi; // [0, 2π)
  return r <= TOL || twoPi - r <= TOL || Math.abs(r - Math.PI) <= TOL;
}

function checkUniqueIds(project: Project, err: Report): void {
  const groups: [string, readonly { id: string }[]][] = [
    ["nodes", project.nodes], ["members", project.members], ["materials", project.materials],
    ["sections", project.sections], ["supports", project.supports], ["patterns", project.patterns],
    ["loads", project.loads], ["cases", project.cases], ["combinations", project.combinations],
  ];
  for (const [name, items] of groups) {
    const seen = new Set<string>();
    items.forEach((it, k) => {
      if (seen.has(it.id)) err(`${name}[${String(k)}].id`, "duplicate-id", `Id duplicado "${it.id}" en ${name}`);
      seen.add(it.id);
    });
  }
}

/** Detecta ciclos entre combinaciones (DFS con colores); informa una vez por arista de retroceso. */
function checkCombinationCycles(project: Project, err: Report): void {
  const byId = new Map<string, number>();
  project.combinations.forEach((c, k) => {
    if (!byId.has(c.id)) byId.set(c.id, k);
  });
  const state = new Map<string, 1 | 2>(); // 1 = en curso, 2 = terminado
  const stack: string[] = [];

  const visit = (id: string, k: number): void => {
    state.set(id, 1);
    stack.push(id);
    project.combinations[k]?.terms.forEach((t, q) => {
      const target = byId.get(t.ref);
      if (t.refType !== "combination" || target === undefined) return;
      const s = state.get(t.ref);
      if (s === 1) {
        const cycle = [...stack.slice(stack.indexOf(t.ref)), t.ref].join(" -> ");
        err(`combinations[${String(k)}].terms[${String(q)}].ref`, "combination-cycle", `Ciclo entre combinaciones: ${cycle}`);
      } else if (s === undefined) {
        visit(t.ref, target);
      }
    });
    stack.pop();
    state.set(id, 2);
  };
  for (const [id, k] of byId) if (!state.has(id)) visit(id, k);
}
