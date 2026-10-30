import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProject } from "./migrate";

const dir = join(__dirname, "..", "examples");
const files = readdirSync(dir).filter((f) => f.endsWith(".edscar.json"));

describe("proyectos de ejemplo", () => {
  it("hay al menos un ejemplo", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} carga y valida`, () => {
      const raw: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const r = loadProject(raw);
      expect(r.ok ? [] : r.errors).toEqual([]);
    });
  }
});
