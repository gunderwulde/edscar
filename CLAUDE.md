# Edscar — reglas comunes para todos los agentes

Edscar es un editor web de cargas para estructuras de barras (Europa, Eurocódigos). Especificación completa: [EDITOR_CARGAS_ESTRUCTURAS.md](EDITOR_CARGAS_ESTRUCTURAS.md). Léela antes de trabajar; la sección 13 es vinculante.

## Reglas no negociables
1. **Cero código de terceros.** Todo se escribe desde cero. Prohibido copiar/adaptar código de otros proyectos, Stack Overflow o gists. Dependencias solo de infraestructura genérica (React, Vite, Three.js, Zod, Vitest, Playwright); cualquier otra requiere ADR aprobado por el propietario. Sin librerías de álgebra lineal ni FEM. Todo se lista en `THIRD_PARTY.md`.
2. **Licencia MIT.** Dependencias permitidas: MIT/BSD/Apache-2.0/ISC; además BlueOak-1.0.0 **solo en dependencias de desarrollo** (nunca runtime; ADR-004). Nunca GPL/AGPL/LGPL. Cualquier licencia no listada requiere aprobación del propietario.
3. **Norma: Eurocódigos** (EN 1990, EN 1991-1-x, EN 1998) + Anexos Nacionales como datos. Orden: EN recomendado → España → Francia → Alemania → Italia. ASCE 7 fuera de v1.
4. **Datos normativos siempre con cita** (norma, edición, artículo). Si no se puede verificar: `unverified: true`. No copiar texto extenso de las normas.
5. **Cada agente edita solo su paquete.** Cambios de contrato entre paquetes los aprueba el Arquitecto.
6. **Todo cambio en `solver`, `loads` o `codes` lleva tests y revisión del Revisor de ingeniería.**
7. **Unidades internas SI** (m, kN, kN·m, °C); conversión solo en la UI. Convención de ejes/signos: ADR-001.
8. Cada PR incluye descripción, tests y una **declaración de originalidad** ("código escrito desde cero, sin copiar de terceros").
9. Paquetes `@edscar/*`; monorepo con pnpm; TypeScript estricto; ficheros de proyecto `.edscar.json`.
10. Informa con honestidad: si un test falla o algo no se verificó, dilo.
