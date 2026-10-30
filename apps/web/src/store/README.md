# store/ — enlace React ↔ `@edscar/ui-state` (compartido por UI/Canvas y UX/Paneles)

- La lógica de estado (proyecto, comandos serializables, deshacer/rehacer, selección) vive en `@edscar/ui-state`, sin dependencia de React.
- Aquí solo va el enlace con React: un hook basado en `useSyncExternalStore` de React y selectores. Sin Zustand ni otras librerías de estado (ADR-006).
- Ningún componente modifica el `Project` directamente: despacha comandos.
- Cambios en el contrato de `@edscar/ui-state` pasan por el Arquitecto.

## Estado actual (M2)

- `EditorProvider({ store, solver?, autoSolve?, debounceMs? })`: provee el store y, si hay cliente del Worker, un controlador de cálculo.
- `useEditorStore()`: el store (`dispatch`, `undo`, `redo`, `select`, `setTool`, `setDisplay`, ...). `useEditorSelector(sel)`: suscripción a una parte del estado; el selector debe devolver una referencia estable (`s.project`, `s.selection`...). `useEditorState()`: todo el estado.
- `useSolveController()`: `solveNow()`, `schedule()`, `cancel()`, `setAuto(bool)`; `null` sin cliente. El cálculo se hace siempre en el Worker; con `auto` se recalcula con debounce (250 ms) al cambiar el modelo o el caso mostrado. La cancelación descarta las respuestas de peticiones superadas.
- Estado del solver en `state.solver` = `{ phase: idle|solving|done|failed, ok, status, message }`; resultado en `state.results` (usar `visibleResult(state)`, que indica si está obsoleto).
- Tests: `solveController.test.ts` (debounce, cancelación, fallos) y `e1.integration.test.ts` (E1 por comandos + Worker: reacciones 30/30 kN, M(3) = 45 kN·m).
