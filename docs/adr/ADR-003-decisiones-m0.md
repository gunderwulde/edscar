# ADR-003: Decisiones de cierre de M0 (pnpm, calendario de Vite/React, scripts de build)

- Estado: Aceptado
- Fecha: 2026-10-30
- Autor: Arquitecto. Aprobado por: propietario (tras M0).
- Paquetes afectados: raíz del monorepo y CI. `apps/web` en M2.

## Contexto

Al cerrar M0 quedaron tres decisiones de infraestructura pendientes de registrar.

## Decisión

1. **pnpm 12.16.1 fijado.** Se declara en `packageManager` de `package.json` y CI lo instala con esa versión exacta. Cambiar de versión necesita un ADR nuevo, o una enmienda de este, y regenerar `pnpm-lock.yaml`.
2. **Vite y React se aplazan a M2.** En M0 y M1 no se añaden como dependencias directas. `apps/web` sigue siendo un esqueleto TypeScript sin UI. Cuando se añadan en M2 se registrarán en `THIRD_PARTY.md`, junto con la licencia de sus transitivas. Hoy Vite ya está instalado como transitiva de Vitest; eso no cuenta como dependencia directa.
3. **Scripts de build de `esbuild` desactivados.** En `pnpm-workspace.yaml` se pone `allowBuilds: { esbuild: false }`. pnpm bloquea por defecto los scripts de instalación de terceros, y esta línea deja la decisión explícita y quita el aviso. El script `postinstall` de esbuild solo valida u optimiza el binario. El binario nativo llega como dependencia opcional `@esbuild/<plataforma>`, así que Vitest funciona sin ejecutar el script (comprobado en M0 en Windows x64). Ningún paquete de terceros puede ejecutar scripts de instalación salvo que un ADR lo permita. Esto se revisará en M2 al añadir Vite.

## Consecuencias

- Instalaciones reproducibles (`pnpm install --frozen-lockfile` en CI) y menos superficie de ataque, porque no se ejecuta código de terceros al instalar.
- Si una versión futura de esbuild necesita su `postinstall` en alguna plataforma, CI fallará de forma visible y habrá que decidir con un ADR.

## Alternativas consideradas

- Permitir todos los scripts de build: descartado por seguridad y porque no hace falta.
- Introducir Vite y React ya en M0: descartado. Añade dependencias y superficie antes de que exista la UI.
