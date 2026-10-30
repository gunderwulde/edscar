/**
 * Portico plano de un vano, bases empotradas. h=4 m, L=6 m, EI=20000 en todas las barras (Iy=1e-4, E=2e8).
 * Idealizacion de la referencia: axil rigido. El modelo usa A=5000 m2 (EA=1e12 kN) => el error relativo
 * por deformacion axil es del orden de EI/(EA h^2) ~ 1e-9, muy por debajo de la tolerancia 1e-6.
 * Nudos: A(0,0,0), N1(0,0,h), N2(L,0,h), B(L,0,0). Barras: P1 A->N1, V N1->N2, P2 B->N2 (pilares exactamente verticales).
 */
import type { Load, Project } from "@edscar/model";
import { buildProject, nodalLoad, SUP } from "../builders";
import { registerCase } from "../harness";
import type { Variant } from "../harness";
import { portalFrame } from "../reference";
import type { Tol } from "../compare";

const h = 4;
const L = 6;
const EI = 20000;
// Tolerancias: giros/flechas de ~1e-3 m; el axil rigido aporta ~1e-9 relativo; los ceros (uz de nudos) ~1e-10 m.
const tol: Tol = { rel: 1e-6, absForce: 1e-6, absDisp: 5e-9 };

function build(H: number, w: number): Project {
  const loads: Load[] = [];
  if (H !== 0) loads.push(nodalLoad("H1", "N1", [H, 0, 0]));
  if (w !== 0) {
    loads.push({ id: "W1", pattern: "G", type: "member-uniform", member: "V", w: [0, 0, -w], frame: "global" });
  }
  return buildProject({
    nodes: [
      { id: "A", x: 0, y: 0, z: 0 },
      { id: "N1", x: 0, y: 0, z: h },
      { id: "N2", x: L, y: 0, z: h },
      { id: "B", x: L, y: 0, z: 0 },
    ],
    members: [
      { id: "P1", i: "A", j: "N1", material: "M1", section: "S1" },
      { id: "V", i: "N1", j: "N2", material: "M1", section: "S1" },
      { id: "P2", i: "B", j: "N2", material: "M1", section: "S1" },
    ],
    supports: [
      { id: "SA", node: "A", fixed: SUP.fixed },
      { id: "SB", node: "B", fixed: SUP.fixed },
    ],
    loads,
    A: 5000,
    Iy: 1e-4,
  });
}

const variants: Variant[] = [
  { name: "carga lateral H=30 kN en N1", build: () => build(30, 0), ref: portalFrame({ h, L, EI, H: 30, w: 0 }), tol },
  { name: "carga uniforme w=20 kN/m en la viga", build: () => build(0, 20), ref: portalFrame({ h, L, EI, H: 0, w: 20 }), tol },
  { name: "combinado H=30 y w=20", build: () => build(30, 20), ref: portalFrame({ h, L, EI, H: 30, w: 20 }), tol },
];
registerCase("Portico plano de un vano", variants);
