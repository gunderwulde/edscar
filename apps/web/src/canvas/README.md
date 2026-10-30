# canvas/ — lienzo 2D (dueño: agente UI/Canvas)

- Dibujo propio en SVG (y Canvas 2D si el rendimiento lo exige), sin librerías de dibujo de terceros (ADR-006).
- Vista del plano X–Z del modelo (`analysis: "2D-XZ"`, Z hacia arriba, ADR-001): nudos, barras, apoyos, cargas por patrón (flechas escaladas, rellenos de distribuidas, colores por patrón) y resultados (deformada, diagramas N/V/M del lado de la tracción, reacciones).
- Transformación mundo (m) ↔ pantalla, zoom/encuadre, rejilla y captura (snap), selección por clic y por caja.
- Lee el estado del store (`../store`) y emite comandos; nunca modifica el modelo directamente.
- Sin conversiones de unidades propias: las de presentación las da la capa de UI común.
- Three.js / react-three-fiber quedan reservados para la vista 3D de M4; no se usan aquí.

## Estado actual (M2)

- `<Canvas fitSignal />` se monta dentro de `<EditorProvider>` y ocupa el 100 % de su contenedor (debe tener tamaño). Cambiar `fitSignal` encuadra el modelo.
- Herramientas: seleccionar (clic, caja con Mayús/Ctrl para sumar, arrastrar nudos), nudo, barra, apoyo. Captura a rejilla y a nudos. Rueda = zoom, botón central/derecho o Espacio+arrastre = desplazar.
- Atajos (con el lienzo enfocado): V/N/B/S herramientas, F encuadrar, Supr borrar, Ctrl+Z / Ctrl+Y, Ctrl+A, flechas, +/-, Esc.
- Cargas por patrón con color Okabe-Ito y etiqueta con el id del patrón (el color no es el único canal); la leyenda muestra/oculta patrones y fija el patrón activo.
- Resultados: diagramas N/V/M (ADR-001: V = -Vz, M = -My dibujado del lado de la tracción), deformada y reacciones. Si el solver no entrega `deflections`, la deformada es una interpolación cúbica de los desplazamientos nodales y se avisa en pantalla. Resultados obsoletos se atenúan y se avisa.
- Módulos puros y testeados: `transform`, `hit`, `loadGlyphs`, `supports`, `results`, `interaction`.
- Colores por tokens CSS `--ec-*` (modo oscuro por `prefers-color-scheme` y `[data-theme="dark"]`).
