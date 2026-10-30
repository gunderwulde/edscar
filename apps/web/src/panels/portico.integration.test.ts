// Integración sin navegador: ejemplo del pórtico -> store -> Worker (MessageChannel) -> solver real. Comprueba el
// equilibrio global de reacciones y el arranque (por defecto y con ?example=).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorStore, visibleResult } from "@edscar/ui-state";
import { createSolveController } from "../store/solveController";
import { createSolverClient } from "../worker/client";
import { attachSolverWorker } from "../worker/handler";
import { exampleUrl, findExample, loadExample, parseExampleParam, EXAMPLES, DEFAULT_EXAMPLE_ID } from "./startup";
import { projectWithCombination, summarizeResult } from "./results";

const publicFile = (rel: string): string => fileURLToPath(new URL(`../../public/${rel}`, import.meta.url));
const readExample = (id: string): string => readFileSync(publicFile(findExample(id)?.file ?? ""), "utf8");

/** fetch de pega que sirve public/ desde disco y registra las URL pedidas. */
function fakeFetch(urls: string[]): typeof fetch {
  return (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const rel = url.replace(/^.*?(examples\/)/, "$1");
    try {
      return Promise.resolve(new Response(readFileSync(publicFile(rel), "utf8"), { status: 200 }));
    } catch {
      return Promise.resolve(new Response("no", { status: 404 }));
    }
  };
}

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const ch of channels.splice(0)) {
    ch.port1.close();
    ch.port2.close();
  }
});
function workerClient() {
  const ch = new MessageChannel();
  channels.push(ch);
  attachSolverWorker(ch.port1);
  return createSolverClient(ch.port2);
}

describe("ejemplo del pórtico de 2 plantas", () => {
  it("el JSON tiene 3 patrones, 3 casos y 3 combinaciones y se abre sin errores", () => {
    const store = createEditorStore({ storage: null });
    const r = store.openProjectText(readExample("portico-2-plantas"), "p.edscar.json");
    expect(r.ok).toBe(true);
    const p = store.getState().project;
    expect([p.patterns.length, p.cases.length, p.combinations.length]).toEqual([3, 3, 3]);
    expect(p.members).toHaveLength(10);
    expect(store.getState().results.caseId).toBe("CG");
  });

  it("resuelve CG/CQ/CW y cumple el equilibrio global de reacciones", async () => {
    const store = createEditorStore({ storage: null });
    store.openProjectText(readExample("portico-2-plantas"));
    const client = workerClient();
    const project = store.getState().project;

    const sums: Record<string, { rx: number; rz: number }> = {};
    for (const caseId of ["CG", "CQ", "CW"]) {
      const result = await client.solve({ project, caseId });
      expect(result.status).toBe("ok");
      const s = summarizeResult(result);
      sums[caseId] = { rx: s.sumRx, rz: s.sumRz };
    }
    // Viento: 14 + 14 kN/m·m en pilares P1 y P4 + 10 + 15 kN nodales = 53 kN hacia +X; reacciones opuestas.
    expect(sums["CW"]?.rx).toBeCloseTo(-53.0, 1);
    expect(Math.abs(sums["CW"]?.rz ?? 1)).toBeLessThan(0.05);
    // Permanente: vigas 2·18·6 + 2·12·6 = 360 kN + peso propio ≈ 39,7 kN = 399,7 kN (tolerancia 0,5 kN).
    expect(Math.abs((sums["CG"]?.rz ?? 0) - 399.7)).toBeLessThan(0.5);
    // Sobrecarga: 10·6 + 10·3 + 40 + (2+8)/2·6 = 60 + 30 + 40 + 30 = 160 kN.
    expect(sums["CQ"]?.rz).toBeCloseTo(160, 1);
  });

  it("una combinación aplanada a caso virtual equivale a la superposición de sus casos", async () => {
    const store = createEditorStore({ storage: null });
    store.openProjectText(readExample("portico-2-plantas"));
    const client = workerClient();
    const project = store.getState().project;
    const built = projectWithCombination(project, "U1");
    if ("error" in built) throw new Error(built.error);
    const combo = summarizeResult(await client.solve({ project: built.project, caseId: built.caseId }));
    const g = summarizeResult(await client.solve({ project, caseId: "CG" }));
    const q = summarizeResult(await client.solve({ project, caseId: "CQ" }));
    expect(combo.sumRz).toBeCloseTo(1.35 * g.sumRz + 1.5 * q.sumRz, 6);
    expect(Math.abs(combo.M?.value ?? 0)).toBeGreaterThan(0);
  });

  it("al cargar el ejemplo el controlador resuelve solo y muestra el caso CG", async () => {
    const store = createEditorStore({ storage: null });
    const controller = createSolveController(store, workerClient(), { debounceMs: 0 });
    controller.start();
    const urls: string[] = [];
    const r = await loadExample(store, DEFAULT_EXAMPLE_ID, { fetchFn: fakeFetch(urls), baseUrl: "/" });
    expect(r.ok).toBe(true);
    await vi.waitFor(() => {
      expect(visibleResult(store.getState())?.stale).toBe(false);
    }, { timeout: 5000 });
    const shown = visibleResult(store.getState());
    expect(shown?.result.status).toBe("ok");
    expect(store.getState().results.caseId).toBe("CG");
    controller.dispose();
  });
});

describe("arranque y ejemplos", () => {
  it("parseExampleParam lee ?example= y exampleUrl respeta la base de Vite", () => {
    expect(parseExampleParam("?example=portico-2-plantas")).toBe("portico-2-plantas");
    expect(parseExampleParam("?x=1")).toBeNull();
    expect(parseExampleParam("?example=")).toBeNull();
    const info = findExample("portico-2-plantas");
    if (!info) throw new Error("falta el ejemplo");
    expect(exampleUrl(info, "/")).toBe("/examples/portico-2-plantas.edscar.json");
    expect(exampleUrl(info, "/edscar")).toBe("/edscar/examples/portico-2-plantas.edscar.json");
    expect(exampleUrl(info, "./")).toBe("./examples/portico-2-plantas.edscar.json");
  });

  it("todos los ejemplos publicados cargan y la petición usa la base", async () => {
    for (const e of EXAMPLES) {
      const store = createEditorStore({ storage: null });
      const urls: string[] = [];
      const r = await loadExample(store, e.id, { fetchFn: fakeFetch(urls), baseUrl: "/app/" });
      expect(r.ok).toBe(true);
      expect(urls[0]).toBe(`/app/${e.file}`);
      expect(store.getState().project.members.length).toBeGreaterThan(0);
      expect(store.getState().file.name).toBe(`${e.id}.edscar.json`);
    }
  });

  it("un ejemplo desconocido o un fallo de red se informan sin lanzar; la viga cae a la versión incorporada", async () => {
    const store = createEditorStore({ storage: null });
    expect((await loadExample(store, "no-existe", { fetchFn: fakeFetch([]) })).ok).toBe(false);
    const down = (() => Promise.reject(new Error("sin red"))) as unknown as typeof fetch;
    const bad = await loadExample(store, "portico-2-plantas", { fetchFn: down });
    expect(bad).toEqual({ ok: false, message: "sin red" });
    expect((await loadExample(store, "viga-biapoyada", { fetchFn: down })).ok).toBe(true);
    expect(store.getState().project.members).toHaveLength(1);
  });
});
