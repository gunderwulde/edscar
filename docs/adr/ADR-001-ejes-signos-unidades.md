# ADR-001: Ejes, signos y unidades

- Estado: Aceptado
- Fecha: 2026-10-30 (rev. 3: precisiones no bloqueantes del Revisor de ingeniería incorporadas al aceptar)
- Autor: Arquitecto
- Aprobado por: propietario (convención de ejes y signos: Z arriba; presentación V = −Vz, M = −My). Revisado y aprobado por: Revisor de ingeniería
- Paquetes afectados: todos (`model`, `loads`, `codes`, `solver`, `io`, `report`, `ui-state`, `apps/web`)

## Contexto

Solver, cargas, importadores/exportadores (SAF, s2k, OpenSees), informes y UI deben coincidir en ejes, signos y unidades. Un error de convención es silencioso y caro. Se fija una única convención interna; cualquier otra se convierte solo en los bordes (`io`, UI).

## Decisión

### 1. Unidades (SI coherente)

| Magnitud | Unidad interna |
|---|---|
| Longitud, coordenadas, desplazamientos | m |
| Giros, ángulos (`rotation`) | rad (la UI puede mostrar grados) |
| Fuerza | kN |
| Momento | kN·m |
| Tensión, módulos (E, G) | kN/m² (acero: E = 210e6 kN/m²) |
| Área de sección `A` | m² |
| Inercias `Iy`, `Iz`, torsión `J` | m⁴ |
| Carga lineal / superficial | kN/m, kN/m² |
| Densidad | t/m³ (coherente con kN, m y g en m/s²: peso = densidad·g en kN/m³) |
| Temperatura, variación `dT` | °C |
| Gradiente térmico `gradientZ`, `gradientY` | °C/m |
| Coeficiente de dilatación `alpha` | 1/°C |
| Gravedad por defecto | `[0, 0, -9.81]` m/s² |

La conversión a otras unidades ocurre solo en UI e `io`.

### 2. Ejes globales

Sistema **derecho** X, Y, Z con **Z vertical hacia arriba**; la gravedad actúa en −Z.

**Desviación respecto a la especificación.** La sección 8 ("Reglas de coordinación", regla 3) de `EDITOR_CARGAS_ESTRUCTURAS.md` proponía "Y arriba en 2D". Este ADR se aparta de esa propuesta: los modelos 2D viven en el plano **X–Z con Z arriba**, igual que en 3D, para que un modelo 2D sea un caso particular del 3D sin cambiar de ejes ni de signos. La especificación se actualiza para remitir a este ADR.

#### 2.1 Tipo de análisis (`Project.analysis`)

- `"3D"`: 6 GDL por nudo.
- `"2D-XZ"`: GDL activos ux, uz, ry; el solver restringe internamente uy, rx, rz. Validaciones (si fallan, `status = "invalid-model"`):
  - Todos los nudos con `y = 0` (tolerancia absoluta 1e-9 m).
  - `Member.rotation` ∈ {0, π} (módulo 2π, tolerancia 1e-9 rad). Con ello el eje local `y` de toda barra es ±Y global y la flexión en el plano ocurre siempre alrededor de `y` local (resistida con `Iy`).
  - Se rechazan cargas con componentes fuera del plano: nodales con `f[1] ≠ 0`, `m[0] ≠ 0` o `m[2] ≠ 0`; de barra con componente Y global ≠ 0 (`frame: "global"`) o `wy`/`py` local ≠ 0 (`frame: "local"`); momentos puntuales de barra (`member-point.m`) con `m[0] ≠ 0` o `m[2] ≠ 0` si `frame: "global"` (solo se admite giro alrededor de Y global), o con `mx ≠ 0` o `mz ≠ 0` si `frame: "local"` (solo se admite `my`); térmicas con `gradientY ≠ 0`; `support-displacement` con `d[1]`, `d[3]` o `d[5]` ≠ 0.
  - Peso propio: si algún patrón del caso tiene `selfWeightFactor ≠ 0` y `settings.gravity[1] ≠ 0`, el modelo es `invalid-model` (el peso propio tendría componente fuera del plano).
  - Las liberaciones fuera del plano (`uy`, `rx`, `rz`) se ignoran; `Iz` y `J` no intervienen.
  - Reacciones: en todo nudo apoyado, `reactions` vale **0** en `uy`, `rx` y `rz` (índices 1, 3, 5), aunque el solver restrinja esos GDL internamente. La restricción interna de 2D no es un apoyo: no genera reacción ni cuenta como GDL restringido a efectos de `support-displacement`.

#### 2.2 Apoyos (`Support`)

Cada nudo admite **como máximo un** `Support`. Dos o más `Support` sobre el mismo nudo son `invalid-model` (se evita la ambigüedad de combinar indicadores y de repartir la reacción entre ellos). La reacción se publica por nudo en `reactions[nudo]`.

### 3. Ejes locales de barra

- `x` local: del nudo `i` al nudo `j`.
- `z` local de referencia: proyección de Z global sobre el plano perpendicular a `x` (normalizada). Si la barra es vertical (|x·Z| > 1 − 1e-9), se toma `z` = +X global.
- `y = z × x` (terna derecha x, y, z). Barra horizontal con x = +X: y = +Y, z = +Z. Barra vertical con x = +Z: z = +X, y = −Y.
- `Member.rotation` (rad): giro de la sección alrededor de `x` local, positivo por la regla de la mano derecha respecto a +x (de y hacia z), aplicado sobre los ejes de referencia.
- `Iy`: inercia respecto al eje local y (flexión en el plano x–z, cortante Vz). `Iz`: inercia respecto a z (flexión en el plano x–y, cortante Vy). `J`: torsión.

**Aviso: salto de 180° en barras casi verticales.** La regla de referencia es discontinua en el umbral de verticalidad. Ejemplo con un pilar en el plano X–Z:
- Pilar exactamente vertical, x = +Z: z = +X, **y = −Y**.
- Pilar inclinado un ángulo δ hacia +X, x = (sin δ, 0, cos δ), con δ mayor que ≈ 4.5e-5 rad (es decir, 1 − cos δ > 1e-9): la proyección de Z da z ≈ −X y **y ≈ +Y**.

Es decir, un pilar perfectamente vertical y otro casi vertical tienen `y`, `z` locales opuestos, y por tanto `My` local de signo opuesto para el mismo estado físico. Además, en un pórtico 2D la viga horizontal (y = +Y) y el pilar vertical (y = −Y) tienen ejes `y` locales opuestos. Consecuencia vinculante: **la UI, los informes e `io` no deben asumir que un `My` local equivale a un momento global alrededor de Y**; toda conversión local↔global se hace con la terna local de cada barra (expuesta por un único helper compartido), nunca por comparación de nombres de eje.

#### 3.1 Liberaciones de extremo (`EndRelease`)

Se declaran en **ejes locales** de la barra. Cada indicador libera la componente correspondiente de la fuerza de extremo (§6.2), que deja de transmitirse entre nudo y barra:

| Indicador | Componente liberada | Esfuerzo asociado |
|---|---|---|
| `ux` | Fx | N |
| `uy` | Fy | Vy |
| `uz` | Fz | Vz |
| `rx` | Mx | T |
| `ry` | My | My |
| `rz` | Mz | Mz |

### 4. Grados de libertad

Por nudo: `[ux, uy, uz, rx, ry, rz]` en ejes globales (tipo `Dof6`, índices 0…5); giros positivos por la regla de la mano derecha. Por barra: 12 GDL (los 6 de `i` y luego los 6 de `j`).

Giros en ejes locales de la barra (Euler-Bernoulli), con u_y, u_z desplazamientos transversales locales:

- **θy = −duz/dx** (un giro positivo alrededor de +y lleva +x hacia −z).
- **θz = +duy/dx** (un giro positivo alrededor de +z lleva +x hacia +y).

### 5. Signos de acciones, reacciones y desplazamientos

- Cargas nodales `f` (kN), `m` (kN·m): positivas en el sentido de los ejes globales (m por mano derecha).
- Cargas de barra: `frame: "local"` → componentes `[wx, wy, wz]` en ejes locales; `"global"` → en ejes globales. **En ambos marcos la carga distribuida es por unidad de longitud real de la barra, no proyectada** (una carga de nieve dada por m² de proyección horizontal debe convertirla `loads` antes de crear la carga). El peso propio actúa según `gravity`.
- Posición en barra:
  - `member-uniform` y `member-trapezoid`: `a`, `b` son **abscisas absolutas en m desde el nudo i** a lo largo de la barra, 0 ≤ a < b ≤ L. En la uniforme, por defecto a = 0, b = L. En la trapezoidal, `w1` actúa en x = a y `w2` en x = b, con variación lineal.
  - `member-point`: `at` es fracción de L en [0, 1] si `relative = true`, o m desde el nudo i si `relative = false`.
- `support-displacement`: `d` es un `Dof6` en **ejes globales**, m y rad, orden [ux, uy, uz, rx, ry, rz]. Solo se aplica en GDL restringidos por un apoyo del nudo; un valor no nulo en un GDL libre es `invalid-model`.
- Reacciones (`reactions[nudo]`, `Dof6`): fuerza/momento que el apoyo ejerce **sobre la estructura**, en ejes globales (índices 0–2 fuerzas en kN, 3–5 momentos alrededor de X, Y, Z en kN·m). Una viga cargada hacia −Z tiene reacciones +Z.
  - La reacción **no incluye la carga nodal aplicada en el propio nudo apoyado**: es solo la acción del apoyo. Equilibrio global: Σ reacciones + Σ cargas aplicadas (incluidas las de nudos apoyados) = 0.
  - En GDL **libres** la reacción vale **0**. Los nudos sin apoyo no aparecen en `reactions`.
- Desplazamientos y giros: positivos según los ejes globales.

#### 5.1 Temperatura

- `dT` (°C): variación uniforme en el centro de gravedad; `dT > 0` es calentamiento (alargamiento libre α·dT).
- `gradientZ` (°C/m) = ∂T/∂z local; `> 0` significa fibra +z más caliente que −z.
- Origen del canto h. EN 1991-1-5 da la componente lineal de la variación de temperatura como diferencia ΔT (°C) entre caras (`unverified: true`: artículo y edición pendientes de verificación). Para convertirla a °C/m, `gradientZ = ΔT/h_z` (análogo `gradientY = ΔT/h_y`), donde h es el canto en la dirección del gradiente. `Section` **no** guarda el canto: h lo introduce el usuario en la UI al definir la acción térmica, o lo resuelve `loads` a partir de sus propios datos; el solver solo recibe °C/m. Si en el futuro se necesita geometría opcional en `Section` (canto, ancho), se decidirá en un ADR nuevo.
- La componente no lineal de EN 1991-1-5 (ΔT_E, tensiones autoequilibradas) **no se modela en v1**.
- `gradientY` (°C/m) = ∂T/∂y local; `> 0` significa fibra +y más caliente. Existe en 3D; en `"2D-XZ"` debe ser 0 o ausente.
- Relaciones constitutivas (valores crudos de §6):
  - `N = E·A·(du/dx − α·dT)`
  - `My = E·Iy·(dθy/dx − α·gradientZ)`, con dθy/dx = −d²uz/dx²
  - `Mz = E·Iz·(dθz/dx + α·gradientY)`, con dθz/dx = +d²uy/dx²
- Consecuencia: en una barra biempotrada, `gradientZ > 0` (+z más caliente) produce `My = −E·Iy·α·gradientZ < 0` (compresión en la fibra +z), es decir **M de presentación positivo** (§7, tracción en −z). Análogamente, `gradientY > 0` produce `Mz = +E·Iz·α·gradientY > 0`.

### 6. Esfuerzos internos (valores del solver, ejes locales)

#### 6.1 Esfuerzos de sección (`SectionForces`)

Se define sobre una sección de abscisa `x` la **cara positiva**: la cara del tramo del lado `i` cuya normal exterior es +x (sobre ella actúa el tramo del lado `j`). Un esfuerzo es positivo si su vector (fuerza, o momento por mano derecha) apunta en el sentido positivo del eje local correspondiente sobre esa cara. Sobre la cara negativa (normal exterior −x) el mismo esfuerzo positivo apunta en sentido contrario.

- `N`: positivo = **tracción**.
- `Vy`, `Vz`, `T`, `My`, `Mz`: positivos hacia +y, +z, +x, +y, +z locales sobre la cara positiva.
- Relaciones de equilibrio (sin momentos distribuidos): `dN/dx = −wx`, `dVz/dx = −wz`, `dVy/dx = −wy`, `dMy/dx = Vz`, `dMz/dx = −Vy`.
- Fibras: `σx = My·z/Iy` (My > 0 tracciona la fibra +z) y `σx = −Mz·y/Iz` (Mz > 0 tracciona la fibra −y).

**Estaciones (`stations`).** Ordenadas por `x` no decreciente, incluyendo x = 0 y x = L. En una discontinuidad (carga o momento puntual, extremos de carga parcial) se emiten **dos estaciones con la misma `x`**: primero la del límite izquierdo (`side: "left"`, x⁻) y después la del derecho (`side: "right"`, x⁺). `side` se omite en estaciones sin duplicado.

#### 6.2 Fuerzas de extremo de barra (`MemberEndForces`)

`endForces.i` y `endForces.j` son las fuerzas y momentos que **el nudo ejerce sobre la barra**, en **ejes locales**, orden **[Fx, Fy, Fz, Mx, My, Mz]** (kN, kN·m), positivas según los ejes locales (momentos por mano derecha). Es el vector que resulta de `k_local·u_local + fuerzas de empotramiento perfecto`, con las liberaciones aplicadas.

**Fuerzas de empotramiento perfecto** (definición): fuerzas y momentos que el nudo ejerce sobre la barra, en ejes locales, cuando sus dos extremos están fijos (u = 0) y actúan las cargas de barra, **incluidas las térmicas** (`dT`, `gradientZ`, `gradientY`). Equivalen a las **cargas nodales equivalentes con el signo cambiado**: `f_emp = −f_eq`, y en el ensamblaje `K·U = F_nodal + Σ Tᵀ·f_eq`.

Relación con los esfuerzos de sección (equilibrio de un trozo infinitesimal en cada extremo):

- Extremo i (x = 0): `N(0) = −Fx_i`, `Vy(0) = −Fy_i`, `Vz(0) = −Fz_i`, `T(0) = −Mx_i`, `My(0) = −My_i`, `Mz(0) = −Mz_i`.
- Extremo j (x = L): `N(L) = +Fx_j`, `Vy(L) = +Fy_j`, `Vz(L) = +Fz_j`, `T(L) = +Mx_j`, `My(L) = +My_j`, `Mz(L) = +Mz_j`.

Ejemplo con E1 (más abajo): `endForces.i = [0, 0, +30, 0, 0, 0]` (el apoyo empuja la barra hacia +z local) mientras que `Vz(0⁺) = −30`; `endForces.j = [0, 0, +30, 0, 0, 0]` y `Vz(6⁻) = +30`.

**Momentos de empotramiento perfecto (referencia de signo).** Barra biempotrada de longitud L con carga uniforme local `wz = −w` (w > 0, hacia −z): fuerzas de extremo locales `Fz_i = Fz_j = +wL/2`, **`My_i = −wL²/12`**, **`My_j = +wL²/12`**. En esfuerzos de sección: `My(0) = My(L) = +wL²/12` (presentación `M = −wL²/12`, tracción superior en los extremos) y `My(L/2) = −wL²/24` (presentación `M = +wL²/24`).

### 7. Convención de diagramas (presentación en UI e informes)

Se aplica en un único punto compartido, para no mezclar signos:

- `N`: tracción positiva. Ordenada positiva dibujada hacia **+z local** en el plano x–z y hacia **+y local** en el plano x–y; compresión al lado contrario.
- `V`:
  - Plano x–z: `V = −Vz`. Es positivo cuando, **sobre la cara negativa (normal exterior −x) de un elemento, la fuerza apunta hacia +z local**.
  - Plano x–y: `V = −Vy`. Es positivo cuando, sobre la cara negativa de un elemento, la fuerza apunta hacia +y local.
  - Ordenada positiva dibujada del mismo lado que `N`: hacia +z local (plano x–z) y +y local (plano x–y).
- `M`:
  - Plano x–z: `M = −My`, positivo cuando tracciona la fibra −z.
  - Plano x–y: `M = Mz`, positivo cuando tracciona la fibra −y.
  - La ordenada se dibuja **del lado de la fibra traccionada** (M > 0 hacia −z local / −y local).
  - En ambos planos se cumple `dM/dx = V` (x–z: `d(−My)/dx = −Vz`; x–y: `dMz/dx = −Vy`).
- Se rotulan los valores extremos con signo y unidad.
- El solver y `model` siempre trabajan con los valores crudos de la sección 6; solo `report` y la UI aplican la presentación.

## Ejemplos numéricos de referencia

Barra horizontal x = +X, z = +Z, y = +Y. Se usarán como casos de verificación en M1 (tolerancia relativa 1e-6).

**E1. Viga biapoyada, L = 6 m, w = 10 kN/m hacia abajo** (global `[0, 0, -10]`), EI = 20000 kN·m²:
- Reacciones: componente Z (índice 2) en A y B = `+30 kN` (cargas −60, reacciones +60).
- Valores del solver: `Vz(x) = 10x − 30` → `Vz(0⁺) = −30`, `Vz(6⁻) = +30`; `My(x) = 5x² − 30x` → `My(3) = −45 kN·m`.
- Fuerzas de extremo: `endForces.i = endForces.j = [0, 0, +30, 0, 0, 0]` (ver §6.2).
- Presentación: `V(0⁺) = +30 kN`, `M(3) = +45 kN·m = wL²/8` (tracción inferior).
- Flecha central: `uz(3) = −5wL⁴/(384EI) = −5·10·1296/(384·20000) ≈ −0.008438 m`.

**E2. Voladizo, L = 2 m, empotrado en x = 0, P = 15 kN hacia abajo en x = 2** (global `[0, 0, -15]`), EI = 10000 kN·m²:
- Reacción en el empotramiento: fuerza Z (índice 2 del `Dof6`) `= +15 kN`; **reacción de momento alrededor de Y (índice 4 del `Dof6`) `= −30 kN·m`** (equilibrio de momentos respecto al empotramiento: la carga aporta +30 kN·m alrededor de +Y).
- Solver: `Vz = −15` constante; `My(x) = 30 − 15x` (`My(0) = +30`, `My(2) = 0`).
- Fuerzas de extremo en i: `Fz_i = +15`, `My_i = −My(0) = −30` (coincide con la reacción porque aquí ejes locales = globales).
- Presentación: `M(0) = −30 kN·m` (momento negativo, tracción superior), `V = +15`.
- Punta: `uz = −PL³/(3EI) = −0.004 m`; `ry = +PL²/(2EI) = +0.003 rad` (positivo: giro de +x hacia −z, mano derecha respecto a +Y; coherente con θy = −duz/dx).

**E3. Axial**: barra con `i` empotrado y `j` en x = L. Carga nodal global `f = [+100, 0, 0]` en `j` → `N = +100 kN` (tracción). Con `f = [−100, 0, 0]` → `N = −100 kN` (compresión).

**E4. Rotación de sección**: `rotation = π/2` sobre una barra horizontal gira los ejes locales alrededor de x: `y' = +Z`, `z' = −Y` globales. Una carga global `[0, 0, -w]` queda como `wy' = −w`, `wz' = 0`; la flexión ocurre en el plano x–y local y se resiste con `Iz`. (Solo válido con `analysis: "3D"`; en `"2D-XZ"` esta rotación es `invalid-model`.)

## Consecuencias

- Todos los paquetes usan los tipos de `@edscar/model`; el solver testea E1–E4, el ejemplo de empotramiento perfecto de §6.2 y el caso térmico biempotrado de §5.1 desde M1.
- **Origen de los valores esperados en los tests de M1.** Se calculan en el propio test con las fórmulas cerradas de este ADR (E1–E4, empotramiento perfecto de §6.2, caso térmico de §5.1 y salto de 180° de §3 con δ = 0 y δ = 1e-4 rad, comprobando los ejes locales y el signo de `My` local en ambos casos), **nunca copiados de la salida del código** bajo prueba (prohibidos los snapshots como fuente de los esperados).
- `io` convierte desde/hacia los ejes y unidades de cada formato externo (muchos usan Y vertical); esa conversión vive solo en `io`.
- La presentación (sección 7) y la transformación local↔global se implementan una sola vez, en módulos compartidos por UI e informes.
- Cambiar esta convención exige un ADR nuevo y revisión del Revisor de ingeniería.

## Alternativas consideradas

- **Y vertical** (habitual en gráficos 3D), también solo en 2D como sugería la especificación: descartada; Z arriba es la convención estructural habitual, simplifica la conversión con SAF/OpenSees y evita tener dos convenciones (2D y 3D). La vista 3D hace su propia conversión.
- **Presentar My crudo**: descartada; produce diagramas de flexión invertidos respecto a la práctica de ingeniería.
- **`endForces` como esfuerzos de sección en x = 0 y x = L**: descartada para evitar duplicar `stations`; las fuerzas de extremo nudo→barra son las que necesitan el ensamblaje, las uniones y la exportación, y su relación con los esfuerzos se fija en §6.2.
- **Gradiente térmico como ΔT en °C**: descartada porque exige guardar el canto en `Section`; se usa °C/m y la conversión ΔT/h queda fuera del solver.
- **Unidades N y mm**: descartadas; kN y m se alinean con los Eurocódigos y dan magnitudes manejables.
