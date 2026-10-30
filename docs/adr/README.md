# Registro de decisiones de arquitectura (ADR)

Cada decisión que afecta a más de un paquete, al contrato entre paquetes, a convenciones físicas o a dependencias de terceros se registra aquí. Un ADR aceptado no se edita salvo para corregir erratas o añadir anexos que documenten la implementación sin cambiar decisiones ni contratos (se registran como nueva revisión en su cabecera); cualquier otro cambio se hace con un ADR nuevo que marque el anterior como "Sustituido por".

Los ADR que añaden dependencias (CLAUDE.md, regla 1) requieren aprobación explícita del propietario.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [ADR-001](ADR-001-ejes-signos-unidades.md) | Ejes, signos y unidades | Aceptado (2026-10-30; aprobado por el propietario, revisado por el Revisor de ingeniería) |
| [ADR-002](ADR-002-eslint.md) | ESLint como linter del monorepo | Aceptado (la excepción individual de `minimatch` queda absorbida por ADR-004) |
| [ADR-003](ADR-003-decisiones-m0.md) | Decisiones de cierre de M0: pnpm 12.16.1, Vite/React en M2, `allowBuilds` de esbuild | Aceptado |
| [ADR-004](ADR-004-licencia-blueoak.md) | BlueOak-1.0.0 permitida solo en desarrollo; `@vitest/coverage-v8` y umbral de cobertura | Aceptado (2026-10-30; aprobado por el propietario) |
| [ADR-005](ADR-005-gdl-sin-rigidez-mecanismos.md) | Liberaciones (condensación), GDL de giro sin rigidez y detección de mecanismos | Aceptado (2026-10-30; revisión 3; decisiones delegadas por el propietario; revisado por el Revisor de ingeniería). Implementación 2D aprobada por el Revisor (M1). Revisión 4: Anexo A (deformada de barras con mecanismo interno sin carga, `recoverAttached`, aviso en `message`) y Anexo B (cargas distribuidas diminutas y recorte de trapecios). Alcance aprobado: 2D; la parte 3D queda para un ADR de M4. Añade `SolveResult.indeterminateDofs?` |
| [ADR-006](ADR-006-base-apps-web-m2.md) | Base de `apps/web` en M2: Vite 7 + React 19, estado propio sobre `@edscar/ui-state` (sin Zustand), lienzo SVG propio, solver en Web Worker, tests con Testing Library + happy-dom; contrato: `SolveResult.deflections?` y estado `unsupported` | Aceptado (2026-10-30; decisiones delegadas por el propietario). Pendiente del propietario: excepción CC-BY-4.0 para `eslint-plugin-react-hooks` (§6) |

## Plantilla

Copiar a `ADR-NNN-titulo-corto.md`:

~~~md
# ADR-NNN: Título

- Estado: Propuesto | Aceptado | Rechazado | Sustituido por ADR-MMM
- Fecha: AAAA-MM-DD
- Autor / aprobado por: ...
- Paquetes afectados: ...

## Contexto
Problema y fuerzas en juego.

## Decisión
Qué se decide, de forma verificable.

## Consecuencias
Positivas, negativas, trabajo derivado, impacto en contratos y tests.

## Alternativas consideradas
Qué se descartó y por qué.
~~~
