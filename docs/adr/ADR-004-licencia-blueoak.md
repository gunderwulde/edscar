# ADR-004: BlueOak-1.0.0 permitida solo en desarrollo; cobertura con `@vitest/coverage-v8`

- Estado: Aceptado
- Fecha: 2026-10-30
- Autor: Arquitecto. Aprobado por: propietario (decisión explícita del 2026-10-30).
- Paquetes afectados: raíz del monorepo, CI, `scripts/check-third-party.mjs`, `THIRD_PARTY.md`, CLAUDE.md (regla 2) y sección 13 de la especificación. No cambia ningún contrato entre paquetes.

## Contexto

La sección 7 de la especificación exige una cobertura de tests de al menos el 90 % en `model`, `loads`, `solver` y `codes`. Para medirla con Vitest hace falta un proveedor de cobertura. `@vitest/coverage-v8` tiene licencia MIT, pero trae de forma transitiva (`test-exclude` → `glob` 10) cuatro paquetes con licencia **BlueOak-1.0.0**: `jackspeak`, `minipass`, `package-json-from-dist` y `path-scurry`. `minimatch` 10.x (vía ESLint) ya tenía esa licencia como excepción individual (ADR-002).

BlueOak-1.0.0 es permisiva y está aprobada por OSI. No es copyleft y es compatible con distribuir Edscar bajo MIT. Aun así no figuraba en la regla 2, y aprobarla paquete a paquete no escala: el mismo autor publica con ella buena parte del ecosistema de herramientas de Node.

## Decisión

1. **Licencias permitidas:** MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0 e ISC en cualquier dependencia. **BlueOak-1.0.0 solo en dependencias de desarrollo**, nunca en lo que se distribuye con la aplicación. Sigue prohibido GPL/AGPL/LGPL. Cualquier otra licencia requiere aprobación del propietario (ADR + fila en "Excepciones de licencia" de `THIRD_PARTY.md`).
2. **Definición verificable de "runtime":** el cierre transitivo de `dependencies`, `optionalDependencies` y `peerDependencies` de la raíz, `packages/*` y `apps/*`, resuelto en el árbol de pnpm con la versión exacta. `devDependencies` nunca entran en él. `scripts/check-third-party.mjs` calcula ese cierre y falla si un paquete BlueOak-1.0.0 está dentro, aunque esté permitido en desarrollo.
   - Limitaciones: (a) el cierre se calcula sobre la instalación local, así que los binarios opcionales que dependen de la plataforma pueden variar entre Windows y Linux (CI); (b) los opcionales no instalados se ignoran, pero una dependencia de runtime obligatoria que no se resuelve en disco es error; (c) se distingue por versión: un nombre con varias versiones (p. ej. `minimatch` 9.x ISC y 10.x BlueOak) se evalúa versión a versión.
   - Hoy el cierre de runtime solo contiene `zod` (MIT).
3. **Retirada de la excepción individual de `minimatch`** en `THIRD_PARTY.md`. El script falla si una excepción deja de usarse, y esta queda absorbida por el punto 1.
4. **Nueva dependencia de desarrollo** (solo raíz): `@vitest/coverage-v8` ^3.2.7, licencia MIT (verificada en el `package.json` instalado). Se fija en la misma versión menor que `vitest` instalado (3.2.7), porque su peer exige la versión exacta.
5. **Cobertura:**
   - Script raíz `coverage` = `vitest run --coverage`. Paso de CI "Cobertura" tras "Test".
   - `vitest.config.ts`: proveedor v8. Mide `packages/{model,loads,solver,codes}/src/**/*.ts`, sin los `*.test.ts`.
   - Umbral del **90 % en lines, statements, functions y branches**, **por paquete** (umbral por glob `packages/<p>/src/**`). No hay umbral global, para que un paquete no compense a otro.
   - **Excepción temporal explícita:** `loads`, `solver` y `codes` son stubs de contrato en M0. Figuran en la lista `THRESHOLD_PENDING_M1` de `vitest.config.ts`: se miden e informan, pero no tienen umbral. El propietario de cada paquete lo quita de esa lista en el primer PR de M1 que añada lógica. Desde ese momento rige el 90 % y bajarlo requiere un ADR.

## Consecuencias

- Cobertura medida y exigida en CI desde ahora para `model`.
- Se pueden incorporar herramientas de desarrollo con BlueOak-1.0.0 sin un ADR por paquete. Las nuevas dependencias directas siguen necesitando su fila en `THIRD_PARTY.md` y, si no son infraestructura genérica, ADR (regla 1).
- Si una dependencia de runtime futura (p. ej. en `apps/web` en M2) arrastra un paquete BlueOak-1.0.0, el CI fallará. Habrá que sustituirla o pedir una excepción al propietario.
- `check-third-party` hace un recorrido adicional del árbol de pnpm. El coste es despreciable.

## Alternativas consideradas

- Excepciones individuales para los cuatro paquetes nuevos: no escala (ver contexto). El propietario prefirió la regla general limitada a desarrollo.
- `@vitest/coverage-istanbul`: también arrastra `test-exclude` → `glob` (BlueOak) y además instrumenta el código, lo que es más lento.
- No medir la cobertura: incumple la sección 7.
- Permitir BlueOak-1.0.0 también en runtime: el propietario lo limitó a desarrollo. Mantener el runtime en la lista clásica (MIT/BSD/Apache/ISC) simplifica los avisos de licencia del producto distribuido.
