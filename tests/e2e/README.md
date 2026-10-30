# Pruebas e2e de M2 (plan)

Responsable: agente QA/Verificación. Herramienta prevista: **Playwright**. Todavía **no está instalado**: al instalarlo hay que verificar su licencia (Apache-2.0 esperada) y la de sus transitivas, registrarlo en `THIRD_PARTY.md` y añadir el paso a CI (ADR-006 §7).

## Principios
- Cada prueba arranca la app compilada (`pnpm --filter @edscar/web build` + `vite preview`) con estado limpio: IndexedDB vacía y sin proyecto cargado.
- Los elementos se localizan por rol y nombre accesible (`getByRole`), no por clases CSS. Así las pruebas sirven también como control de accesibilidad.
- Los valores numéricos se comprueban contra soluciones analíticas con tolerancia explícita, en unidades SI mostradas en la UI.
- Sin dependencias de red: todo ocurre en el cliente (sección 7 de la especificación).
- Se ejecutan en Chromium al menos. Firefox y WebKit se añaden si el coste en CI es razonable.

## Flujos

| # | Flujo | Comprobaciones clave |
|---|---|---|
| E1 | **Arranque** | Título "Edscar" visible; estado del Worker "Solver: listo"; sin errores en consola. |
| E2 | **Dibujar viga** | Crear 2 nudos (0,0) y (6,0) por clic con rejilla y por tabla; crear una barra; asignar material y sección. La tabla y el lienzo muestran lo mismo. |
| E3 | **Apoyos** | Articulado fijo en A y móvil en B desde el panel de propiedades; los símbolos aparecen en el lienzo. |
| E4 | **Tres patrones** | Crear G (D), Q (L) y S (S). Asignar a la barra seleccionada: uniforme −10 kN/m (G), puntual −20 kN en L/2 (Q), uniforme −2 kN/m (S). Las flechas usan el color del patrón; mostrar/ocultar por patrón funciona. |
| E5 | **Resolver** | Crear un caso por patrón y resolver (Worker). Reacciones de G = 30/30 kN; momento máximo de G = wL²/8 = 45 kN·m; deformada visible (cuando el solver exponga `deflections`, ADR-006 §3). La UI no se bloquea durante el cálculo. |
| E6 | **Deshacer/rehacer** | Deshacer la última carga, rehacerla, deshacer hasta el modelo vacío y rehacer todo; el estado final coincide con el de antes. |
| E7 | **Guardado local** | Recargar la página y recuperar el proyecto desde IndexedDB. |
| E8 | **JSON** | Exportar `.edscar.json`, comprobar que valida con `@edscar/model`, importarlo en una sesión limpia y obtener el mismo resultado de E5. |
| E9 | **Validación en vivo** | Quitar un apoyo: aviso de mecanismo (`singular`) sin resultados. Carga sin patrón o nudo suelto: aviso en el panel. |
| E10 | **Aceptación M2** | Recorrido E2→E5 guiado como "usuario nuevo", cronometrado: menos de 5 min incluyendo esperas (criterio de la sección 9). |

## Pendiente antes de implementar
- Que existan el lienzo (`apps/web/src/canvas/`), los paneles (`apps/web/src/panels/`) y los comandos de `@edscar/ui-state`.
- Nombres accesibles estables, que acordarán UX/Paneles y QA.
- `SolveResult.deflections` expuesto por el solver para la parte de deformada de E5.
