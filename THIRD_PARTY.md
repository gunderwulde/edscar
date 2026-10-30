# Dependencias de terceros

Edscar se publica bajo licencia MIT (ver `LICENSE`). Todo el código del repositorio está escrito desde cero (CLAUDE.md, regla 1); aquí solo se listan dependencias de infraestructura genérica, de **desarrollo** salvo las marcadas como runtime (`zod` en `packages/model`; `react` y `react-dom` en `apps/web` desde M2, ADR-006).

Licencias permitidas: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC. Además, **BlueOak-1.0.0 solo en dependencias de desarrollo** (ADR-004): nunca en el cierre de runtime (`dependencies`/`optionalDependencies`/`peerDependencies` de la raíz, `packages/*` y `apps/*`, seguidas de forma transitiva). Prohibido GPL/AGPL/LGPL. Cualquier otra licencia requiere aprobación del propietario (ADR + fila en "Excepciones de licencia").
`scripts/check-third-party.mjs` (ejecutado en CI) falla si una dependencia directa no está en la tabla siguiente, si algún paquete instalado tiene una licencia no permitida y no figura en "Excepciones de licencia", si un paquete BlueOak-1.0.0 aparece en el cierre de runtime, o si una excepción listada ya no se usa.

## Dependencias directas

| Paquete | Versión (rango) | Licencia | Uso | ADR |
|---|---|---|---|---|
| `typescript` | ^5.9.3 | Apache-2.0 | Compilador / comprobación de tipos (dev) | M0 |
| `vitest` | ^3.2.4 | MIT | Ejecutor de tests (dev) | M0 |
| `eslint` | ^10.13.0 | MIT | Linter (dev) | ADR-002 |
| `typescript-eslint` | ^8.72.1 | MIT | Parser y reglas TypeScript para ESLint (dev) | ADR-002 |
| `@vitest/coverage-v8` | ^3.2.7 | MIT | Cobertura de tests con V8 para Vitest (dev) | ADR-004 |
| `zod` | ^4.6.7 | MIT | Esquemas y validación de `@edscar/model` (runtime, solo en packages/model) | M0/model |
| `react` | ^19.3.1 | MIT | Biblioteca de UI de `apps/web` (runtime) | ADR-006 |
| `react-dom` | ^19.3.1 | MIT | Renderizado DOM de React en `apps/web` (runtime; trae `scheduler`, MIT) | ADR-006 |
| `vite` | ^7.3.7 | MIT | Servidor de desarrollo y empaquetado de `apps/web` (dev; misma línea 7.x que ya traía Vitest) | ADR-006 |
| `@types/react` | ^19.3.0 | MIT | Tipos de React (dev) | ADR-006 |
| `@types/react-dom` | ^19.3.0 | MIT | Tipos de React DOM (dev) | ADR-006 |
| `@testing-library/react` | ^16.3.3 | MIT | Tests de componentes de `apps/web` (dev) | ADR-006 |
| `@testing-library/dom` | ^10.4.2 | MIT | Dependencia par de `@testing-library/react` (dev) | ADR-006 |
| `happy-dom` | ^21.0.4 | MIT | Entorno DOM para los tests de UI en Vitest (dev) | ADR-006 |

## Excepciones de licencia

Paquetes transitivos con licencia fuera de la lista permitida, aceptados uno a uno por el propietario mediante ADR. Solo se admiten licencias permisivas no copyleft.

Actualmente no hay ninguna. La antigua excepción individual de `minimatch` (BlueOak-1.0.0, ADR-002) se retiró al admitir BlueOak-1.0.0 de forma general para desarrollo (ADR-004).

| Paquete | Licencia | Traído por | ADR / aprobación |
|---|---|---|---|

## Dependencias transitivas (informativo)

Verificadas automáticamente por licencia en cada ejecución del script (instalación en Windows x64; en otras plataformas varían los binarios opcionales de `@esbuild/*` y `@rollup/*`, todos MIT).
Resumen de licencias observadas (MIT la mayoría):
- Apache-2.0: `typescript`, `expect-type`, `@eslint/*` (config-array, object-schema, config-helpers, core, plugin-kit), `eslint-visitor-keys`, `@humanfs/*`, `@humanwhocodes/*`.
- Apache-2.0 (cont.): `@ampproject/remapping`.
- ISC: `picocolors`, `siginfo`, `semver`, `which`, `isexe`, `glob-parent`, `flatted`, `glob`, `lru-cache`, `minimatch` 9.x, `test-exclude`, `foreground-child`, `signal-exit`, `@isaacs/cliui`.
- BSD-2-Clause: `espree`, `eslint-scope`, `esrecurse`, `estraverse`, `esutils`, `uri-js`.
- BSD-3-Clause: `source-map-js`, `esquery`, `istanbul-lib-coverage`, `istanbul-lib-report`, `istanbul-lib-source-maps`, `istanbul-reports`.
- BlueOak-1.0.0 (solo desarrollo, ADR-004): `minimatch` 10.x (vía eslint, typescript-eslint), `jackspeak`, `minipass`, `package-json-from-dist`, `path-scurry` (vía `@vitest/coverage-v8` → `test-exclude` → `glob`).
- Apache-2.0 (M2): `aria-query` (vía `@testing-library/dom`).
- BSD-2-Clause (M2): `entities` (vía `happy-dom`).
- MIT (M2): `scheduler`, `@babel/runtime`, `@babel/code-frame`, `@babel/parser`, `@babel/types` y auxiliares, `lz-string`, `pretty-format` 27, `react-is` 17, `dom-accessibility-api`, `csstype`, `ws`, `whatwg-mimetype`, `buffer-image-size`, `@types/node`, `@types/ws`, `@types/aria-query`, `@types/whatwg-mimetype`, `undici-types`.
- No instalado (ADR-006): `eslint-plugin-react-hooks` 6.x/7.x trae `caniuse-lite` (CC-BY-4.0, vía `@babel/core` → `browserslist`), licencia fuera de la lista; queda pendiente de que el propietario decida si aprueba esa excepción.
- Cierre de runtime actual: `zod`, `react`, `react-dom`, `scheduler` (todos MIT).

## Acciones de CI

El workflow usa únicamente acciones oficiales de GitHub (`actions/checkout`, `actions/setup-node`). No se vendoriza ni copia código de terceros.
