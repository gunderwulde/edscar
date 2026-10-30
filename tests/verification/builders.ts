/**
 * Constructores de modelos para el banco de verificacion. Construyen `Project` y los validan siempre con
 * `validateProject` de @edscar/model. Unidades SI (ADR-001). Los esperados NO se calculan aqui.
 */
import { validateProject } from "@edscar/model";
import type { Load, Member, Node, Project, Support } from "@edscar/model";
import type { BeamRef, CaseRef, Dof6, MemberRef } from "./reference";

type Fixed6 = Support["fixed"];

/** Apoyos habituales en el plano X-Z (uy, rx, rz los restringe el solver internamente en 2D-XZ). */
export const SUP = {
  pinned: [true, false, true, false, false, false] as Fixed6,
  roller: [false, false, true, false, false, false] as Fixed6,
  fixed: [true, false, true, false, true, false] as Fixed6,
  /** Para 3D: apoyo con torsion y desplazamientos coartados. */
  pinned3D: [true, true, true, true, false, false] as Fixed6,
  roller3D: [false, true, true, false, false, false] as Fixed6,
};

/** Valida con @edscar/model y devuelve el proyecto tipado; lanza con los errores si no es valido. */
export function mustValidate(input: unknown): Project {
  const r = validateProject(input);
  if (!r.ok) {
    throw new Error(`Modelo de verificacion invalido: ${JSON.stringify(r.errors)}`);
  }
  return r.project;
}

export interface ProjectParts {
  analysis?: "2D-XZ" | "3D";
  nodes: Node[];
  members: Member[];
  supports: Support[];
  loads: Load[];
  E?: number;
  G?: number;
  alpha?: number;
  rho?: number;
  A: number;
  Iy: number;
  Iz?: number;
  J?: number;
  selfWeightFactor?: number;
  gravity?: readonly [number, number, number];
}

/** Un material, una seccion, un patron "G", un caso "C1" con factor 1. */
export function buildProject(p: ProjectParts): Project {
  return mustValidate({
    schemaVersion: 1,
    units: "SI",
    analysis: p.analysis ?? "2D-XZ",
    nodes: p.nodes,
    members: p.members,
    materials: [
      { id: "M1", name: "Material de verificacion", E: p.E ?? 2e8, G: p.G ?? 8e7, density: p.rho ?? 0, alpha: p.alpha ?? 1.2e-5 },
    ],
    sections: [{ id: "S1", name: "Seccion de verificacion", A: p.A, Iy: p.Iy, Iz: p.Iz ?? p.Iy, J: p.J ?? 1e-5 }],
    supports: p.supports,
    patterns: [{ id: "G", name: "Patron", kind: "D", selfWeightFactor: p.selfWeightFactor ?? 0 }],
    loads: p.loads,
    cases: [{ id: "C1", name: "Caso", type: "static-linear", terms: [{ pattern: "G", factor: 1 }] }],
    combinations: [],
    settings: { gravity: p.gravity ?? [0, 0, -9.81] },
  });
}

export const nodeId = (k: number): string => `N${String(k)}`;
export const memberId = (k: number): string => `M${String(k)}`;

export interface BeamBuild {
  /** Abscisas de los nudos a lo largo de X (una barra entre cada par consecutivo). */
  xs: number[];
  /** Apoyos por abscisa (deben coincidir con un nudo). */
  supports: { x: number; fixed: Fixed6 }[];
  /** Cargas, construidas con los ids de nudos y barras. */
  loads: (ids: { node: (k: number) => string; member: (k: number) => string; n: number }) => Load[];
  A: number;
  Iy: number;
  Iz?: number;
  E?: number;
  alpha?: number;
  rho?: number;
  selfWeightFactor?: number;
  gravity?: readonly [number, number, number];
  analysis?: "2D-XZ" | "3D";
  rotation?: number;
}

export function indexOfX(xs: readonly number[], x: number): number {
  const k = xs.findIndex((v) => Math.abs(v - x) < 1e-12);
  if (k < 0) throw new Error(`No hay nudo en x=${String(x)}`);
  return k;
}

/** Viga horizontal sobre el eje X con nudos en `xs` (y = z = 0). */
export function buildBeam(b: BeamBuild): Project {
  const nodes: Node[] = b.xs.map((x, k) => ({ id: nodeId(k), x, y: 0, z: 0 }));
  const members: Member[] = [];
  for (let k = 0; k + 1 < b.xs.length; k++) {
    members.push({
      id: memberId(k),
      i: nodeId(k),
      j: nodeId(k + 1),
      material: "M1",
      section: "S1",
      ...(b.rotation === undefined ? {} : { rotation: b.rotation }),
    });
  }
  const supports: Support[] = b.supports.map((s, k) => ({
    id: `S${String(k)}`,
    node: nodeId(indexOfX(b.xs, s.x)),
    fixed: s.fixed,
  }));
  const loads = b.loads({ node: nodeId, member: memberId, n: members.length });
  return buildProject({
    nodes,
    members,
    supports,
    loads,
    A: b.A,
    Iy: b.Iy,
    ...(b.Iz === undefined ? {} : { Iz: b.Iz }),
    ...(b.E === undefined ? {} : { E: b.E }),
    ...(b.alpha === undefined ? {} : { alpha: b.alpha }),
    ...(b.rho === undefined ? {} : { rho: b.rho }),
    ...(b.selfWeightFactor === undefined ? {} : { selfWeightFactor: b.selfWeightFactor }),
    ...(b.gravity === undefined ? {} : { gravity: b.gravity }),
    ...(b.analysis === undefined ? {} : { analysis: b.analysis }),
  });
}

/** Proyecta una referencia de viga (abscisa global) sobre una malla de nudos `xs`: CaseRef para `compareCase`. */
export function beamToCase(
  ref: BeamRef,
  xs: readonly number[],
  opts: { node?: (k: number) => string; member?: (k: number) => string } = {},
): CaseRef {
  const nid = opts.node ?? nodeId;
  const mid = opts.member ?? memberId;
  const reactions: Record<string, Dof6> = {};
  for (const r of ref.reactions) reactions[nid(indexOfX(xs, r.x))] = r.R;
  const members: Record<string, MemberRef> = {};
  for (let k = 0; k + 1 < xs.length; k++) {
    const x0 = xs[k] ?? 0;
    const x1 = xs[k + 1] ?? 0;
    members[mid(k)] = {
      length: x1 - x0,
      forces: (x, side) => ref.forces(x0 + x, side),
      jumps: ref.jumps.filter((j) => j > x0 + 1e-9 && j < x1 - 1e-9).map((j) => j - x0),
    };
  }
  const nodeDisp: CaseRef["nodeDisp"] = {};
  xs.forEach((x, k) => {
    nodeDisp[nid(k)] = {
      uz: ref.uz(x),
      ry: ref.thetaY(x),
      ...(ref.ux ? { ux: ref.ux(x) } : {}),
    };
  });
  return { id: ref.id, reactions, members, nodeDisp };
}

/** Carga uniforme w=[0,0,-q] en todas las barras de la malla. */
export function udlAll(q: number, frame: "global" | "local"): BeamBuild["loads"] {
  return ({ member, n }) =>
    Array.from({ length: n }, (_, k) => ({
      id: `L${String(k)}`,
      pattern: "G",
      type: "member-uniform" as const,
      member: member(k),
      w: [0, 0, -q] as const,
      frame,
    }));
}

/** Carga nodal global. */
export function nodalLoad(id: string, node: string, f: readonly [number, number, number], m: readonly [number, number, number] = [0, 0, 0]): Load {
  return { id, pattern: "G", type: "nodal", node, f, m };
}
