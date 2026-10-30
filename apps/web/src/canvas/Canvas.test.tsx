// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createSolver, type SolveResult } from "@edscar/solver";
import { beamE1Project, createEditorStore, type EditorStore } from "@edscar/ui-state";
import { EditorProvider } from "../store";
import { Canvas } from "./Canvas";

afterEach(cleanup);

function mount(store: EditorStore) {
  return render(
    <EditorProvider store={store}>
      <Canvas />
    </EditorProvider>,
  );
}

const e1Store = (): EditorStore => createEditorStore({ project: beamE1Project(), storage: null });

function solved(store: EditorStore, strip = false): SolveResult {
  const full = createSolver().solve({ project: store.getState().project, caseId: "C1" });
  const result: SolveResult = { ...full };
  if (strip) delete result.deflections;
  store.solveFinished("C1", store.getState().revision, result);
  return result;
}

describe("Canvas", () => {
  it("dibuja barras, nudos, apoyos y cargas con etiquetas accesibles", () => {
    const store = e1Store();
    const { container } = mount(store);
    expect(screen.getByRole("application").getAttribute("aria-label")).toMatch(/X-Z/);
    expect(container.querySelectorAll("[data-member]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-node]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-support]")).toHaveLength(2);
    const load = container.querySelector("[data-load='L1']");
    expect(load?.getAttribute("data-pattern")).toBe("G");
    expect(load?.getAttribute("aria-label")).toMatch(/Carga L1/);
    expect(container.querySelector(".ec-grid")).not.toBeNull();
  });

  it("la leyenda oculta y muestra las cargas de un patrón y marca el patrón activo", () => {
    const store = e1Store();
    const { container } = mount(store);
    const box = screen.getByRole("checkbox", { name: /Mostrar patrón/ });
    fireEvent.click(box);
    expect(store.getState().hiddenPatterns).toEqual(["G"]);
    expect(container.querySelector("[data-load='L1']")).toBeNull();
    fireEvent.click(box);
    expect(container.querySelector("[data-load='L1']")).not.toBeNull();
    const legend = screen.getByLabelText("Leyenda de patrones de carga");
    const name = within(legend).getByRole("button");
    fireEvent.click(name);
    expect(store.getState().activePattern).toBe("G");
    expect(name.getAttribute("aria-pressed")).toBe("true");
  });

  it("teclado: Supr borra la selección, Ctrl+Z la recupera y Esc/atajos cambian de herramienta", () => {
    const store = e1Store();
    const { container } = mount(store);
    act(() => {
      store.select({ members: ["E1"] }, "replace");
    });
    expect(screen.getByRole("status").textContent).toMatch(/1 barra/);
    const app = screen.getByRole("application");
    fireEvent.keyDown(app, { key: "Delete" });
    expect(store.getState().project.members).toHaveLength(0);
    expect(container.querySelectorAll("[data-member]")).toHaveLength(0);
    fireEvent.keyDown(app, { key: "z", ctrlKey: true });
    expect(store.getState().project.members).toHaveLength(1);
    fireEvent.keyDown(app, { key: "y", ctrlKey: true });
    expect(store.getState().project.members).toHaveLength(0);
    fireEvent.keyDown(app, { key: "n" });
    expect(store.getState().tool).toBe("node");
    expect(app.getAttribute("data-tool")).toBe("node");
  });

  it("muestra diagramas, deformada y reacciones del resultado, con aviso de deformada aproximada", () => {
    const store = e1Store();
    const { container } = mount(store);
    act(() => {
      solved(store, true);
    });
    expect(container.querySelector("[data-diagram='E1']")).not.toBeNull();
    expect(container.querySelectorAll("[data-reaction]")).toHaveLength(2);
    expect(container.querySelector("[data-deformed='E1']")).not.toBeNull();
    expect(container.querySelector(".ec-results")?.getAttribute("data-stale")).toBe("false");
    expect(container.textContent).toMatch(/Deformada aproximada/);
    expect(container.textContent).toMatch(/30/);
  });

  it("marca los resultados como desactualizados tras editar y los quita al ocultar las opciones", () => {
    const store = e1Store();
    const { container } = mount(store);
    act(() => {
      solved(store);
    });
    act(() => {
      store.dispatch({ type: "load.update", payload: { id: "L1", patch: { w: [0, 0, -20] } } });
    });
    expect(container.querySelector(".ec-results")?.getAttribute("data-stale")).toBe("true");
    expect(container.textContent).toMatch(/desactualizados/);
    act(() => {
      store.setDisplay({ diagram: "none", deformed: false, reactions: false });
    });
    expect(container.querySelector("[data-diagram]")).toBeNull();
    expect(container.querySelector("[data-deformed]")).toBeNull();
    expect(container.querySelector("[data-reaction]")).toBeNull();
  });

  it("un cambio rechazado por la validación se anuncia con role=alert y se puede cerrar", () => {
    const store = e1Store();
    mount(store);
    act(() => {
      store.dispatch({ type: "member.add", payload: { item: { id: "X", i: "A", j: "ZZ", material: "MAT1", section: "SEC1" } } } as never);
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/No se pudo aplicar/);
    fireEvent.click(within(alert).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("muestra el estado del solver: calculando y sin resultados", () => {
    const store = e1Store();
    mount(store);
    act(() => {
      store.solveStarted();
    });
    expect(screen.getByText("Calculando…")).toBeTruthy();
    act(() => {
      store.solveFailed("Worker caído");
    });
    expect(screen.getByText(/Error del solver: Worker caído/)).toBeTruthy();
  });
});
