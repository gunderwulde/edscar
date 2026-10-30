# ADR-002: ESLint como linter del monorepo

- Estado: Aceptado (ESLint, typescript-eslint y excepción de licencia de `minimatch`, ver "Bloqueo de licencia"). Nota 2026-10-30: la excepción individual de `minimatch` queda sustituida por la admisión general de BlueOak-1.0.0 en desarrollo (ADR-004); el resto de este ADR sigue vigente.
- Fecha: 2026-10-30
- Autor: Arquitecto. Aprobado por: propietario (ESLint, tras M0).
- Paquetes afectados: raíz del monorepo (solo herramientas de desarrollo). No cambia ningún contrato entre paquetes.

## Contexto

El script `lint` de M0 era provisional (`typecheck` + `check-third-party`). Con TypeScript estricto hace falta un linter que detecte lo que `tsc` no ve: `any` inseguros, promesas sin esperar, condiciones siempre verdaderas, etc. CLAUDE.md, regla 1: toda dependencia fuera de la lista de infraestructura genérica necesita ADR.

## Decisión

1. Dependencias de desarrollo (solo raíz, `devDependencies`):
   - `eslint` ^10.13.0, licencia MIT.
   - `typescript-eslint` ^8.72.1, licencia MIT. Hace falta para que ESLint entienda TypeScript (parser) y para las reglas con información de tipos. Es un paquete único que agrupa parser y plugin; no se añade nada más.
   - Licencias comprobadas en el `package.json` instalado de cada uno.
2. Configuración: `eslint.config.mjs` (flat config) en la raíz.
   - Ámbito: `packages/*/src/**/*.ts` y `apps/*/src/**/*.ts`.
   - Preset único: `tseslint.configs.strictTypeChecked`, con `parserOptions.projectService` (usa el `tsconfig.json` de cada paquete).
   - `reportUnusedDisableDirectives: "error"`.
   - Sin `@eslint/js`, sin Prettier ni plugins de estilo, de import o de React. Si M2 necesita reglas de React, irá en otro ADR.
3. Script raíz `lint` = `eslint --max-warnings=0 .`. CI ejecuta `pnpm lint` entre `typecheck` y `test`. `typecheck` y `check-third-party` siguen siendo pasos separados.
4. `engines.node` de la raíz pasa a `^20.19.0 || ^22.13.0 || >=24`, que es lo que exige ESLint 10. CI usa Node 22.

## Bloqueo de licencia (resuelto: el propietario aprobó la opción A el 2026-10-30)

ESLint 10 (vía `@eslint/config-array`) y typescript-eslint >= 8.56.1 (vía `@typescript-eslint/typescript-estree`) dependen de `minimatch` ^10.2.x. Desde la 10.1.0, `minimatch` usa la licencia **BlueOak-1.0.0**. Es permisiva y aprobada por OSI, no es copyleft, y es compatible con distribuir Edscar bajo MIT. Pero no está en la lista de la regla 2 de CLAUDE.md, así que `check-third-party` falla.

Opciones estudiadas:
- **A (recomendada).** Aprobar `minimatch` con BlueOak-1.0.0 como excepción transitiva **solo de desarrollo**: el propietario añade una fila en la tabla "Excepciones de licencia" de `THIRD_PARTY.md`. El script ya lo soporta: exige nombre y licencia exactos y falla si una excepción deja de usarse. Es probable que BlueOak-1.0.0 vuelva a aparecer en otras herramientas (`glob`, `lru-cache`, `path-scurry` usan la misma licencia).
- B. Bajar a ESLint 9.39.x con typescript-eslint 8.56.0 (`minimatch` 3.x/9.x, ISC). Descartada: ESLint 9 arrastra `argparse` 2.0.1 (vía `js-yaml`), con licencia **Python-2.0**, que tampoco está en la lista. Además fija una versión antigua de typescript-eslint.
- C. Forzar `minimatch` 10.0.3 (ISC) con `pnpm.overrides`. Descartada: incumple el rango `^10.2.x` que piden los dependientes y deja fuera correcciones recientes.

**Decisión:** el propietario aprobó la opción A. `minimatch` (BlueOak-1.0.0) figura en la tabla "Excepciones de licencia" de `THIRD_PARTY.md`, solo como dependencia de desarrollo, y `check-third-party` pasa. Otras licencias fuera de la lista (p. ej. si aparecen `glob` o `lru-cache`) requieren su propia aprobación.

> Nota (2026-10-30, ADR-004): la fila de `minimatch` se retiró de "Excepciones de licencia" porque BlueOak-1.0.0 pasa a estar permitida de forma general para dependencias de desarrollo. `minimatch` 10.x sigue siendo solo de desarrollo y `check-third-party` falla si entrase en el cierre de runtime.

## Consecuencias

- Lint real con información de tipos. Hoy los 16 ficheros TS del workspace pasan sin errores.
- El lint con información de tipos es más lento que sin ella. Con el tamaño actual es despreciable.
- Todo código nuevo en `packages/*/src` y `apps/*/src` debe pasar `strictTypeChecked`. Si se desactiva una regla en una línea, hay que justificarlo en un comentario.

## Alternativas consideradas

- Solo `tsc` (sin linter): no detecta `any` inseguros ni promesas sin esperar.
- Biome: es MIT, pero no tiene reglas con información de tipos comparables, y el propietario ya aprobó ESLint.
- `tseslint.configs.recommended` sin tipos: es más rápido, pero pierde las reglas más valiosas para un solver numérico (`no-unnecessary-condition`, `restrict-plus-operands`, `no-floating-promises`).
