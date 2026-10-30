# ADR-005: Liberaciones, GDL sin rigidez y detección de mecanismos en el solver

- Estado: **Aceptado** (2026-10-30). Decisiones delegadas por el propietario en el agente coordinador y registradas al final de este ADR. Revisado por el Revisor de ingeniería (revisión 2: CAMBIOS REQUERIDOS acotados, aplicados en esta revisión 3). Implementación 2D aprobada por el Revisor de ingeniería (hito M1). Revisión 4: anexos A y B, aclaraciones de implementación que no cambian decisiones ni contrato.
- Fecha: 2026-10-30 (revisión 2: 2026-10-30; revisión 3 y aceptación: 2026-10-30; revisión 4, anexos: 2026-10-30)
- Autor: Arquitecto
- Paquetes afectados: `solver` (implementación), `report` y `apps/web` (lectura de `indeterminateDofs`), `tests/verification`
- Alcance aprobado: **solo `"2D-XZ"` (M1)**. Todo lo marcado "3D (M4)" es orientativo y queda **pendiente de ADR de M4, NO APROBADO** por este ADR.

## Contexto

QA detectó (tests/verification/README.md, "Hipótesis y puntos abiertos", punto 1) que el contrato no dice qué hace el solver cuando un GDL de nudo no tiene rigidez. Caso típico: una cercha cuyas barras están todas articuladas (`releases.i.ry = releases.j.ry = true`). Tras aplicar las liberaciones, ninguna barra transmite momento a los nudos, las filas/columnas de `ry` de la matriz global son nulas y la factorización falla aunque la estructura sea perfectamente estable.

Hay que distinguir dos situaciones que numéricamente se parecen (pivote nulo):

- **GDL sin rigidez benigno**: el giro de un nudo al que solo llegan extremos articulados. No es un grado de libertad de ningún cuerpo; su valor es indeterminado pero no afecta a esfuerzos, reacciones ni desplazamientos de traslación.
- **Mecanismo real**: la estructura (o una parte) puede moverse sin deformarse (falta un apoyo, articulaciones alineadas, barras sueltas). Debe devolverse `status: "singular"` con un mensaje útil.

Restricción: **sin estabilización artificial** (muelles pequeños, penalización, término diagonal ε). Alteran resultados de forma dependiente de la tolerancia y pueden ocultar mecanismos reales.

Notación (ADR-001 §6.2): `f_emp` = fuerzas de empotramiento perfecto (nudo sobre barra, ejes locales); `f_eq = −f_emp`; ensamblaje `K·U = F_nodal + Σ Tᵀ·f_eq`. `⁺` = pseudoinversa de Moore-Penrose.

## Decisión

Se adoptan **las dos técnicas, complementarias**: condensación estática de las liberaciones en cada barra (§1) y eliminación, a nivel de nudo, de los GDL de giro que ninguna barra rigidiza (§2). La condensación sola no basta: tras condensar, el giro de un nudo de cercha sigue sin rigidez; la eliminación sola no basta: sin condensar no se obtienen bien las fuerzas de empotramiento de barras con un extremo articulado.

### 1. Liberaciones: condensación estática por barra

1. **Bloques.** La barra prismática Euler-Bernoulli desacopla cuatro bloques: axil {ux_i, ux_j}, torsión {rx_i, rx_j}, flexión x–z {uz_i, ry_i, uz_j, ry_j} y flexión x–y {uy_i, rz_i, uy_j, rz_j}. La condensación se hace por bloque, en ejes locales, con `k` (12×12) y `f_emp` (ADR-001 §6.2) de extremos fijos. R = componentes liberadas del bloque (ADR-001 §3.1), C = resto.
2. **Fórmulas (válidas tanto si `k_RR` es regular como si es singular).**
   - `k* = k_CC − k_CR·k_RR⁺·k_RC`, `f*_emp = f_emp,C − k_CR·k_RR⁺·f_emp,R`; filas y columnas de R quedan a 0. `f*_eq = −f*_emp`. Si `k_RR` es regular, `k_RR⁺ = k_RR⁻¹`.
   - **Condición de rango (justifica la pseudoinversa).** Como `k` es simétrica semidefinida positiva, las columnas de `k_RC` están en la imagen de `k_RR`; y §1.3 exige que `f_emp,R` también lo esté (ortogonal al núcleo de `k_RR`). Con ambas condiciones, `k*` y `f*_emp` no dependen de la inversa generalizada elegida y la pseudoinversa da la solución exacta.
   - **Recuperación de `u_R`** tras resolver: `u_R = −k_RR⁺·(k_RC·u_C + f_emp,R)`, la solución de **norma mínima** (componente en el núcleo de `k_RR` = 0). Para que la norma sea homogénea en unidades, se calcula en variables escaladas `ũ = D·u`, con `D = diag(1 en traslaciones, L en giros)`: `k̃_RR = D⁻¹·k_RR·D⁻¹`, `f̃ = D⁻¹·f`, `ũ_R = −k̃_RR⁺·(k̃_RC·ũ_C + f̃_emp,R)`, `u_R = D⁻¹·ũ_R` (es decir, norma mínima con los giros multiplicados por L). `u_R` se usa para las estaciones y los esfuerzos; **no** es el giro del nudo. Para la **deformada** de barras con mecanismo interno sin carga (núcleo de `k_RR` no trivial) se usa otra elección dentro del núcleo: ver Anexo A.
   - **`endForces`:** en C, `endForces_C = k*·u_C + f*_emp`; en R, **0 exacto** (se escribe 0, no el resultado numérico). Si el bloque condensado es nulo (§1.5), `endForces_C = f*_emp`, que **en general no es 0** (ver ejemplo de §1.3).
   - **Ejemplo de signos (empotrada-apoyada).** Barra con `wz = −w` local uniforme (w > 0) y `ry_j` liberado: `f*_emp` da `Fz_i = +5wL/8`, `My_i = −wL²/8`, `Fz_j = +3wL/8`, `My_j = 0` (coherente con la biempotrada de ADR-001 §6.2, `My_i = −wL²/12`). Con `ry_i` liberado, por simetría: `Fz_i = +3wL/8`, `My_i = 0`, `Fz_j = +5wL/8`, `My_j = +wL²/8`.
3. **Mecanismo interno de barra (alternativa B, decidida, con la excepción de §1.4).** Si R contiene un modo de sólido rígido de la barra con u_C = 0, `k_RR` es singular. Patrones (criterio combinatorio exacto) y vector del núcleo n en forma cerrada (traslaciones adimensionales, giros como 1/L, de modo que L·giro y traslación son comparables; criterio invariante a la escala de n):

   | Bloque | Patrón (⊆ R) | Núcleo n (componentes de R) | Bloque condensado |
   |---|---|---|---|
   | Axil | {ux_i, ux_j} | (ux_i, ux_j) = (1, 1) | sin C |
   | Torsión | {rx_i, rx_j} | (rx_i, rx_j) = (1, 1)/L | sin C |
   | x–z | R ∩ bloque = {uz_i, uz_j} | traslación (1, 1) | **rechazado en v1 (§1.4)** |
   | x–z | {uz_i, uz_j, ry_i} | (uz_i, uz_j, ry_i) = (1, 1, 0) | nulo (C = {ry_j}) |
   | x–z | {uz_i, uz_j, ry_j} | (uz_i, uz_j, ry_j) = (1, 1, 0) | nulo (C = {ry_i}) |
   | x–z | {uz_i, ry_i, ry_j} | giro rígido alrededor de j: (uz_i, ry_i, ry_j) = (1, 1/L, 1/L) | nulo (C = {uz_j}) |
   | x–z | {uz_j, ry_i, ry_j} | giro rígido alrededor de i: (ry_i, uz_j, ry_j) = (1/L, −1, 1/L) | nulo (C = {uz_i}) |
   | x–z | los cuatro | traslación y giro rígido (núcleo de dimensión 2) | sin C |

   Signos de giro rígido según ADR-001 (giro θ alrededor de +y desplaza `uz = −θ·x`). Ídem en x–y con uy, rz cambiando el signo de la componente de traslación del giro (`uy = +θ·x`). En `"2D-XZ"` las liberaciones rx, uy, rz se ignoran (ADR-001 §2.1), así que en M1 solo aplican axil y x–z.

   - **Criterio de ortogonalidad (carga equilibrable).** Para cada vector n del núcleo, sobre la carga **transformada a ejes locales** (cubre cargas `local` o `global`, puntuales, distribuidas, momentos puntuales y térmicas):

     `|f_emp,R · n| ≤ 1e-9 · S_n`, con `S_n = Σ_{k ∈ R} |f_emp,k · n_k| + Σ_{k = 1…12} w_k·|f_emp,k|`, `w_k = 1` en fuerzas y `1/L` en momentos (kN).

     Ambos términos son homogéneos (n con giros escalados por L, como en §3.8). El segundo término, sobre todas las componentes de `f_emp` de la barra, evita rechazar ruido de proyección (p. ej. un momento global perpendicular a la barra que deja `|Mx local| ~ 1e-17·|m|`). Una carga de torsión real (solo `Mx`) da cociente 1 y se rechaza; una térmica axil en barra con {ux_i, ux_j} liberados da `f_emp,R · n = 0` y se admite.
   - Si no se cumple → `invalid-model`: `Barra <id>: las liberaciones <lista> forman un mecanismo interno (<bloque>) y la barra tiene carga en ese bloque`.
   - **Ejemplo del Revisor (bloque nulo con `f*_emp ≠ 0`).** R = {uz_i, ry_i, ry_j} (C = {uz_j}) y carga puntual local `P_z` en x = L: `f_emp,R = 0` (ortogonal), `k* = 0` y `f*_emp,uz_j = f_emp,uz_j = −P_z ≠ 0` (= +P si la carga es P hacia −z). `endForces.j[2] = −P_z`, no 0. La misma barra con la carga en x = L/2 da `f_emp,R · n = Fz_i + (My_i + My_j)/L = P/2 ≠ 0` (P hacia −z) → `invalid-model` (la barra gira libremente alrededor de j).
4. **Excepción v1 (decisión (i)): deslizaderas en ambos extremos.** Si R ∩ bloque x–z = {uz_i, uz_j} (o R ∩ bloque x–y = {uy_i, uy_j}), el bloque condensado **no** es nulo: `k* = (EI/L)·[[1, −1], [−1, 1]]` sobre (ry_i, ry_j) (ídem rz), es decir, la barra transmite momento pero no cortante. En v1 se rechaza siempre, con o sin carga: `invalid-model`, `Barra <id>: las liberaciones uz_i, uz_j (deslizaderas en ambos extremos) no se admiten en v1; la barra transmitiría momento sin cortante` (ídem uy). Si en el futuro se admite, el modo θ_i = θ_j de los nudos unidos solo por barras de este tipo es un modo de energía nula repartido entre nudos que §3 detectaría como `"singular"` (singular legítimo, no falso: §3.10).
5. **Bloques condensados nulos.** Todos los patrones admitidos con dos o más liberaciones en el bloque de flexión dan `k* = 0` (las parejas {ry_i, ry_j}, {uz_i, ry_i}, {uz_j, ry_j}, {uz_i, ry_j}, {ry_i, uz_j} con `k_RR` regular, y los tríos de §1.3 con `k_RR` singular). Se determinan **combinatoriamente** y `k*` se escribe con **ceros exactos**, no con el residuo numérico `k_CC − k_CR·k_RR⁺·k_RC` (que deja valores ~1e-16·EI/L³), para que las filas y columnas de K de los GDL eliminados en §2 sean exactamente nulas. `f*_emp` sí se calcula con la fórmula de §1.2.
6. **Componentes de momento transmitidas** (usado en §2; criterio exacto a partir de los indicadores, sin tolerancias), para una barra admitida:
   - Momento alrededor de y local en el extremo e ∈ {i, j}: se transmite si y solo si `ry_e ∉ R` y |R ∩ {uz_i, ry_i, uz_j, ry_j}| ≤ 1.
   - Alrededor de z local: igual con {uy_i, rz_i, uy_j, rz_j}.
   - Torsor (alrededor de x local): se transmite en ambos extremos si y solo si R ∩ {rx_i, rx_j} = ∅.
   - **Atención:** "no transmite rigidez" no implica "no transmite carga". En los bloques nulos de §1.5 el extremo con componentes retenidas puede tener `f*_emp ≠ 0`: en `ry` retenido (parejas {uz_i, ry_i}, {uz_j, ry_j}, {uz_i, ry_j}, {ry_i, uz_j}; tríos {uz_i, uz_j, ry_*}) es un momento que se comprueba en §2.5; en `uz` retenido (tríos {uz_*, ry_i, ry_j}) es una fuerza que se ensambla como carga en la traslación del nudo (ejemplo de §1.3).

### 2. GDL de giro sin rigidez: eliminación

1. **Solo se eliminan GDL de giro.** Un GDL de traslación sin rigidez es siempre mecanismo (§3).
2. **`"2D-XZ"` (M1).** El GDL `ry` del nudo n se declara *sin rigidez* si ninguna barra que concurre en n transmite momento alrededor de y local en ese extremo (§1.6). Como en 2D el eje y local es ±Y global (ADR-001 §2.1), el criterio es exacto. En un nudo sin barras (aislado) también se elimina `ry`; sus traslaciones no restringidas carecen de rigidez y se detectan como mecanismo (§3).
3. **`"3D"` (M4) — pendiente de ADR de M4, NO APROBADA.** Orientación: para el nudo n, sea T el conjunto de vectores unitarios globales de los ejes locales (x, y, z de cada barra concurrente) cuyo momento se transmite en ese extremo. El subespacio sin rigidez local es el complemento ortogonal de span(T) (dimensión 0 a 3; rango con tolerancia geométrica 1e-9, la de ADR-001), eliminado mediante un cambio de base nodal. **Riesgo conocido que este criterio local no resuelve:** en una cercha espacial con solo `ry` y `rz` liberados en ambos extremos (torsión no liberada), cada barra transmite torsor, span(T) = ℝ³ en cualquier nudo con tres barras no coplanarias y no se elimina nada; sin embargo, el giro igual ω de todos los nudos unidos solo por barras de torsión es un modo de energía nula **repartido entre nudos** (no deforma ninguna barra a torsión) → pivote nulo → falso `"singular"`. Opciones (no se elige aquí; se decide en el ADR de M4):
   - **(a)** Liberar automáticamente la torsión en un extremo de la barra cuando sus dos bloques de flexión condensados son nulos (la barra deja de transmitir torsor; con torsor aplicado se aplica §1.3).
   - **(b)** Detectar el núcleo por componentes conexas: grafo de nudos unidos por barras que solo transmiten torsor; en cada componente se calcula el subespacio de giros de energía nula (geométrico, no sobre la matriz factorizada) y se elimina.
   - Requisito: el banco de verificación debe incluir una cercha espacial con `ry`, `rz` liberados y torsión no liberada (backlog V6) antes de aprobar el ADR de M4.
4. Los GDL eliminados no entran en el sistema `K_ff·U_f = F_f`. **No se añade rigidez artificial.** Gracias a §1.5 sus filas y columnas de K son exactamente nulas.
5. **Cargas sobre un GDL eliminado no restringido.** Este apartado se aplica **solo a GDL eliminados sin apoyo** que los restrinja (los restringidos siguen §2.6). Antes de factorizar se calcula, para cada GDL eliminado no restringido g, el residuo de carga

   `r_g = F_nodal,g + Σ_barras (Tᵀ·f*_eq)_g`

   (en 3D, proyectado sobre la base del subespacio eliminado). La carga es equilibrable si y solo si r_g = 0. Tolerancia relativa a la magnitud de la carga: se exige `|r_g| ≤ 1e-9·S_g`, con `S_g = Σ |c_k| + L_max·F_max`, donde c_k son las contribuciones individuales a r_g (carga nodal y cada barra), L_max la mayor longitud de barra del modelo y F_max la mayor componente de fuerza (nodal o resultante de carga de barra) del caso. Si no se cumple → `status: "invalid-model"`:
   - Si r_g procede solo de la carga nodal: `Nudo <id>: momento aplicado en <ry> pero ninguna barra transmite momento a ese nudo (todas articuladas)`.
   - Si alguna barra contribuye: `Barra <id>: su carga produce un momento <valor> kN·m en el extremo <i|j> (nudo <id>, GDL <ry>) que ninguna barra transmite (nudo articulado); revise liberaciones`, nombrando la barra de mayor |c_k| y, si hay varias, añadiendo `(también: <ids>)`.
   - Si las contribuciones se compensan (r_g = 0 con c_k ≠ 0, p. ej. dos voladizos simétricos unidos en un nudo articulado), la carga es equilibrable: se acepta y el GDL se trata como indeterminado (§2.7). **§3 no detecta** el giro rígido conjunto de esas barras alrededor del nudo: solo afecta a GDL eliminados, que no entran en la factorización. Se acepta como indeterminado: el giro del nudo y los desplazamientos `u_R` (y de estaciones) de esas barras son indeterminados (§2.7).
6. **GDL eliminado y restringido por un apoyo** (aprobado en 2D; **en 3D: pendiente de ADR de M4, NO APROBADA**) (p. ej. empotramiento en un nudo de cercha): se admite. El GDL toma el valor prescrito (0 o el `support-displacement`), que no produce esfuerzos. §2.5 no se aplica: la carga en ese GDL la absorbe el apoyo, con reacción `R_g = −(F_nodal,g + Σ_barras (Tᵀ·f*_eq)_g)`, de modo que se mantiene ΣR + ΣF = 0 (ADR-001 §5).
7. **Qué se devuelve en esos nudos** (aprobado en 2D; **en 3D: pendiente de ADR de M4, NO APROBADA**):
   - `displacements[n]` en un GDL eliminado no restringido: **0 por convención** (sin significado físico; nunca `NaN`, que no es JSON válido). En uno restringido: el valor prescrito.
   - `reactions[n]` en un GDL eliminado: si no está restringido, es GDL libre y vale **0** (ADR-001 §5; §2.5 garantiza que no hay carga desequilibrada); si está restringido, el valor de §2.6 (0 exacto cuando no hay carga en ese GDL, como en la cercha de §4).
   - **Contrato (aprobado, aditivo, opcional):** `SolveResult.indeterminateDofs?: Record<Id, number[]>`, índices `Dof6` (0…5) de los GDL eliminados **no restringidos** por nudo, en orden creciente; ausente si no hay ninguno. Los GDL restringidos no aparecen (su valor es el prescrito). **Alcance:** solo eliminaciones alineadas con ejes globales, es decir, todas las de 2D y las de 3D en que el subespacio eliminado esté generado por ejes globales. El giro publicado en `displacements` para esos GDL es 0 por convención. UI e informes deben mostrarlos como "indeterminado (nudo articulado)" en lugar de 0. Incorporado a `packages/solver/src/index.ts`.
   - **Desplazamientos de barra indeterminados.** Si una barra tiene en el extremo e el `ry_e` retenido (`ry_e ∉ R`) y su nudo tiene `ry` en `indeterminateDofs`, sus `u_R` (y los desplazamientos de estaciones o de una futura deformada) dependen del giro indeterminado del nudo y son también indeterminados. UI e informes los marcan igual que los de `indeterminateDofs` (la condición se deduce de las liberaciones y de `indeterminateDofs`, sin campo nuevo). Los esfuerzos de sección y `endForces` sí están determinados.
   - **Barras con mecanismo interno sin carga** (patrones de §1.3 admitidos por ortogonalidad): sus desplazamientos de extremo liberados son indeterminados aunque ningún GDL de nudo lo sea. Se comunican con un aviso en `message` (status `"ok"`) y la deformada se dibuja unida a los nudos por convención; UI e informes marcan esas barras como indeterminadas. Criterio y texto exacto: Anexo A.
   - **Reservado para M4 (sin implementar, aditivo):** `SolveResult.indeterminateRotations?: Record<Id, [number, number, number][]>`, base ortonormal (vectores unitarios globales) del subespacio de giros eliminado por nudo, para eliminaciones en base no global. El giro publicado en `displacements` es el de **norma mínima** (componente en el subespacio eliminado = 0). Solo documentado en el contrato; se define en el ADR de M4.
   - **Pendiente para el ADR de M4:** interacción de apoyos (que restringen giros en ejes globales) con un subespacio eliminado en base girada. M4 debe definirla como la proyección del subespacio restringido sobre span(T): la parte restringida que cae en el subespacio eliminado sigue §2.6; el resto se impone sobre los giros activos.

### 3. Mecanismo real y mal condicionamiento: detección y mensaje

1. Tras eliminar GDL restringidos y sin rigidez, `K_ff` debe ser simétrica definida positiva. Se factoriza con LDLᵀ (o Cholesky) propio sin pivotación, en el orden de numeración de GDL.
2. **Validación previa (antes de ensamblar):** E, A e I (en 2D, Iy; en 3D también Iz, J y G) finitos y > 0 en todos los materiales/secciones usados; si no → `invalid-model` con barra y propiedad (`Barra <id>: <propiedad> debe ser > 0`). Así un pivote negativo o nulo solo puede venir de un mecanismo o de redondeo.
3. **Criterio de pivote nulo (a):** en el paso k, la matriz se declara singular si `!(d_k > τ·K_kk)`, con `K_kk` la diagonal original de ese GDL y **τ = 1e-12**. La forma negada captura `NaN` (cualquier comparación con `NaN` es falsa) y trata como singular un pivote negativo.
4. **Aviso de mal condicionamiento (b):** si la factorización termina pero `min_k d_k/K_kk < 1e-8`, `status` sigue siendo `"ok"` y `message` lleva `Aviso: sistema mal condicionado en el nudo <id>, GDL <…> (pivote relativo <valor>; se pierden ≈ <n> cifras significativas)`, con n = log10(K_kk/d_k) redondeado.
5. **Control de integridad: residuo (c1).** Tras resolver, residuo relativo `‖K_ff·U_f − F_f‖ / (‖F_f‖ + ‖K_ff‖·‖U_f‖)` (normas ∞; ‖K_ff‖ = máxima suma de fila en valor absoluto). Si supera **1e-9** → `status: "singular"`. **No es un detector de condicionamiento:** una LDLᵀ que termina es retroestable y da un residuo de este tipo del orden del épsilon de máquina incluso con contrastes de rigidez extremos. Detecta `NaN`/`Infinity` (desbordamiento) y errores de implementación (ensamblaje, sustitución). `message: "Sistema singular o mal condicionado: residuo relativo <valor>; posible desbordamiento o error interno"`.
6. **Equilibrio global (c2).** Con las cargas nodales y las equivalentes de barra (`Σ Tᵀ·f*_eq`, incluidas las absorbidas por GDL eliminados restringidos, §2.6) y las reacciones:
   - Fuerzas: `e_F = ‖ΣR + ΣF‖∞ / (Σ‖R‖∞ + Σ‖F‖∞)`.
   - Momentos **respecto al centroide r_c de los nudos del modelo** (media de sus coordenadas), no respecto al origen global: con coordenadas tipo UTM (~1e5–1e6 m) los brazos respecto al origen provocan cancelación y falsos desequilibrios. `e_M = ‖Σ(r_k − r_c)×(R_k + F_k) + Σ(M_R + M_F)‖∞ / D_M`, con `D_M = Σ‖(r_k − r_c)×F_k‖∞ + Σ‖M_k‖∞` sumando cargas y reacciones; si `D_M = 0` se usa `L_ref·Σ‖F_k‖∞`, con L_ref la mayor dimensión del recuadro envolvente de los nudos.
   - Umbrales (decisión (ii)), con `e = max(e_F, e_M)`: **e > 1e-6** → `status: "singular"`, `message: "Sistema singular o mal condicionado: desequilibrio relativo <valor>; revise rigideces muy dispares (EA o EI enormes) y liberaciones"`; **1e-9 < e ≤ 1e-6** → `status: "ok"` con `message` `Aviso: desequilibrio global relativo <valor>; revise rigideces muy dispares (EA o EI enormes)`; e ≤ 1e-9 → sin aviso.
   - Error de equilibrio relativo medido por el Revisor de ingeniería en el pórtico de §3.7:

     | EA (kN) | error de equilibrio relativo |
     |---|---|
     | 2e6 | 2e-16 |
     | 1e9 | 5e-13 |
     | 1e12 | 2.5e-10 |
     | 1e17 | 7e-5 |

     El equilibrio sí refleja la pérdida de cifras: con EA = 1e12 queda sin aviso, con EA = 1e17 se declara `"singular"`. La banda de aviso cubre contrastes intermedios.
   - Si varios avisos coinciden (§3.4, §3.6) se concatenan en `message` separados por `; `.
7. **Por qué τ solo no basta.** Medido por el Revisor de ingeniería, relación mínima legítima `d_k/K_kk` en un pórtico 4×6 m con EI = 2e4 kN·m² al variar EA:

   | EA (kN) | min d_k/K_kk |
   |---|---|
   | 2e6 | 1.7e-2 |
   | 1e12 | 3.5e-8 |
   | 1e15 | 3.5e-11 |
   | 1e17 | 3.5e-13 |

   Con contrastes de rigidez > 1e12 la relación legítima cae por debajo de τ (falso `"singular"`) o se acerca tanto que la solución pierde la mayoría de sus cifras sin que τ lo detecte; en un mecanismo la relación es del orden del épsilon de máquina (~1e-16). Por eso se combinan (a) τ, (b) el aviso, (c1) el control de integridad, (c2) el equilibrio global y (d) la validación previa.
8. **Uniones rígidas (e).** Las uniones rígidas o barras "infinitamente rígidas" **no se modelan con EA o EI enormes**: destruyen el condicionamiento (tablas anteriores). Si hacen falta, se tratarán con un mecanismo específico (restricciones/offsets rígidos) en un ADR futuro. La UI debe advertirlo y el `message` de (b) y (c2) lo sugiere. El pórtico del banco (A = 5000 m²) está dentro del rango sano (ver README de verificación).
9. **Mensaje útil en `"singular"` por pivote:** `message` con:
   - el GDL donde se detectó el pivote: `Mecanismo detectado en el nudo <id>, GDL <ux|uz|ry> (pivote relativo <valor>)`;
   - el **modo de mecanismo**: se obtiene fijando ese GDL a 1, los posteriores a 0 y resolviendo hacia atrás con el factor ya calculado. Para el umbral de participación, traslaciones y giros se normalizan **por separado** (máximo de |traslación| y máximo de |giro|; equivalente a escalar los giros por una longitud característica, L_max). Se listan los nudos/GDL con participación ≥ 1e-3 del máximo de su grupo (p. ej. `modo: A.ux, B.ux, C.ux`), con un máximo de 10 entradas y "…" si hay más;
   - sugerencia genérica: `revise apoyos y liberaciones`.
   - En todo `"singular"` (pivote, c1 o c2): `displacements`, `reactions` y `members` vacíos (`{}`, `{}`, `[]`).
10. Los GDL sin rigidez benignos (§2) nunca llegan a la factorización, así que un pivote nulo **siempre** indica mecanismo real o mal condicionamiento extremo; no hay tolerancia que decida entre "benigno" y "mecanismo" (en 2D; en 3D, ver el riesgo de §2.3). Son singulares legítimos, entre otros, los modos de energía nula repartidos entre nudos que no elimina §2 (p. ej. θ_i = θ_j con barras de deslizaderas en ambos extremos, si se admitieran: §1.4). No llegan a §3, en cambio, los giros rígidos de barras alrededor de un nudo con GDL eliminado (§2.5, último punto): se aceptan como indeterminados.

### 4. Ejemplo numérico mínimo: cercha triangular

Mismo caso que `tests/verification/cases/cercha-triangular.test.ts`. `analysis: "2D-XZ"`. Nudos A(0,0,0), B(8,0,0), C(4,0,3). Apoyos: A articulado (ux, uz), B rodillo (uz). Barras AB (A→B), AC (A→C), BC (B→C), todas con `ry` liberado en ambos extremos. E = 2.1e8 kN/m², A = 0.004 m² → EA = 840 000 kN. Carga nodal en C: f = [0, 0, −60] kN.

Geometría: |AC| = |BC| = 5 m; AC: (cos, sin) = (0.8, 0.6); BC (B→C): (−0.8, 0.6).

1. **Condensación (§1).** Cada barra libera {ry_i, ry_j} (pareja con `k_RR` regular). |R ∩ bloque x–z| = 2 → el bloque de flexión condensado es nulo y se escribe con ceros exactos (§1.5); solo queda el axil EA/L: AB 105 000 kN/m, AC y BC 168 000 kN/m.
2. **Eliminación (§2).** En A, B y C ningún extremo transmite My → `ry` sin rigidez en los tres nudos. GDL activos 2D: 9; restringidos por apoyos: A.ux, A.uz, B.uz; eliminados: A.ry, B.ry, C.ry. Sin la eliminación quedarían 6 libres con 3 filas nulas (rango 3: singular). Con ella quedan 3: [B.ux, C.ux, C.uz].
3. **Sistema** (rigidez de barra k·[c², cs; cs, s²] en globales):

   ```
   K = | 105000+107520   -107520             +80640        |   | 212520  -107520   80640 |
       | -107520          107520+107520       80640-80640   | = | -107520  215040       0 |
       | +80640           0                   60480+60480   |   |  80640        0  120960 |
   F = [0, 0, −60]
   ```
   (B.ux–C acopla solo por BC: −k·[c², cs] = −168000·[0.64, −0.48].)
   LDLᵀ: pivotes 212 520; 160 642.53; 80 000 → relaciones d_k/K_kk = 1; 0.747; 0.661, muy por encima de τ.
4. **Solución:** B.ux = 8/21 000 = **3.8095238e-4 m**; C.ux = **1.9047619e-4 m**; C.uz = **−7.5e-4 m**.
   Comprobación fila 3: 80 640·3.8095238e-4 + 120 960·(−7.5e-4) = 30.72 − 90.72 = −60 ✓.
   Comprobación por trabajo virtual: P·|C.uz| = 60·7.5e-4 = 0.045 = Σ N²l/(EA) = (40²·8 + 2·50²·5)/840 000 = 37 800/840 000 ✓.
5. **Esfuerzos (método de los nudos):** N_AB = +40 kN (tracción), N_AC = N_BC = −50 kN (compresión); Vz = My = 0 en todas las estaciones.
   `endForces`: AB i = [−40, 0, 0, 0, 0, 0], j = [+40, 0, 0, 0, 0, 0]; AC y BC i = [+50, 0, 0, 0, 0, 0], j = [−50, 0, 0, 0, 0, 0] (ADR-001 §6.2: N(0) = −Fx_i, N(L) = +Fx_j).
6. **Reacciones:** A = [0, 0, +30, 0, **0**, 0], B = [0, 0, +30, 0, **0**, 0] (índice 4 = 0 exacto por §2.7).
7. **Giros:** `displacements` A, B, C con ry = 0 por convención; `indeterminateDofs = { A: [4], B: [4], C: [4] }`. Status `"ok"`. Ninguna barra retiene `ry` en sus extremos, así que sus `u_R` (giros de extremo de cuerda) están determinados.

**Contraejemplos:**

- Mecanismo real: si A fuera también rodillo (solo uz), la traslación horizontal no tiene rigidez. B.ux, C.ux, C.uz y A.ux quedan libres; el pivote de un GDL horizontal cae a ~1e-16·K_kk → `"singular"`, `message: "Mecanismo detectado en el nudo …, GDL ux (pivote relativo …); modo: A.ux, B.ux, C.ux; revise apoyos y liberaciones"`.
- Carga nodal no equilibrable: un momento nodal m = [0, 5, 0] en C → `"invalid-model"`, `"Nudo C: momento aplicado en ry pero ninguna barra transmite momento a ese nudo (todas articuladas)"`.
- **Carga de barra no equilibrable (momento perdido, §2.5), con signos explícitos.** A la cercha se añade el nudo D(7, 0, 3) con apoyo articulado (ux, uz) y la barra DC (i = D, j = C, L = 3 m) con liberaciones {uz_i, ry_i} y carga uniforme vertical de 10 kN/m hacia −Z. Ejes locales (ADR-001 §3): x local = −X, z local = +Z, y local = z × x = −Y. Carga local `wz = −10` kN/m. La pareja {uz_i, ry_i} anula el bloque de flexión condensado (§1.5), así que C.ry sigue eliminado; la barra condensada es un voladizo empotrado en j: `f*_emp,j` con `Fz_j = +30` kN y **`My_j = +45` kN·m (local)**. Residuo: `f*_eq,j = −f*_emp,j` tiene `My = −45` alrededor de y local = −Y, luego **r(C.ry) = +45 kN·m (alrededor de +Y global)** ≠ 0 → `"invalid-model"`, `"Barra DC: su carga produce un momento 45 kN·m en el extremo j (nudo C, GDL ry) que ninguna barra transmite (nudo articulado); revise liberaciones"`. (Físicamente la barra gira libremente alrededor de C.) Sin §2.5 ese momento se descartaría en silencio y el equilibrio global fallaría en 45 kN·m. Es un buen test del aviso de ADR-001 §3: `My` local y momento global alrededor de Y tienen aquí signos opuestos, y un consumidor que los confunda obtiene el signo equivocado.
- Apoyo que restringe el GDL eliminado (§2.6): si en el caso anterior C tuviera además un apoyo que restringe ry (índice 4), el modelo es válido y la reacción es **`reactions.C[4] = −45` kN·m**, cumpliendo ΣR + ΣF = 0; C no aparece en `indeterminateDofs`.
- No es mecanismo: si C tuviera además una barra continua (sin liberaciones) a un apoyo empotrado, C.ry tiene rigidez y no se elimina.

## Consecuencias

- El caso "cercha triangular" del banco pasa con `status: "ok"` sin estabilización; los giros no se comparan (son indeterminados) y las reacciones en índice 4 deben ser 0 exacto.
- El dueño del solver añade tests de: todos los contraejemplos de §4 (incluidos el momento perdido de la barra DC con r(C.ry) = +45 y el apoyo en ry en C con reacción −45), cada patrón de §1.3 con carga ortogonal (admitido) y no ortogonal (`invalid-model`), el ejemplo del Revisor de §1.3 (`endForces.j[2] = −P_z`), el rechazo de {uz_i, uz_j} (§1.4), la empotrada-apoyada con los signos de §1.2 (ry liberado en j y en i), filas de K exactamente nulas en GDL eliminados (§1.5), `u_R` de norma mínima escalada (§1.2), la validación previa de E, A, I (§3.2), un `NaN` en la diagonal (§3.3), el aviso de mal condicionamiento (§3.4), el control de integridad (§3.5) y el equilibrio global respecto al centroide con coordenadas grandes (§3.6), incluyendo la banda de aviso.
- QA incorpora esos mismos casos al banco de verificación (V3) y, para M4, la cercha espacial con `ry`, `rz` liberados (V6).
- `report` y `apps/web` muestran los giros de `indeterminateDofs` y los desplazamientos de barra indeterminados (§2.7) como indeterminados (M2/M5) y advierten contra EA/EI enormes como uniones rígidas.
- Contrato: campo opcional `indeterminateDofs` añadido a `SolveResult` (aditivo, no rompe consumidores). `indeterminateRotations` solo queda reservado (documentado, sin tipo).

## Alternativas consideradas

- **Alternativa A para mecanismos internos (rechazar axil/flexión siempre; admitir torsión sin torsor):** descartada por asimétrica (una barra con {ux_i, ux_j} liberados y sin carga axil es tan benigna como la de torsión liberada sin torsor, pero se rechazaba). Se adopta B, salvo la excepción de §1.4.
- **Admitir {uz_i, uz_j} con su `k*` no nulo:** diferido; introduce un modo θ_i = θ_j repartido entre nudos que el criterio combinatorio de §2 no elimina y que solo §3 detectaría.
- **Muelle rotacional pequeño / penalización ε en la diagonal:** descartada (prohibida por el encargo): altera resultados, depende de la escala del modelo y puede enmascarar mecanismos reales.
- **Solo condensación:** insuficiente, deja filas nulas en nudos de cercha.
- **Solo eliminación de GDL de giro con diagonal nula detectada numéricamente:** descartada; decidir "benigno" con una tolerancia numérica confunde GDL sin rigidez con mecanismos. El criterio de §1.6/§2 es combinatorio (2D) o geométrico (3D), nunca sobre la matriz factorizada.
- **Duplicar nudos en cada rótula (GDL de giro por barra):** más GDL y el mismo problema en el nudo; descartada.
- **Tipo de barra "cercha" en el modelo:** cambiaría el esquema v1 de `model`; las liberaciones ya expresan lo mismo. Puede reconsiderarse como azúcar de UI que genere las liberaciones.
- **Devolver `NaN` o `null` en giros indeterminados:** `NaN` no es JSON y `null` rompe el tipo `Dof6`; se usa 0 + `indeterminateDofs`.
- **Devolver `singular` en la cercha y exigir al usuario restringir giros:** descartada; es mala experiencia y contradice la práctica habitual.
- **Solo τ como criterio de singularidad:** descartada por la tabla de §3.7.
- **Equilibrio global con umbral único 1e-9 → `singular`:** descartada; declararía singulares modelos con contrastes de rigidez moderados cuyo resultado sigue siendo útil. Se usa la banda de aviso de §3.6.
- **Momentos de equilibrio respecto al origen global:** descartada por cancelación con coordenadas grandes.

## Decisiones del propietario (delegadas, 2026-10-30)

1. **Tratamiento 2D (§1, §2.1–2.2, §2.4–2.7, §3, §4): aprobado.**
2. **`indeterminateDofs?: Record<Id, number[]>` en `@edscar/solver`: aprobado** (aditivo, solo eliminaciones alineadas con ejes globales, sin GDL restringidos). `indeterminateRotations?` reservado solo como documentación (M4).
3. **Mecanismos internos de barra: alternativa B**, con la excepción (i): en v1, R ∩ bloque = {uz_i, uz_j} o {uy_i, uy_j} → `invalid-model` nombrando la barra (§1.4). El modo θ_i = θ_j queda documentado como singular legítimo de §3. Los demás patrones de B admitidos tienen bloque condensado nulo.
4. **Tolerancias:** τ = 1e-12 (pivote); 1e-8 (aviso de pivote); residuo 1e-9 → `singular` como control de integridad (§3.5); equilibrio global > 1e-6 → `singular`, entre 1e-9 y 1e-6 → aviso con `"ok"` (decisión (ii), §3.6); 1e-9 en carga en GDL eliminado (§2.5) y ortogonalidad (§1.3). Revisables por el Revisor de ingeniería con justificación documentada en este ADR.
5. **Uniones rígidas:** desaconsejar EA o EI enormes en UI y documentación; ADR de restricciones rígidas cuando haya demanda (no antes de M4).
6. **3D (§2.3, §2.6–2.7 en 3D, `indeterminateRotations`, apoyos en base girada):** diferido al ADR de M4, que elegirá entre las opciones (a) y (b) de §2.3 con el test de cercha espacial de V6 como criterio de aceptación.

## Anexo A (revisión 4): deformada de barras con mecanismo interno sin carga

Aclaración de implementación de §1.2, §1.3 y §2.7, aprobada por el Revisor de ingeniería con el solver 2D (M1). No cambia el contrato: usa `message` y `SolveResult.deflections?` (ADR-006).

1. **Problema.** En una barra admitida con un patrón de §1.3 cuyo `k_RR` tiene núcleo (mecanismo interno sin carga que lo active), `u_R` es indeterminado: cualquier `u_R + N·c` (N = base del núcleo) es solución. La norma mínima absoluta de §1.2 toma la componente de núcleo nula, lo que en la deformada **separa** el extremo liberado de su nudo (p. ej. una biela con las cuatro liberaciones de flexión se dibujaría en su posición inicial aunque los nudos se hayan movido).
2. **Dos recuperaciones.**
   - `Condensed.recover` (norma mínima escalada, §1.2): **la que se usa para estaciones y esfuerzos.** Sin cambios.
   - `Condensed.recoverAttached`: **solo para la deformada.** Parte de la misma familia de soluciones y elige dentro del núcleo la componente c que minimiza el salto de traslaciones `Σ (u_R,k − u_nodal,k)²` sobre las **traslaciones liberadas** del bloque (u_nodal en ejes locales de la barra). Los **giros liberados no entran** en el criterio: su salto es la rótula, físicamente legítimo.
   - **Unicidad.** En todos los patrones con núcleo admitidos, el núcleo restringido a las traslaciones liberadas es inyectivo (traslación rígida ⇒ uz_i, uz_j ∈ R; giro alrededor de i ⇒ uz_j ∈ R; giro alrededor de j ⇒ uz_i ∈ R; axil ⇒ ux_i, ux_j ∈ R), así que el mínimo es único. En bloques sin núcleo `recoverAttached` coincide exactamente con `recover`.
3. **Es una convención.** El solver devuelve `status: "ok"` y, por cada bloque con núcleo de cada barra, añade a `message` (tras los demás avisos de §3, concatenados con `; `) el texto exacto:

   `Aviso: Barra <id>: mecanismo interno sin carga que lo active (<bloque>: <liberaciones>); sus desplazamientos de extremo liberados son indeterminados y la deformada se dibuja unida a los nudos por convención`

   con `<bloque>` el nombre del bloque (p. ej. `flexión x–z`) y `<liberaciones>` la lista de componentes liberadas del bloque separadas por `, ` (p. ej. `uz_i, ry_i, uz_j, ry_j`). **La UI y los informes deben marcar esas barras como indeterminadas** (deformada y desplazamientos de extremo liberados), igual que los GDL de `indeterminateDofs`. Esfuerzos y `endForces` sí están determinados.
4. **Ejemplo (test del solver "biela interna con las cuatro liberaciones de flexión").** `"2D-XZ"`, nudos sobre el eje X: A(0), B(3), C(5), D(8); A y D empotrados; AB y CD continuas; BC con {uz_i, ry_i, uz_j, ry_j} liberados (solo transmite axil); carga nodal P = −10 kN (Z) en B.
   - AB es una ménsula con P en la punta: **uz_B = PL³/(3EI) = −90/EI**, **ry_B = −w'(L) = −PL²/(2EI) = +45/EI**; reacciones en A: Fz = +10 kN, My = −30 kN·m. CD sin carga ⇒ C fijo. `indeterminateDofs` ausente.
   - BC: **esfuerzos y `endForces` nulos**. Núcleo de dimensión 2 (traslación y giro rígido), sin componentes retenidas en flexión. `recover` daría u_R = 0 (extremo i separado de B); `recoverAttached` anula los dos saltos de traslación: uz_i = uz_B, uz_j = uz_C = 0, de modo que la deformada de BC (x local desde B, L = 2 m) es **w(x) = uz_B·(1 − x/2)**, u = 0. Su giro de cuerda es −w' = uz_B/2 = −45/EI, distinto de ry_B = +45/EI: la diferencia es la rótula en B.
   - `message`: `Aviso: Barra BC: mecanismo interno sin carga que lo active (flexión x–z: uz_i, ry_i, uz_j, ry_j); sus desplazamientos de extremo liberados son indeterminados y la deformada se dibuja unida a los nudos por convención`.

## Anexo B (revisión 4): cargas distribuidas diminutas y recorte de trapecios

Aclaración de implementación del ensamblaje de cargas de barra en el solver 2D, aprobada por el Revisor de ingeniería (M1).

1. **Recorte de trapecios.** `validateProject` (`@edscar/model`) admite tramos `[a, b]` con `a ≥ −1e-9`, `a < b` y `b ≤ L + 1e-9`. El solver recorta el tramo a `[0, L]` y **reinterpola los valores de extremo sobre la ley lineal original** (w(s) = w1 + (w2 − w1)·(s − a0)/(b0 − a0)), en lugar de conservar w1 y w2 en los nuevos extremos: así un trapecio que sobresale no cambia de pendiente. Luego se transforma a ejes locales (si es `global`). Un tramo con intensidad nula en ambos extremos se ignora.
2. **Tramos diminutos.** Si el tramo resultante tiene longitud `b − a ≤ 1e-9·L` (también el que queda tras recortar), su interpolación lineal y la malla de estaciones no lo resuelven, pero su resultante puede no ser despreciable (p. ej. 1e8 kN/m sobre 2e-9 m = 0.2 kN). Se sustituye por una **fuerza puntual equivalente en el punto medio** `(a + b)/2`, de componentes locales `p = ((w(a) + w(b))/2)·(b − a)`: la **resultante es exacta**; el error de posición es ≤ 0.5e-9·L y el par residual respecto al centroide del trapecio es ≤ |Δw|·len²/12, despreciable. Si el tramo recortado tiene longitud 0 (p. ej. a = L, b = L + 5e-10) no aporta carga y no produce `NaN`.
3. Tests: `packages/solver/src/solve2d.test.ts` (carga uniforme con a = L y b = L + 5e-10; trapecio que sobresale del extremo de una ménsula).
