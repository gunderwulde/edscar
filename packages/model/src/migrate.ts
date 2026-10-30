/**
 * Migraciones de `.edscar.json` por `schemaVersion`. Original, escrito desde cero.
 * Cada migración transforma la versión N en N+1 sobre una copia (la entrada no se muta).
 */
import { CURRENT_SCHEMA_VERSION } from "./schema";
import { validateProject, type ValidationError, type ValidationResult } from "./validate";

type Json = Record<string, unknown>;

export interface Migration {
  /** Versión de origen; produce `from + 1`. */
  from: number;
  description: string;
  apply: (doc: Json) => Json;
}

/**
 * v0 → v1: el gradiente térmico de barra `gradient` (°C/m, ∂T/∂z local) pasa a llamarse `gradientZ`
 * (ADR-001 §5.1), que deja sitio a `gradientY`. Un documento sin `schemaVersion` se trata como versión 0.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 0,
    description: "Renombra thermal.gradient a thermal.gradientZ",
    apply: (doc) => {
      const loads = doc["loads"];
      if (Array.isArray(loads)) {
        doc["loads"] = loads.map((ld: unknown) => {
          if (typeof ld !== "object" || ld === null) return ld;
          const { gradient, ...rest } = ld as Json;
          if (rest["type"] !== "thermal" || gradient === undefined) return ld;
          return "gradientZ" in rest ? rest : { ...rest, gradientZ: gradient };
        });
      }
      return doc;
    },
  },
];

export type MigrationResult =
  | { ok: true; data: Json; from: number; to: number }
  | { ok: false; errors: ValidationError[] };

const fail = (path: string, code: string, message: string): MigrationResult => ({
  ok: false,
  errors: [{ path, code, message }],
});

/**
 * Lleva `raw` (JSON parseado) hasta `target` (por defecto la versión actual) aplicando las migraciones
 * en orden. No valida el resultado (ver `loadProject`).
 */
export function migrateProject(
  raw: unknown,
  target: number = CURRENT_SCHEMA_VERSION,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("", "not-an-object", "El proyecto debe ser un objeto JSON");
  }
  let doc = structuredClone(raw) as Json;
  const v = "schemaVersion" in doc ? doc["schemaVersion"] : 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    return fail("schemaVersion", "schema-version", "schemaVersion debe ser un entero ≥ 0");
  }
  if (v > target) {
    return fail(
      "schemaVersion",
      "schema-version-newer",
      `El fichero es de la versión ${String(v)}, más reciente que la soportada (${String(target)})`,
    );
  }
  for (let cur = v; cur < target; cur++) {
    const step = migrations.find((m) => m.from === cur);
    if (!step) {
      return fail("schemaVersion", "migration-missing", `No hay migración de la versión ${String(cur)} a ${String(cur + 1)}`);
    }
    doc = step.apply(doc);
    doc["schemaVersion"] = cur + 1;
  }
  return { ok: true, data: doc, from: v, to: target };
}

/** Migra y valida: punto de entrada para cargar un `.edscar.json`. */
export function loadProject(raw: unknown): ValidationResult {
  const m = migrateProject(raw);
  return m.ok ? validateProject(m.data) : m;
}
