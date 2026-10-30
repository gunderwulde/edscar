// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEditorStore } from "@edscar/ui-state";
import { App } from "./App";
import type { SolverClient } from "./worker/client";

afterEach(cleanup);

const fakeClient = (ok: boolean): SolverClient => ({
  ping: () => (ok ? Promise.resolve(1) : Promise.reject(new Error("caído"))),
  solve: () => Promise.reject(new Error("no usado")),
  dispose: () => undefined,
});

describe("App", () => {
  it("muestra el título Edscar y el solver no disponible sin cliente", () => {
    render(<App persistDraft={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edscar");
    expect(screen.getByText("Solver: no disponible")).toBeTruthy();
  });

  it("indica solver listo tras el ping", async () => {
    render(<App solver={fakeClient(true)} persistDraft={false} />);
    expect((await screen.findByText("Solver: listo")).getAttribute("role")).toBe("status");
  });

  it("indica solver no disponible si el ping falla", async () => {
    render(<App solver={fakeClient(false)} persistDraft={false} />);
    expect(await screen.findByText("Solver: no disponible")).toBeTruthy();
  });

  it("monta los slots de los paneles solo cuando se pasan", () => {
    const { container, rerender } = render(<App persistDraft={false} />);
    expect(container.querySelector("[data-slot='left']")).toBeNull();
    expect(container.querySelector("[data-slot='canvas']")).not.toBeNull();
    rerender(<App persistDraft={false} slots={{ left: <p>izq</p>, right: <p>der</p>, bottom: <p>abajo</p>, toolbarExtra: <p>tb</p>, headerExtra: <p>hd</p> }} />);
    for (const s of ["left", "right", "bottom", "toolbar", "header"]) expect(container.querySelector(`[data-slot='${s}']`)).not.toBeNull();
    expect(screen.getByText("izq")).toBeTruthy();
  });

  it("la barra de herramientas carga el ejemplo, cambia de herramienta y deshace", () => {
    const store = createEditorStore({ storage: null });
    const { container } = render(<App store={store} />);
    expect(container.querySelectorAll("[data-member]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Ejemplo viga E1/ }));
    expect(store.getState().project.members).toHaveLength(1);
    expect(container.querySelectorAll("[data-member]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Nudo/ }));
    expect(store.getState().tool).toBe("node");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo/ }));
    expect(store.getState().project.members).toHaveLength(0);
  });
});
