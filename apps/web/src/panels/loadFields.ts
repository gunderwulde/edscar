/**
 * Campos editables de cada variante de carga del modelo (lógica pura, sin React). La misma definición alimenta el
 * panel de propiedades y la tabla de datos. Todos los valores están en SI; la conversión a unidades de
 * presentación la hace la capa de UI según `quantity`.
 */
import type { Dof6, Load, Project, Vec3 } from "@edscar/model";
import type { MessageKey } from "./i18n";
import type { Quantity } from "./units";

/** Cambio a pasar a `<entidad>.update`. */
export interface FieldChange { patch: Record<string, unknown>; unset?: string[] }

export interface NumberFieldDef {
  kind: "number";
  id: string;
  label: string;
  quantity: Quantity;
  value: number | null;
  /** true: se puede dejar vacío (la propiedad se elimina). */
  optional: boolean;
  apply: (v: number | null) => FieldChange;
}
export interface BoolFieldDef {
  kind: "bool";
  id: string;
  label: string;
  labelKey?: MessageKey;
  value: boolean;
  apply: (v: boolean) => FieldChange;
}
export interface ChoiceFieldDef {
  kind: "choice";
  id: string;
  label: string;
  labelKey?: MessageKey;
  value: string;
  options: readonly { value: string; labelKey: MessageKey }[];
  apply: (v: string) => FieldChange;
}
export type FieldDef = NumberFieldDef | BoolFieldDef | ChoiceFieldDef;

const AXES = ["x", "y", "z"] as const;
/** Índices de componente visibles: en 2D-XZ solo X y Z. */
const comps = (analysis: Project["analysis"]): readonly number[] => (analysis === "3D" ? [0, 1, 2] : [0, 2]);

function withVec(v: Vec3, i: number, x: number): Vec3 {
  const out: [number, number, number] = [v[0], v[1], v[2]];
  out[i] = x;
  return out;
}
function withDof(v: Dof6, i: number, x: number): Dof6 {
  const out: [number, number, number, number, number, number] = [v[0], v[1], v[2], v[3], v[4], v[5]];
  out[i] = x;
  return out;
}

function vecFields(
  key: string, prefix: string, v: Vec3, quantity: Quantity, analysis: Project["analysis"],
): NumberFieldDef[] {
  return comps(analysis).map((i): NumberFieldDef => ({
    kind: "number", id: `${key}${String(i)}`, label: `${prefix}${AXES[i] ?? ""}`, quantity, value: v[i] ?? 0, optional: false,
    apply: (x) => ({ patch: { [key]: withVec(v, i, x ?? 0) } }),
  }));
}

function momentFields(key: string, prefix: string, v: Vec3, analysis: Project["analysis"]): NumberFieldDef[] {
  const idx = analysis === "3D" ? [0, 1, 2] : [1];
  return idx.map((i): NumberFieldDef => ({
    kind: "number", id: `${key}${String(i)}`, label: `${prefix}${AXES[i] ?? ""}`, quantity: "moment", value: v[i] ?? 0, optional: false,
    apply: (x) => ({ patch: { [key]: withVec(v, i, x ?? 0) } }),
  }));
}

const frameField = (frame: "local" | "global"): ChoiceFieldDef => ({
  kind: "choice", id: "frame", label: "frame", labelKey: "load.frame", value: frame,
  options: [{ value: "global", labelKey: "load.frame.global" }, { value: "local", labelKey: "load.frame.local" }],
  apply: (v) => ({ patch: { frame: v } }),
});

const optionalNumber = (key: string, label: string, quantity: Quantity, value: number | undefined): NumberFieldDef => ({
  kind: "number", id: key, label, quantity, value: value ?? null, optional: true,
  apply: (x) => (x === null ? { patch: {}, unset: [key] } : { patch: { [key]: x } }),
});
const requiredNumber = (key: string, label: string, quantity: Quantity, value: number): NumberFieldDef => ({
  kind: "number", id: key, label, quantity, value, optional: false, apply: (x) => ({ patch: { [key]: x ?? 0 } }),
});

/** Campos editables de una carga (sin patrón ni destino, que se editan aparte). */
export function loadFields(load: Load, analysis: Project["analysis"]): FieldDef[] {
  switch (load.type) {
    case "nodal":
      return [...vecFields("f", "F", load.f, "force", analysis), ...momentFields("m", "M", load.m, analysis)];
    case "member-uniform":
      return [
        ...vecFields("w", "w", load.w, "distributed", analysis), frameField(load.frame),
        optionalNumber("a", "a", "length", load.a), optionalNumber("b", "b", "length", load.b),
      ];
    case "member-trapezoid":
      return [
        ...vecFields("w1", "w1", load.w1, "distributed", analysis), ...vecFields("w2", "w2", load.w2, "distributed", analysis),
        frameField(load.frame), requiredNumber("a", "a", "length", load.a), requiredNumber("b", "b", "length", load.b),
      ];
    case "member-point": {
      const m = load.m ?? [0, 0, 0];
      return [
        ...vecFields("p", "P", load.p, "force", analysis), ...momentFields("m", "M", m, analysis), frameField(load.frame),
        {
          kind: "number", id: "at", label: "at", quantity: load.relative ? "factor" : "length", value: load.at, optional: false,
          apply: (x) => ({ patch: { at: x ?? 0 } }),
        },
        {
          kind: "bool", id: "relative", label: "relative", labelKey: "load.relative", value: load.relative,
          apply: (v) => ({ patch: { relative: v } }),
        },
      ];
    }
    case "thermal": {
      const f: FieldDef[] = [requiredNumber("dT", "ΔT", "tempDelta", load.dT), optionalNumber("gradientZ", "∂T/∂z", "gradient", load.gradientZ)];
      if (analysis === "3D") f.push(optionalNumber("gradientY", "∂T/∂y", "gradient", load.gradientY));
      return f;
    }
    case "support-displacement": {
      const idx = analysis === "3D" ? [0, 1, 2, 3, 4, 5] : [0, 2, 4];
      const names = ["ux", "uy", "uz", "rx", "ry", "rz"];
      return idx.map((i): NumberFieldDef => ({
        kind: "number", id: `d${String(i)}`, label: names[i] ?? "", quantity: i < 3 ? "smallLength" : "angle", value: load.d[i] ?? 0, optional: false,
        apply: (x) => ({ patch: { d: withDof(load.d, i, x ?? 0) } }),
      }));
    }
  }
}

/** Clave de i18n del nombre del tipo de carga. */
export function loadTypeKey(load: Pick<Load, "type"> & Partial<Pick<Extract<Load, { type: "member-point" }>, "p" | "m">>): MessageKey {
  if (load.type === "member-point" && load.p && load.p.every((c) => c === 0) && load.m && load.m.some((c) => c !== 0)) {
    return "load.type.moment";
  }
  const map: Record<Load["type"], MessageKey> = {
    nodal: "load.type.nodal", "member-uniform": "load.type.uniform", "member-trapezoid": "load.type.trapezoid",
    "member-point": "load.type.point", thermal: "load.type.thermal", "support-displacement": "load.type.displacement",
  };
  return map[load.type];
}

/** Elemento al que se aplica la carga. */
export function loadTarget(load: Load): { kind: "node" | "member"; id: string } {
  return "node" in load ? { kind: "node", id: load.node } : { kind: "member", id: load.member };
}
