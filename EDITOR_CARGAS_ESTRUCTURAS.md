# Edscar — Editor web de cargas para estructuras · Investigación y especificación para equipo de agentes IA

Versión 0.1 · 2026-10-30 · Estado: borrador para arrancar el desarrollo

> **Cómo leer este documento.** Las secciones 1–4 son investigación (qué existe, qué debe hacer un editor de cargas). Las secciones 5–10 son la especificación ejecutable: arquitectura, modelo de datos, roles de agentes, hitos y criterios de aceptación.
> Las afirmaciones marcadas **[V]** vienen de fuentes web consultadas (sección 12). Las marcadas **[C]** son conocimiento general de ingeniería estructural y **deben verificarse contra la norma vigente** antes de usarse en cálculo real.

---

## 1. Objetivo del producto

Un editor web (navegador, sin instalación) para **definir, aplicar, visualizar y combinar cargas sobre modelos de estructuras de barras** (vigas, pórticos, cerchas; 2D primero, 3D después) y enviarlas a un solver para obtener reacciones, esfuerzos y desplazamientos.

Usuario objetivo: estudiantes e ingenieros que hoy usan SAP2000/ETABS/Robot (potentes pero de escritorio y de pago) u OpenSees (potente, pero solo por scripts) y quieren algo rápido, visual y compartible por URL.

Fuera de alcance en v1: diseño de secciones de hormigón/acero según norma, elementos placa/lámina/sólidos, análisis dinámico no lineal, BIM completo.

## 2. Panorama de herramientas existentes

### 2.1 Comerciales de referencia (de ellas copiamos el modelo mental)
- **SAP2000 / ETABS (CSI)**: separan *Load Patterns* (la carga en sí, p. ej. Muerta, Viva, Sismo), *Load Cases* (cómo se analiza: estático lineal, modal, espectro de respuesta, pandeo, etc.) y *Load Combinations* (suma factorizada de casos). Existen "design load types" para generar combinaciones automáticas. La definición de patrones/casos/combos no exige seleccionar objetos; la asignación sí. **[V]** (docs CSI y tutoriales).
- **Robot, STAAD.Pro, RFEM, SCIA**: misma separación; añaden generadores automáticos de viento/nieve/sismo y cargas móviles. **[C]**
- **SkyCiv, calculadoras web de combinaciones**: muestran que hay demanda de herramientas web ligeras; suelen cubrir solo la tabla de combinaciones. **[V]**

### 2.2 Abiertos y web (de ellas aprendemos la arquitectura)
- **Stabileo**: análisis 2D/3D en navegador, método de rigidez directa, solver en Rust compilado a WebAssembly, corre local sin cuenta; nació como herramienta docente (FIUBA). Licencia AGPL-3.0 (¡atención si se quiere reutilizar código!). **[V]**
- **Edubeam**: vigas, cerchas y pórticos 2D en navegador, solución en tiempo real, formulación Timoshenko, front-end Vue + TypeScript. **[V]**
- **FEAScript**: FEA educativo en navegador (elementos 1D/2D). **[V]**
- **Buckle**: app web para pórticos 3D, código en GitHub. **[V]**
- **OpenSees**: solver abierto muy potente sin GUI; referencia para formato de entrada y elementos. **[V]** (mencionado como el hueco que Stabileo cubre).
- **PyNite, CalculiX, awatif, Ospgrid**: candidatos a evaluar; la búsqueda no devolvió información, **pendiente de investigar** (tarea del agente Investigador, sección 8).

### 2.3 Conclusión del mercado
El hueco: editor **visual de cargas** moderno, web, con **combinaciones normativas automáticas** y **exportación a formatos estándar**. Los abiertos existentes resuelven el solver pero tienen editores de cargas básicos (sin cargas de área/trapezoidales, sin generador de combinaciones por norma, sin trazabilidad).

## 3. Funcionalidades que debe tener un editor de cargas

### 3.1 Tipos de carga (por prioridad)
| P | Tipo | Descripción | Notas |
|---|------|-------------|-------|
| P0 | Puntual en nudo | Fuerzas Fx,Fy,Fz y momentos Mx,My,Mz | Ejes globales |
| P0 | Distribuida uniforme en barra | w en ejes locales o globales, por unidad de longitud | Posible tramo parcial |
| P0 | Puntual en barra | P a distancia a (absoluta o relativa) | |
| P0 | Peso propio | Factor × g × ρ·A, automático | Dirección configurable |
| P1 | Distribuida trapezoidal/triangular | w1→w2 con tramo inicio/fin | |
| P1 | Momento concentrado en barra | | |
| P1 | Temperatura | ΔT uniforme y gradiente | Requiere α del material |
| P1 | Desplazamiento impuesto (asentamiento) | En apoyos | |
| P2 | Carga de superficie → barras | Carga por m² repartida a barras por ancho tributario/áreas de influencia | Clave para edificios |
| P2 | Presión de viento / nieve | Generadores paramétricos por norma | **[C]** verificar norma |
| P2 | Sismo estático equivalente | Fuerzas laterales por piso | Espectro modal fuera de v1 |
| P3 | Cargas móviles (línea de influencia) | Camiones tipo | v2 |

### 3.2 Jerarquía de datos de carga
1. **Load Pattern** (nombre, tipo normativo: D, L, Lr, S, W, E, T…, factor de peso propio).
2. **Cargas** pertenecientes a un patrón, asignadas a nudos/barras.
3. **Load Case**: análisis (v1: solo *estático lineal*) que referencia patrones con factor.
4. **Load Combination**: lista de (caso, factor), con tipo (ELU, ELS, envolvente, accidental). Soporta combinaciones anidadas y **envolventes**.
5. **Generador de combinaciones** por norma (EN 1990, ASCE 7, y local configurable), editable tras generar.

### 3.3 Combinaciones normativas (resumen para sembrar el generador)
- **EN 1990**: forma fundamental ELU con permanentes ×1,35 (desfavorable) y variable principal ×1,5, acompañantes con coeficientes ψ. El Anexo Nacional puede cambiar expresiones (6.10 vs 6.10a/b). **[V]**
- **ASCE 7 (LRFD)**: factores fijos por combinación, p. ej. 1,4D; 1,2D+1,6L+0,5(Lr|S|R); permanente favorable 0,9. **[V]**
- Diferencia conceptual: EN usa ψ para variable líder/acompañante; ASCE usa factores fijos. **[V]**
- Las combinaciones sísmicas/viento/nieve completas **no pudieron confirmarse en las fuentes**: el agente de Normas debe extraerlas de la norma primaria y entregarlas como **datos JSON versionados con test**, nunca hardcodeadas en la UI.
- Ejemplo real de tutorial: 1,4G+1,6Q; G+Q−E; 0,9G±E. **[V]**

### 3.4 Funciones de UX esperadas
- Lienzo 2D/3D con selección (clic, caja, por filtro: tipo, sección, planta).
- Panel de propiedades con edición numérica y unidades (kN, kN/m, kN·m; sistema SI y opción imperial).
- Visualización de cargas: flechas escaladas, rellenos para distribuidas, colores por patrón, leyenda, mostrar/ocultar por patrón.
- Visualización de resultados: deformada, diagramas N/V/M, reacciones, por caso o combinación; envolventes.
- Deshacer/rehacer ilimitado, copiar/pegar cargas, asignar a selección múltiple, "reemplazar/añadir/eliminar" como en CSI.
- Tabla de datos editable (tipo hoja) sincronizada con el lienzo.
- Validación en vivo: modelo inestable (mecanismo), nudos sueltos, cargas sin patrón, combinaciones vacías.
- Informe: memoria de cálculo exportable (PDF/HTML) con modelo, cargas, combinaciones y resultados.
- Guardado: local (IndexedDB), archivo `.json`, compartir por URL/enlace.
- Accesibilidad, idioma ES/EN, modo oscuro.

## 4. Formatos de intercambio (importación/exportación)
- **JSON propio** (fuente de verdad, versionado con `schemaVersion`).
- **SAF (Structural Analysis Format)**: formato abierto basado en Excel, de Nemetschek/SCIA, para intercambio de modelos analíticos; permite exportar, editar en Excel y reimportar. **[V]** Buena opción P1.
- **IFC Structural Analysis View** (buildingSMART): existe pero en herramientas como Archicad figura como experimental. **[V]** P3.
- **CSI**: SAP2000/ETABS exponen IFC, CIS/2, SDNF y texto `.s2k`. **[V]** `.s2k` como exportación P2 (formato de texto documentado por CSI).
- **OpenSees (Tcl/Python)**: exportar script ejecutable. **[C]** P2.
- **CSV/Excel** de nudos, barras y cargas. P1.
- STAAD, OpenSees JSON: sin información verificada; investigar.

## 5. Arquitectura propuesta

**Stack (web, fijado en ADR-006 para M2):** TypeScript estricto · Vite · React · SVG propio para la vista 2D · Three.js (vía react-three-fiber) para 3D, reservado a M4 · estado propio en `@edscar/ui-state` con historial por comandos, enlazado a React con `useSyncExternalStore` (sin Zustand ni Redux) · Zod para validar el esquema · Vitest + Testing Library (happy-dom) + Playwright (e2e, pendiente) · Web Worker propio para el solver.

**Capas (cada una en su paquete `@edscar/*`, con dependencias solo hacia abajo):**
```
apps/web                 Edscar UI (React): lienzo, paneles, tablas, informes
packages/ui-state        @edscar/ui-state  Store, comandos (undo/redo), selección
packages/model           @edscar/model     Tipos + esquema Zod + migraciones + validación (SIN dependencias de UI)
packages/loads           @edscar/loads     Patrones, casos, combinaciones, generadores normativos, cargas -> vector nodal
packages/codes           @edscar/codes     Datos normativos JSON (Eurocódigos + Anexos Nacionales) + tests
packages/solver          @edscar/solver    Rigidez directa 2D/3D (TS puro), corre en Worker
packages/io              @edscar/io        Import/export: JSON, CSV, SAF, s2k, OpenSees
packages/report          @edscar/report    Generación de informes
```
Extensión de archivo de proyecto: `.edscar.json`.

**Decisión de solver:** **solver propio en TypeScript escrito desde cero** (método de rigidez directa, barras Euler-Bernoulli, 2D → 3D), sin librerías de álgebra ni código de terceros (ver sección 13); interfaz `Solver` estable para poder reescribirlo en Rust/WASM más adelante, también desde cero.

**Unidades:** el modelo se guarda siempre en SI coherente (m, kN, kN·m, °C); la conversión ocurre solo en la capa de UI.

## 6. Modelo de datos (borrador inicial, fuente: `packages/model`)

```ts
type Id = string;                      // uuid
interface Project { schemaVersion: number; units: UnitSystem; analysis: '2D-XZ'|'3D'; nodes: Node[]; members: Member[];
  materials: Material[]; sections: Section[]; supports: Support[];
  patterns: LoadPattern[]; loads: Load[]; cases: LoadCase[]; combinations: LoadCombination[];
  settings: { gravity: [number,number,number]; codeId?: string } }
interface Node { id: Id; x: number; y: number; z: number }
interface Member { id: Id; i: Id; j: Id; material: Id; section: Id; releases?: Releases; rotation?: number }
interface LoadPattern { id: Id; name: string; kind: 'D'|'SD'|'L'|'Lr'|'S'|'W'|'E'|'T'|'Other'; selfWeightFactor: number }
type Load =
 | { id: Id; pattern: Id; type: 'nodal'; node: Id; f: [number,number,number]; m: [number,number,number] }
 | { id: Id; pattern: Id; type: 'member-uniform'; member: Id; w: [number,number,number]; frame: 'local'|'global'; a?: number; b?: number }
 | { id: Id; pattern: Id; type: 'member-trapezoid'; member: Id; w1: Vec3; w2: Vec3; frame: 'local'|'global'; a: number; b: number }
 | { id: Id; pattern: Id; type: 'member-point'; member: Id; p: Vec3; m?: Vec3; at: number; relative: boolean; frame: 'local'|'global' }
 | { id: Id; pattern: Id; type: 'thermal'; member: Id; dT: number; gradientZ?: number; gradientY?: number }  // °C, °C/m
 | { id: Id; pattern: Id; type: 'support-displacement'; node: Id; d: Dof6 };  // global, m y rad
interface LoadCase { id: Id; name: string; type: 'static-linear'; terms: { pattern: Id; factor: number }[] }
interface LoadCombination { id: Id; name: string; kind: 'ULS'|'SLS'|'ACCIDENTAL'|'ENVELOPE'|'CUSTOM';
  terms: { ref: Id; refType: 'case'|'combination'; factor: number }[] }
```
Ubicación en barra: `a`, `b` de cargas uniforme/trapezoidal en m absolutos desde el nudo i; `at` de la puntual relativo o absoluto según `relative`. Cargas distribuidas por unidad de longitud real de la barra en ambos marcos. Liberaciones en ejes locales. Detalle de signos y unidades: ADR-001 (el contrato vigente es `packages/model/src/index.ts`).
Reglas: IDs estables, sin referencias colgantes (validación), migraciones por `schemaVersion`, todas las operaciones de UI son **comandos** serializables (base de deshacer/rehacer y de colaboración futura).

## 7. Requisitos no funcionales
- Solver 2D de 500 barras en < 100 ms en portátil medio; UI a 60 fps con 5 000 barras (instancing).
- Solver en Web Worker; UI nunca se bloquea.
- Determinismo: mismo JSON → mismos resultados; tests de regresión con soluciones analíticas.
- Cobertura de tests: ≥ 90 % (lines, statements, functions, branches), por paquete, en `model`, `loads`, `solver`, `codes`. Lo exige `pnpm coverage` en CI (`vitest.config.ts`, ADR-004). Hasta M1, `loads`, `solver` y `codes` (aún stubs de contrato) están excluidos explícitamente del umbral; cada uno entra al empezar su implementación.
- Sin backend en v1 (todo en cliente). Privacidad: nada sale del navegador.
- Licencia del proyecto: MIT (ver sección 13).

## 8. Equipo de agentes IA — roles y responsabilidades

| Agente | Responsabilidad | Entregables | Dueño de |
|---|---|---|---|
| **Arquitecto** | Mantiene este documento, ADRs, contratos entre paquetes, revisa PRs transversales | `docs/adr/*.md`, interfaces `.d.ts` | estructura del monorepo |
| **Investigador** | Cierra los huecos marcados "pendiente" (PyNite, awatif, OpenSees JSON, STAAD, `.s2k`) | `docs/research/*.md` con fuentes | conocimiento |
| **Modelo de datos** | `packages/model`: tipos, Zod, migraciones, validación | código + tests | esquema |
| **Solver** | `packages/solver`: rigidez directa, cargas equivalentes nodales, apoyos, resultados | código + banco de verificación | cálculo |
| **Cargas y combinaciones** | `packages/loads` + `packages/codes` | generadores, datos normativos JSON con cita de artículo | lógica de cargas |
| **UI/Canvas** | Lienzo 2D/3D, selección, visualización de cargas y resultados | `apps/web` | render |
| **UX/Paneles** | Paneles de propiedades, tablas, formularios, atajos, i18n | `apps/web` | interacción |
| **I/O** | Importar/exportar JSON, CSV, SAF, s2k, OpenSees | `packages/io` + fixtures | formatos |
| **QA/Verificación** | Casos de verificación contra soluciones analíticas y e2e (Playwright) | `tests/` | calidad |
| **Revisor de ingeniería** | Revisa fórmulas, signos, convenciones y normas; veto sobre resultados numéricos | informes de revisión | corrección técnica |
| **Docs/Informes** | Memoria de cálculo, ayuda de usuario, README | `packages/report`, `docs/` | documentación |

**Reglas de coordinación**
1. Un agente solo edita su paquete; cambios en contratos pasan por el Arquitecto.
2. Todo cambio en `solver`, `loads` o `codes` requiere test **y** revisión del Revisor de ingeniería.
3. Convención de signos y ejes se fija en ADR-001 antes de escribir código (ver `docs/adr/ADR-001-ejes-signos-unidades.md`, que prevalece sobre este resumen: ejes globales X,Y,Z diestros con Z arriba tanto en 3D como en 2D, donde el modelo vive en el plano X–Z — se descarta la propuesta inicial "Y arriba en 2D"; ejes locales de barra x a lo largo de i→j; fuerzas positivas según el eje; momentos por regla de la mano derecha; diagramas dibujados del lado de la tracción).
4. Ningún dato normativo sin cita (norma, edición, artículo). Si no se puede verificar, se marca `unverified: true` y la UI avisa.
5. Cada PR: descripción, tests, captura/GIF si toca UI.

## 9. Hitos y criterios de aceptación

**M0 — Cimientos (semana 1)**: monorepo, CI, ADR-001 (signos/unidades), esquema `model` v1, JSON de ejemplo.
*Aceptación:* `pnpm test` verde; proyecto de ejemplo valida y migra.

**M1 — Cargas P0 + solver 2D**: nudos, barras, apoyos, cargas puntuales/uniformes/peso propio, patrones, casos estáticos, resultados (reacciones, N/V/M, deformada).
*Aceptación:* banco de verificación — viga simplemente apoyada con carga uniforme (M=wL²/8, δ=5wL⁴/384EI), viga en voladizo con puntual (δ=PL³/3EI), pórtico simple contrastado con valores de referencia; error < 1e-6 relativo.
*Estado (2026-10-30): CERRADO.* Solver 2D (`@edscar/solver`, ADR-005 en 2D: condensación de liberaciones, eliminación de giros sin rigidez, detección de mecanismos, `indeterminateDofs`, deformada `deflections`) **aprobado por el Revisor de ingeniería**. Aclaraciones de implementación en ADR-005, anexos A (deformada de barras con mecanismo interno sin carga) y B (cargas distribuidas diminutas y recorte de trapecios).

**M2 — Editor visual 2D**: dibujar modelo, asignar cargas por selección, visualización de cargas por patrón, tabla sincronizada, deshacer/rehacer, guardado local y JSON.
*Aceptación:* un usuario nuevo modela y resuelve una viga con 3 patrones en < 5 min (prueba e2e).
*Estado (2026-10-30): EN CURSO.* Base técnica en ADR-006: Vite 7 + React 19, estado propio sobre `@edscar/ui-state` (sin Zustand), lienzo SVG propio, solver en Web Worker con protocolo tipado (`apps/web/src/worker/`), tests de UI con Testing Library + happy-dom y build de web en CI. Plan e2e en `tests/e2e/README.md` (Playwright aún sin instalar). Avance: **lienzo SVG 2D hecho** (`apps/web/src/canvas/`); **paneles y tabla en curso** (`apps/web/src/panels/`); pendientes la marca de "indeterminado" en UI (ADR-005 §2.7 y Anexo A) y los e2e.

**M3 — Combinaciones**: casos, combos manuales, envolventes, generador EN 1990 y ASCE 7 desde datos JSON con cita.
*Aceptación:* tests comparan combos generados contra tabla manual revisada por el Revisor de ingeniería.

**M4 — 3D y cargas P1**: trapezoidales, térmicas, asentamientos, 3D con rotación de sección.
*Aceptación:* pórtico espacial contrastado con referencia independiente (OpenSees o cálculo manual documentado).

**M5 — I/O e informes**: CSV, SAF, exportación OpenSees/s2k, memoria de cálculo PDF/HTML.
*Aceptación:* modelo exportado a OpenSees reproduce reacciones dentro de tolerancia.

**M6 — Cargas de superficie, viento/nieve/sismo estático (P2)** con datos normativos citados.

## 10. Riesgos y decisiones abiertas
| Riesgo / decisión | Mitigación |
|---|---|
| Errores de signo/ejes en cargas locales vs globales | ADR-001 + tests por cada tipo de carga y marco |
| Normas mal transcritas | Datos JSON con cita + revisor humano/ingeniero; aviso en UI "no sustituye verificación profesional" |
| Licencias de terceros | Resuelto: no se reutiliza código (sección 13) |
| Rendimiento 3D | Instancing, WebGL, LOD |
| Responsabilidad profesional | Disclaimer legal; marcar herramienta como apoyo/educativa en v1 |
| Norma objetivo | **DECIDIDO: Europa** → Eurocódigos (EN 1990, EN 1991-1-x, EN 1998) con Anexos Nacionales por país. ASCE 7 queda fuera de v1 (solo opcional en v2). |
| Código de terceros | **DECIDIDO: no se reutiliza código de terceros.** Ver sección 13. |
| Licencia | **DECIDIDO: MIT** (sección 13) |
| Nombre del proyecto | **DECIDIDO: Edscar** (repositorio, paquetes `@edscar/*`, título de la app) |
| Punto de entrada del solver | **DECIDIDO (Arquitecto):** `@edscar/solver` exporta solo `createSolver(): Solver` (`packages/solver/src/index.ts`) |
| Cerchas / GDL de giro sin rigidez y mecanismos | **DECIDIDO (2D):** ADR-005 Aceptado (condensación de liberaciones con criterio de ortogonalidad + eliminación de giros sin rigidez, sin estabilización; mecanismo → `singular` con nudo/GDL; deslizaderas en ambos extremos → `invalid-model` en v1; `SolveResult.indeterminateDofs?`). Implementación 2D aprobada por el Revisor de ingeniería (M1); anexos A y B (deformada de mecanismos internos sin carga con aviso en `message`; cargas distribuidas diminutas). 3D pendiente del ADR de M4 |
| Barras con posición indeterminada (mecanismo interno sin carga) | **DECIDIDO (ADR-005 Anexo A):** deformada unida a los nudos por convención (`recoverAttached`), aviso en `message` con `status: "ok"`; la UI debe marcarlas como indeterminadas (pendiente en M2) |
| Base de `apps/web` (M2) | **DECIDIDO (Arquitecto, delegado por el propietario):** ADR-006. Pendiente del propietario: excepción CC-BY-4.0 para `eslint-plugin-react-hooks` |

## 11. Primeras tareas concretas (backlog inicial)
1. Arquitecto: crear monorepo y ADR-001 (ejes, signos, unidades).
2. Investigador: informe PyNite/awatif/OpenSees JSON/`.s2k`/SAF (spec de columnas).
3. Modelo: esquema Zod v1 + proyecto ejemplo "viga biapoyada".
4. Solver: ensamblado de rigidez 2D + cargas equivalentes de empotramiento perfecto (uniforme y puntual).
5. QA: banco de verificación analítico (3 casos) antes de que el solver esté terminado (TDD).
6. UI: lienzo 2D con nudos/barras y flechas de carga básicas.
7. QA: ampliar el banco de verificación con los casos V1–V7 del backlog de `tests/verification/README.md` (V1–V5 en M1, V7 en M3, V6 en M4).
8. **HECHO (M1, aprobado por el Revisor de ingeniería):** Solver: implementar ADR-005 en 2D (condensación, eliminación de giros, detección de mecanismos, `indeterminateDofs`) con los tests listados en sus Consecuencias. QA: comprobar que los casos están en V3 y que no quedan referencias "Propuesto" en `tests/verification`.
9. **HECHO (M1):** Solver (seguimiento de ADR-006 §3): `SolveResult.deflections` (deformada en ejes globales, m; criterio de ADR-005 Anexo A en barras con mecanismo interno sin carga) y `status: "unsupported"` para `analysis: "3D"`.
10. Arquitecto/propietario: decidir la excepción CC-BY-4.0 (`caniuse-lite`, solo desarrollo) que necesitaría `eslint-plugin-react-hooks` (ADR-006 §6).
11. UI/Canvas: lienzo SVG 2D en `apps/web/src/canvas/` (transformación mundo↔pantalla, nudos, barras, apoyos, cargas por patrón, selección) — **HECHO**. UX/Paneles: paneles y tabla en `apps/web/src/panels/` — **EN CURSO**. Ambos sobre `@edscar/ui-state` (comandos, deshacer/rehacer; dueño: agente que lleve `ui-state`).
12. QA: instalar Playwright (verificar licencia y registrarlo en `THIRD_PARTY.md`) e implementar los flujos de `tests/e2e/README.md`.
13. UI (Canvas y Paneles/informes): mostrar como "indeterminado" los giros de `indeterminateDofs`, los desplazamientos de barra que dependen de ellos (ADR-005 §2.7) y las barras con aviso de mecanismo interno sin carga (ADR-005 Anexo A; detectarlas por el aviso de `message` o por sus liberaciones).

## 13. Decisiones del propietario (vinculantes para todos los agentes)

1. **Mercado/normativa: Europa.** El generador de combinaciones y los generadores de viento/nieve/sismo siguen los Eurocódigos (EN 1990 Anexo A1 para edificación, EN 1991-1-1 acciones permanentes y sobrecargas, EN 1991-1-3 nieve, EN 1991-1-4 viento, EN 1998-1 sismo). Cada país aporta un **Anexo Nacional** como fichero de datos (valores de γ, ψ y elección de expresión 6.10 / 6.10a-b), seleccionable en `settings.codeId`. **Orden de cobertura de Anexos Nacionales (decidido):** 1) perfil "EN recomendado" (valores base sin anexo), 2) España, 3) Francia, 4) Alemania, 5) Italia. Cada país entra en M3 o posterior como un fichero de datos independiente con sus tests; no se empieza el siguiente hasta que el anterior está verificado por el Revisor de ingeniería. Las secciones que mencionan ASCE 7 quedan **fuera de alcance de v1**.
2. **Cero código de terceros.** Todo el código del repositorio lo escriben los agentes desde cero:
   - Prohibido copiar, traducir o adaptar código de otros proyectos (Stabileo, Edubeam, OpenSees, PyNite, etc.). Se pueden estudiar sus ideas generales, pero no su código.
   - El solver se implementa desde la teoría publicada (método de rigidez directa) y se verifica con soluciones analíticas, no comparando contra el código de otros.
   - **Dependencias de terceros:** se limitan a infraestructura genérica no estructural (React, Vite, Three.js, Zod, Vitest, Playwright, etc.). Cualquier otra dependencia, y en particular cualquier librería de álgebra lineal o de elementos finitos, requiere ADR aprobado por el propietario. Recomendación: escribir el solver de sistemas lineales propio (Cholesky/LDLᵀ para matriz simétrica definida positiva).
   - Los agentes no pegan fragmentos de Stack Overflow, gists ni repos. Cada PR incluye una declaración de originalidad.
   - Las normas se usan como **datos con cita** (valores numéricos y artículo), no copiando texto literal extenso: son material con derechos de autor (CEN/organismos nacionales).
   - Archivo `THIRD_PARTY.md` en la raíz con la lista exhaustiva de dependencias y su licencia; el CI falla si aparece una dependencia no listada.
   - **Licencia del proyecto: MIT** (abierta total, permisiva, sin copyleft). Archivo `LICENSE` en la raíz desde M0. Las dependencias admitidas deben tener licencia compatible (MIT, BSD, Apache-2.0, ISC). Además se admite **BlueOak-1.0.0 solo en dependencias de desarrollo**, nunca en el cierre de runtime de la aplicación (decisión del propietario, ADR-004; lo comprueba `scripts/check-third-party.mjs`). Queda prohibida cualquier dependencia GPL/AGPL/LGPL, y cualquier otra licencia no listada requiere aprobación explícita del propietario.
3. **Impacto en el reparto de roles:** el Investigador no deja código en el repo; solo informes. El Revisor de ingeniería verifica además la declaración de originalidad en los PRs de `solver`, `loads` y `io`.
4. **Impacto en formatos:** SAF, `.s2k` y OpenSees se implementan escribiendo el exportador/importador propio a partir de la documentación del formato, sin librerías de terceros.

## 12. Fuentes consultadas
- CSI — formulario de Load Cases (SAP2000): https://docs.csiamerica.com/help-files/sap/Menus/Define/Load_Cases/Load_Case_Data_Form.htm
- Tutorial ITU, ejemplo SAP2000 (combinaciones): https://web.itu.edu.tr/darilmazk/tr/SAP2000Example01.pdf
- Stabileo (solver Rust/WASM, AGPL-3.0): https://github.com/lambdaclass/stabileo/wiki · https://github.com/GreatDevelopers/stabileo
- Edubeam: https://awesome.ecosyste.ms/projects/github.com%2Fjanvorisek%2Fedubeam
- FEAScript: https://gh.r-mj.com/p1ll3chan/FEAscript
- Hilo three.js sobre FEA web: https://discourse.threejs.org/t/finite-element-analysis-web-app/89097
- Combinaciones EN 1990 (calculadora): https://steelcalculator.pages.dev/tools/load-combinations-en1990/
- Resumen de combinaciones SkyCiv: https://skyciv.com/resources/load-combinations/
- Autodesk Robot, combinaciones: https://help.autodesk.com/cloudhelp/2026/ENU/RSAPRO-UsersGuide/files/GUID-3DC512F1-85AD-49A5-AB82-56721B26CCD6.htm
- SAF (SCIA/Nemetschek): https://www.scia.net/en/innovations/structural-analysis-format-saf
- Formatos de importación/exportación CSI: https://web.wiki.csiamerica.com/wiki/x/xNEe

> Nota de calidad: varias fuentes son tutoriales, calculadoras y foros, no las normas ni manuales oficiales. Antes de implementar `codes`, el Investigador debe contrastar con EN 1990/EN 1991 y ASCE 7 (secc. 2.3 y cap. 26–27) y las normas locales aplicables.
