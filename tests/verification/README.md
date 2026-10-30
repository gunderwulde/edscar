# Banco de verificacion analitico de Edscar

Se escribe ANTES que el solver. Los valores esperados salen de formulas cerradas (teoria de vigas de
Euler-Bernoulli, equilibrio, pendiente-desplazamiento, metodo de los nudos, trabajo virtual) derivadas en
comentarios dentro de `reference/`. **Nunca** se copian de la salida de un solver ni de snapshots (ADR-001,
Consecuencias). Convenciones de ejes, signos y unidades: `docs/adr/ADR-001-ejes-signos-unidades.md`.

## Estructura

| Ruta | Contenido |
|---|---|
| `reference/` | Soluciones analiticas en TypeScript puro (no importa `@edscar/*`). `beams.ts` (vigas), `frames.ts` (portico, cercha, pilar), `spatial.ts` (E4 3D), `types.ts` (tipos, polinomios, `present`: V = -Vz, M = -My). |
| `reference/reference.test.ts` | Autoconsistencia de la referencia (siempre se ejecuta, no usa el solver). |
| `builders.ts` | Construye modelos `Project` y los valida SIEMPRE con `validateProject` de `@edscar/model`. |
| `adapter.ts` | Unica puerta al solver: `solveForTest(project, caseId = "C1")`. Detecta la implementacion. |
| `compare.ts`, `harness.ts` | Comparacion (reacciones, desplazamientos, estaciones, `endForces`, pares left/right) y registro de casos. |
| `compare.test.ts` | Prueba de la propia fontaneria de comparacion con resultados simulados (no es verificacion del solver). |
| `cases/*.test.ts` | Un fichero por caso: modelo(s) + comparacion contra la referencia. |

## Deteccion del solver y modos

`adapter.ts` busca en `@edscar/solver` UNICAMENTE `export function createSolver(): Solver` (tipo `CreateSolver`,
contrato fijado en `packages/solver/src/index.ts`; no se admiten un objeto `solver` ni una funcion `solve` sueltos).
Mientras no exista, cada suite "solver vs referencia" queda como `describe.skip` con el
motivo en el nombre (`[SKIP: @edscar/solver aun sin implementacion ...]`) y `pnpm test` sigue en verde. Los tests
"modelo valido" (validateProject) y la autoconsistencia se ejecutan siempre.

- `pnpm verify`: corre `tests/verification`.
- `pnpm verify --require-solver`: las suites del solver 2D FALLAN si falta la implementacion (o si un valor no coincide).
- `pnpm verify --require-3d`: ademas exige el solver 3D (casos "PENDIENTE 3D"; hoy solo E4). El dueno del solver
  pone `SOLVER_SUPPORTS_3D = true` en `adapter.ts` cuando lo implemente.

## Tolerancias

Criterio: `|solver - ref| <= max(rel * |ref|, abs)`.

- `rel = 1e-6` en todo (fijado por el ADR-001).
- Valores esperados ~0: `absForce = 1e-8` kN / kN*m y `absDisp = 1e-10` m / rad por defecto.
- Overrides documentados en el propio caso: porticos (`absForce 1e-6`, `absDisp 5e-9`, por la idealizacion de axil rigido
  con A = 5000 m2), cercha (`absForce 1e-7`), pilar (`absForce 1e-7`, `absDisp 1e-11`).

## Casos (39 comparaciones contra el solver; todas con referencia autoverificada)

| Caso (fichero) | Que prueba | Fuente de la formula | Variantes |
|---|---|---|---|
| E1 `e1-biapoyada-uniforme` | Reacciones 30 kN, Vz, My, flecha -5wL4/(384EI), endForces del ADR; incluye el fichero `packages/model/examples/viga-biapoyada.edscar.json` | ADR-001 E1; Euler-Bernoulli | 5 |
| E2 `e2-voladizo-puntual` | Reaccion de momento -30 (indice 4), My(0)=+30, punta -0.004 / +0.003 | ADR-001 E2 | 2 |
| E3 `e3-axial` | N = +-100, ux = FL/EA, reaccion -F | ADR-001 E3 | 4 |
| Puntual `biapoyada-puntual` | Centrada y excentrica; pares left/right en la carga (member-point) | Reacciones por estatica; flecha por integracion de EI uz'' = -My | 5 |
| Biempotrada `biempotrada-uniforme` | Empotramiento perfecto +-wL2/12 (My_i = -wL2/12), flecha wL4/(384EI) | ADR-001 6.2 | 2 |
| Continua `continua-2-vanos` | Reacciones 3wL/8, 10wL/8, 3wL/8; M_B = -wL2/8; max 9wL2/128 | Ecuacion de tres momentos | 2 |
| Trapezoidal `trapezoidal` | R_A = L(2q1+q2)/6; flecha por doble integracion (contrastada por trabajo virtual) | Estatica + integracion | 3 |
| Asentamiento `asentamiento-continua` | support-displacement: reacciones 3k, -6k, 3k (k = EI d/L3) | Viga empotrada-apoyada con desnivel; rigidez 48EI/(2L)3 | 2 |
| Termico `termico-biempotrada` | N = -EA a dT; My = -EI a gradZ (presentacion M > 0) | ADR-001 5.1 | 4 |
| Peso propio `peso-propio` | w = rho g A (selfWeightFactor = 1) | ADR-001 1 y 5; E1 | 2 |
| Portico `portico-plano` | Lateral, uniforme y combinado; bases empotradas; pilares verticales (y local = -Y) | Pendiente-desplazamiento (derivacion en `frames.ts`) | 3 |
| Cercha `cercha-triangular` | N_AC = -50, N_AB = +40; desplazamientos por compatibilidad y trabajo virtual | Metodo de los nudos | 1 |
| Pilar 180 `pilar-180` | delta = 0 y 1e-4: ejes locales opuestos, My local de signo opuesto | ADR-001 seccion 3 | 2 |
| E4 `e4-rotacion-3d` | **PENDIENTE 3D**: rotation = pi/2, flexion con Iz | ADR-001 E4 | 2 |

## Backlog de casos sin cubrir

Cada caso sigue "Como anadir un caso" (referencia analitica derivada a mano + autoconsistencia). Dueno: QA; revision:
Revisor de ingenieria. Ningun esperado sale del solver.

| # | Caso | Hito | Que debe probar |
|---|---|---|---|
| V1 | Carga parcial uniforme y trapezoidal con `a`, `b` interiores (0 < a < b < L) | M1 | Pares left/right en x = a y x = b; FEF por integracion; flecha por trabajo virtual |
| V2 | Momentos puntuales de barra (`member-point.m`, local y global) | M1 | Salto de My con el signo de ADR-001 6.1; reacciones; FEF del par |
| V3 | Liberaciones y GDL sin rigidez (ADR-005) | M1 | Empotrada-apoyada con `wz = -w`: ry_j liberado -> My_i = -wL2/8, Fz_i = 5wL/8, Fz_j = 3wL/8; ry_i liberado -> simetrico (My_j = +wL2/8); release de cortante uz; patrones de mecanismo interno (segun la alternativa A/B que apruebe el propietario, ADR-005 1.3); torsor transformado a locales; momento nodal en nudo articulado -> `invalid-model`; **momento perdido**: barra DC con {uz_i, ry_i} y carga, unida en j al nudo de cercha C -> `invalid-model` nombrando la barra (ADR-005 2.5); mismo caso con apoyo que restringe C.ry -> `ok`, reaccion indice 4 = -(momento de la barra), C fuera de `indeterminateDofs` (2.6); mecanismo real -> `singular` con nudo/GDL en `message`; E, A o I <= 0 -> `invalid-model`; aviso de mal condicionamiento con EA grande (`ok` + `message`). Cuando se apruebe el campo: `cercha-triangular` debe comprobar `indeterminateDofs = {A:[4], B:[4], C:[4]}` y reacciones indice 4 exactamente 0. Todos los contraejemplos de ADR-005 4 entran en el banco |

| V4 | Porticos con barras inclinadas (dintel a dos aguas) | M1 | Transformacion local/global con angulo arbitrario; cargas `frame: "global"` por longitud real (no proyectada) |
| V5 | Cercha con nudo cargado horizontalmente | M1 | Esfuerzos y desplazamientos con carga no simetrica |
| V6 | Portico espacial y cercha espacial | M4 | Torsion, flexion biaxial, `rotation` != 0; criterio de aceptacion M4 (referencia independiente). **Obligatorio antes del ADR de M4:** cercha espacial con `ry`, `rz` liberados en ambos extremos y torsion NO liberada -> `ok` (no falso `singular` por el modo de giro repartido entre nudos, ADR-005 2.3) |
| V7 | Combinaciones EN 1990 | M3 | Superposicion lineal de casos fuera del solver; tabla de combinaciones revisada (factores de `@edscar/codes` con cita) |

## Hipotesis y puntos abiertos (para el Arquitecto / dueno del solver)

1. **Cercha:** con todas las barras articuladas, los GDL de giro de los nudos no tienen rigidez. Tratamiento propuesto en
   `docs/adr/ADR-005-gdl-sin-rigidez-mecanismos.md` (Propuesto, pendiente del propietario): condensacion de liberaciones por
   barra + eliminacion de los giros sin rigidez, sin estabilizacion artificial; status `ok`, reaccion en ry = 0 exacto,
   giro 0 por convencion (no se compara). Mecanismos reales -> `singular` con nudo/GDL en `message`. Revision 2 del ADR:
   cargas de barra que dejan momento en un giro eliminado no restringido -> `invalid-model`; la parte 3D queda para M4.
2. **Portico:** la referencia desprecia la deformacion axil; el modelo usa A grande para que el error sea << 1e-6.
3. **Apoyos 2D:** los modelos fijan solo ux, uz, ry (y rx, rz, uy se restringen internamente segun ADR-001 2.1).
4. **Barras exactamente verticales:** en el portico, los pilares tienen y local = -Y; los esfuerzos de `My` locales se
   comparan con esa convencion (no se asume que My local sea el momento global alrededor de Y).

## Como anadir un caso

1. En `reference/` escribe la funcion con la derivacion en comentario (SI, ADR-001). Devuelve `BeamRef` (vigas: `forces`, `uz`,
   `thetaY`, `reactions`, `jumps`) o `CaseRef` (porticos/cerchas). Ningun valor sale del solver.
2. En `reference/reference.test.ts` anade su autoconsistencia: dV/dx, dM/dx, uz' = -theta, theta' = M/EI, equilibrio global y
   un valor notable calculado a mano (p. ej. wL2/8).
3. En `cases/<nombre>.test.ts` construye el modelo con `buildBeam`/`buildProject` (validan con `validateProject`) y registra
   `registerCase("Titulo", [{ name, build, ref, tol? }])`. Para vigas, `beamToCase(ref, xs)` proyecta la referencia sobre la malla.
4. Comprueba `pnpm test` (la comparacion queda `skip` sin solver) y `pnpm verify --require-solver` cuando el solver exista.
