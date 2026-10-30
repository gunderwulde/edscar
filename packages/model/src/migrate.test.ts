import { describe, expect, it } from "vitest";
import example from "../examples/viga-biapoyada.edscar.json";
import { CURRENT_SCHEMA_VERSION } from "./schema";
import { loadProject, migrateProject, MIGRATIONS, type Migration } from "./migrate";

/** Documento v0: sin schemaVersion y con `gradient` en la carga térmica. */
const v0 = (): Record<string, unknown> => {
  const doc = structuredClone(example) as unknown as Record<string, unknown>;
  delete doc["schemaVersion"];
  doc["loads"] = [{ id: "T1", pattern: "G", type: "thermal", member: "E1", dT: 20, gradient: 8 }];
  return doc;
};

describe("migrateProject", () => {
  it("v0 -> v1: renombra gradient a gradientZ y fija schemaVersion", () => {
    const r = migrateProject(v0());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(0);
    expect(r.to).toBe(1);
    expect(r.data["schemaVersion"]).toBe(1);
    expect(r.data["loads"]).toEqual([{ id: "T1", pattern: "G", type: "thermal", member: "E1", dT: 20, gradientZ: 8 }]);
  });
  it("acepta schemaVersion 0 explícito y no muta la entrada", () => {
    const doc = { ...v0(), schemaVersion: 0 };
    const copy = structuredClone(doc);
    expect(migrateProject(doc).ok).toBe(true);
    expect(doc).toEqual(copy);
  });
  it("no toca cargas no térmicas, térmicas sin gradient, ni elementos no objeto", () => {
    const doc = v0();
    doc["loads"] = [
      { id: "U", type: "member-uniform", gradient: 3 },
      { id: "T2", type: "thermal", dT: 1 },
      { id: "T3", type: "thermal", dT: 1, gradient: 2, gradientZ: 9 },
      7,
      null,
    ];
    const r = migrateProject(doc);
    expect(r.ok && r.data["loads"]).toEqual([
      { id: "U", type: "member-uniform", gradient: 3 },
      { id: "T2", type: "thermal", dT: 1 },
      { id: "T3", type: "thermal", dT: 1, gradientZ: 9 },
      7,
      null,
    ]);
  });
  it("tolera un v0 sin loads", () => {
    const doc = v0();
    delete doc["loads"];
    expect(migrateProject(doc).ok).toBe(true);
  });
  it("v1 actual: sin cambios", () => {
    const r = migrateProject(example);
    expect(r.ok && r.data).toEqual(example);
    expect(r.ok && r.from).toBe(1);
  });
  it("rechaza no-objetos", () => {
    for (const x of [null, 3, "x", []]) {
      const r = migrateProject(x);
      expect(!r.ok && r.errors[0]?.code).toBe("not-an-object");
    }
  });
  it("rechaza schemaVersion inválido", () => {
    for (const v of ["1", -1, 1.5, null]) {
      const r = migrateProject({ schemaVersion: v });
      expect(!r.ok && r.errors[0]?.code).toBe("schema-version");
    }
  });
  it("rechaza versiones más nuevas que la soportada", () => {
    const r = migrateProject({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });
    expect(!r.ok && r.errors[0]?.code).toBe("schema-version-newer");
  });
  it("informa migración ausente en la cadena", () => {
    const r = migrateProject({ schemaVersion: 0 }, 2, MIGRATIONS);
    expect(!r.ok && r.errors[0]?.code).toBe("migration-missing");
  });
  it("encadena migraciones en orden", () => {
    const chain: Migration[] = [
      { from: 0, description: "a", apply: (d) => ({ ...d, a: 1 }) },
      { from: 1, description: "b", apply: (d) => ({ ...d, b: d["a"] }) },
    ];
    const r = migrateProject({}, 2, chain);
    expect(r.ok && r.data).toEqual({ a: 1, b: 1, schemaVersion: 2 });
  });
});

describe("loadProject", () => {
  it("migra y valida un v0 con carga térmica", () => {
    const doc = v0();
    doc["analysis"] = "3D";
    const r = loadProject(doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.loads[0]).toMatchObject({ gradientZ: 8 });
  });
  it("v0 en 2D-XZ con gradiente Z también valida", () => {
    expect(loadProject(v0()).ok).toBe(true);
  });
  it("propaga errores de migración y de validación", () => {
    expect(loadProject(5).ok).toBe(false);
    const bad = v0();
    bad["members"] = [];
    bad["nodes"] = "no";
    expect(loadProject(bad).ok).toBe(false);
  });
});
