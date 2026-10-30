# worker/ — Web Worker del solver

- `protocol.ts`: tipos de los mensajes (petición/respuesta) y versión del protocolo. Solo datos clonables.
- `handler.ts`: lado Worker; atiende `ping` y `solve` con `createSolver()` de `@edscar/solver`. Nunca lanza.
- `solver.worker.ts`: punto de entrada del Worker (módulo ES, lo empaqueta Vite).
- `client.ts`: lado hilo principal; API con promesas (`ping`, `solve`, `dispose`). Los errores del modelo llegan en `result.status`; la promesa solo se rechaza por fallos del canal o excepciones inesperadas.
- La UI nunca llama al solver en el hilo principal (requisito no funcional, sección 7 de la especificación).
- Cambios del protocolo: incrementar `SOLVER_PROTOCOL_VERSION`; los revisa el Arquitecto.
