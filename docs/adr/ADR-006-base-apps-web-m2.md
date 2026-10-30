# ADR-006: Base técnica de `apps/web` para M2 (editor 2D)

- Estado: Aceptado
- Fecha: 2026-10-30
- Autor: Arquitecto. Aprobado por: propietario (aprobó Vite y React para M2 y delegó en el Arquitecto las decisiones técnicas de este ADR).
- Paquetes afectados: `apps/web` (UI/Canvas, UX/Paneles), `@edscar/solver` (contrato, solo tipos opcionales), raíz (ESLint, Vitest, CI, `THIRD_PARTY.md`).

## Contexto

M2 construye el editor visual 2D. ADR-003 aplazó Vite y React a M2. Hay que fijar la base de la app, qué dependencias entran (todas con licencia verificada, CLAUDE.md reglas 1 y 2), cómo se ejecuta el solver sin bloquear la UI (sección 7 de la especificación) y qué le falta al contrato de `SolveResult` para dibujar la deformada.

## Decisión

### 1. Stack de `apps/web`
- **Vite 7 + React 19 + TypeScript estricto** (`tsconfig.base.json` + `jsx: "react-jsx"`).
  - Vite `^7.3.7`: es la misma línea que ya trae Vitest 3.2 como transitiva, así que no se duplica el empaquetador. Pasar a Vite 8 (rolldown) requiere actualizar Vitest y es una decisión aparte.
- **Sin `@vitejs/plugin-react`.** El JSX lo transforma el esbuild que ya trae Vite (`esbuild.jsx: "automatic"`). A cambio no hay Fast Refresh: el HMR recarga la página. Se puede revisar si la productividad lo pide; el plugin es MIT, pero añade su propio árbol de dependencias.
- `allowBuilds: { esbuild: false }` (ADR-003) se mantiene. `vite build` y `vite` (dev) funcionan sin el `postinstall` de esbuild (comprobado en Windows x64). Queda cerrado el punto que ADR-003 dejaba "a revisar en M2".

### 2. Estado: sin Zustand
- La lógica de estado (proyecto, comandos serializables, deshacer/rehacer, selección) vive en `@edscar/ui-state`, sin dependencia de React.
- `apps/web/src/store/` solo la enlaza con React mediante `useSyncExternalStore`, que forma parte de React. Son unas decenas de líneas propias, sin dependencia nueva.
- Zustand (MIT) se descarta: no aporta nada que justifique una dependencia y acoplaría `ui-state` a una API de terceros.

### 3. Contrato del solver (`packages/solver/src/index.ts`, solo añadidos opcionales)
- `SolveResult.deflections?: Record<Id, DeflectionStation[]>`, con clave = id de barra y `DeflectionStation = { x: number; d: readonly [ux, uy, uz] }`.
  - `x`: m desde el nudo i (geometría sin deformar), estrictamente creciente, incluye 0 y L.
  - `d`: desplazamiento del punto de la directriz en **ejes globales**, en m. En "2D-XZ", `uy = 0`.
  - En los extremos coincide con el desplazamiento del extremo de la barra, que puede diferir del del nudo si hay liberaciones de traslación.
  - Ausente si `status !== "ok"` o si el solver no la calcula.
- `SolveStatus` gana `"unsupported"`: modelo válido pero análisis no implementado (hoy `analysis: "3D"`). Mientras el solver no lo emita, la UI trata `"invalid-model"` y `"unsupported"` como "sin resultados" y muestra `message`.
- **Seguimiento (agente Solver, con revisión del Revisor de ingeniería):**
  1. Rellenar `deflections` transformando a globales la deformada local que ya calcula (`Internal2DResult.deflections`). Tests: valor en extremos = desplazamientos de extremo; flecha central de la viga biapoyada = 5wL⁴/384EI.
  2. Devolver `"unsupported"` para 3D y actualizar el test correspondiente de `solve2d.test.ts`.
  - No se ha tocado la implementación del solver en este ADR.

### 4. Lienzo 2D
- Se dibuja con **SVG propio** (Canvas 2D propio si el rendimiento lo exige con muchas barras), sin librerías de dibujo, gráficos ni diagramas de terceros.
- Three.js y react-three-fiber quedan reservados para la vista 3D de M4 y **no se instalan ahora**.

### 5. Solver en Web Worker propio
- `apps/web/src/worker/`:
  - `protocol.ts`: tipos de mensajes, `SOLVER_PROTOCOL_VERSION = 1`.
  - `handler.ts`: lado Worker, usa `createSolver()`.
  - `solver.worker.ts`: punto de entrada, empaquetado por Vite como módulo ES.
  - `client.ts`: API con promesas `ping`/`solve`/`dispose`.
- Solo viajan datos clonables. Los errores del modelo llegan en `result.status`; la promesa solo se rechaza por fallos del canal o excepciones inesperadas.
- Probado con un `MessageChannel` real (ida y vuelta con structured clone) en `worker.test.ts`.

### 6. Lint de React
- Se mantiene `typescript-eslint` `strictTypeChecked`, ampliado a `*.tsx`.
- **No se instala `eslint-plugin-react-hooks`.** Sus versiones 6.x y 7.x (las únicas que declaran soporte reciente) dependen de `@babel/core`, que arrastra `caniuse-lite` con licencia **CC-BY-4.0**. Esa licencia no está en la lista permitida, y `check-third-party` falló al probarlo. La 5.2.0 no tiene dependencias, pero no declara compatibilidad con ESLint 10.
- Hasta que el propietario decida, las reglas de hooks se respetan por revisión.
  - Opción A: el propietario aprueba una excepción CC-BY-4.0 solo de desarrollo para `caniuse-lite` (es un fichero de datos, no código, y no es copyleft), con otro ADR y una fila en "Excepciones de licencia".
  - Opción B: seguir sin el plugin.

### 7. Tests de UI
- Vitest con `@testing-library/react` + `@testing-library/dom` (MIT).
- Entorno **happy-dom** (MIT), elegido frente a jsdom porque tiene menos dependencias transitivas. Se activa por fichero con `// @vitest-environment happy-dom`; el resto sigue en `node`.
- Playwright (e2e) queda para más adelante en M2. El plan está en `tests/e2e/README.md`.
- `apps/web` no entra en el umbral de cobertura del 90 % (ADR-004 lo limita a model/loads/solver/codes).

### 8. CI
- Nuevo paso `pnpm build`, que incluye `tsc` y `vite build` de `apps/web`.

## Dependencias nuevas (licencia verificada en el `package.json` instalado y registradas en `THIRD_PARTY.md`)

| Paquete | Tipo | Licencia |
|---|---|---|
| `react`, `react-dom` (+ `scheduler`) | runtime | MIT |
| `vite` | dev | MIT |
| `@types/react`, `@types/react-dom` | dev | MIT |
| `@testing-library/react`, `@testing-library/dom` | dev | MIT |
| `happy-dom` | dev | MIT |

Transitivas nuevas fuera de MIT: `aria-query` (Apache-2.0) y `entities` (BSD-2-Clause), ambas permitidas. El cierre de runtime queda en `zod`, `react`, `react-dom` y `scheduler`, todos MIT.

## Consecuencias

- `apps/web` arranca (`pnpm --filter @edscar/web dev`) y compila (`build`) con una pantalla mínima: título "Edscar" y estado del Worker.
- UI/Canvas y UX/Paneles tienen carpetas y responsabilidades definidas (`canvas/`, `panels/`, `store/`, `worker/`, cada una con su README).
- El contrato del solver crece solo con campos opcionales y un estado nuevo. Ningún consumidor existente se rompe: typecheck y tests en verde.
- Sin Fast Refresh ni lint de hooks: es una pérdida asumida de comodidad para mantener mínimo el árbol de dependencias.
- `vite build` muestra avisos de Rollup sobre comentarios `@__PURE__` en `zod`. Son inocuos y no afectan al resultado.

## Alternativas consideradas

- **Zustand o Redux Toolkit:** innecesarios (ver §2).
- **`@vitejs/plugin-react`:** aplazado (ver §1).
- **jsdom:** más dependencias que happy-dom sin ventaja para tests de componentes simples.
- **Librerías de dibujo 2D (Konva, Pixi, etc.):** descartadas por la regla 1 y porque SVG cubre el alcance 2D.
- **Ejecutar el solver en el hilo principal:** incumple la sección 7 de la especificación.
- **Vite 8:** obliga a actualizar Vitest; se pospone.
