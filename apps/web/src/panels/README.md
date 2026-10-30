# panels/ — paneles, tablas y formularios (dueño: agente UX/Paneles)

- Panel de propiedades con edición numérica y unidades (conversión SI ↔ unidades de presentación solo aquí y en canvas, CLAUDE.md regla 7).
- Tabla tipo hoja sincronizada con el lienzo (nudos, barras, apoyos, cargas, patrones, casos).
- Gestión de patrones de carga y casos; asignación de cargas a la selección (añadir/reemplazar/eliminar).
- Barra de herramientas, atajos de teclado, deshacer/rehacer, guardado local (IndexedDB) y archivo `.edscar.json`.
- i18n ES/EN y accesibilidad (roles ARIA, foco, contraste).
- Toda edición se expresa como comando serializable de `@edscar/ui-state`; los paneles no guardan copias del modelo.

## Puntos de montaje (los deja UI/Canvas en `App.tsx`)

`<App slots={{ headerExtra, toolbarExtra, left, right, bottom }} />`. Cada slot es opcional y se renderiza dentro de `<EditorProvider>`, así que los paneles usan `useEditorStore`, `useEditorSelector` y `useSolveController` de `../store`. Regiones con `data-slot="header|toolbar|left|canvas|right|bottom"`.

Pendiente para este agente: abrir/guardar `.edscar.json` (el store ya ofrece `openProjectText`, `exportProjectText`, `markSaved`, `saveDraft/restoreDraft`), crear/editar patrones, casos, cargas, materiales y secciones (comandos `*.add/update/remove` y los constructores `addPatternCommand`, `addLoadCommand`, `addCaseCommand`, `assignPropertiesCommand`... de `@edscar/ui-state`). Tras abrir un proyecto, llamar a `store.setView(fitView(...))` o remontar el lienzo con otro `fitSignal` (App lo hace al pulsar Nuevo).
