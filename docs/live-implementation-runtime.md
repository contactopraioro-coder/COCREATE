# Live Implementation Runtime

## Objetivo

Live Implementation convierte una Proposal aprobada en cambios reales sobre `Current` sin ejecutar dentro de Live ni ocultar el estado al usuario.

```text
Live Proposal approved
  -> immutable approved revision
  -> return to normal Chat
  -> ImplementationOperation
  -> analyze Current
  -> resolve conflicts
  -> checkpoint
  -> incremental Apply
  -> project-aware Validation
  -> workspace refresh
  -> final result / safe rollback
```

La conversación permanece disponible durante toda la operación. El renderer solo consume snapshots públicos y eventos; filesystem, procesos, checkpoints y revisiones viven en Electron Main.

## Arquitectura

```text
CoCreate Chat
  -> ImplementationRuntimeService
  -> Implementation Runtime Gateway
  -> typed IPC / preload
  -> Electron Implementation Runtime
  -> Proposal Runtime approved revision
  -> Current workspace
```

`electron/implementation-runtime.mjs` compone Proposal Runtime. No crea otro agente, no modifica Codex Upstream y no reimplementa el trabajo de Codex. Proposal Runtime produce el workspace aprobado; Implementation Runtime se ocupa únicamente de congelarlo, verificarlo y materializarlo de forma segura.

## Modelo persistente

Cada `ImplementationOperation` relaciona:

- `conversationId`, `projectId`, `proposalId` y `approvedRevisionId`;
- estado, timestamps, duración y progreso;
- change set y archivos afectados;
- conflictos y decisiones explícitas;
- checkpoint y disponibilidad de rollback;
- validaciones con evidencia acotada;
- refresh, fallo, cancelación y recuperación;
- eventos ordenados de la operación.

La revisión aprobada y el checkpoint usan directorios privados administrados. Sus rutas, manifests internos y backups nunca llegan a React. El store se escribe de forma atómica y permite reconstruir operaciones después de reiniciar.

## Change set

El runtime vuelve a calcular manifests y representa cambios `added`, `modified`, `deleted` y `renamed`. Conserva permisos, detecta binarios y eleva el riesgo de dependencias o configuración. Las renames se identifican por hash, sin fabricar una si el contenido no coincide.

Apply opera un archivo a la vez. Antes de cada paso comprueba que Current no cambió desde Analysis. Un archivo ya igual a Proposal se omite de forma idempotente; un archivo elegido como `Current` se conserva.

## Estados de producto

La tarjeta dentro del chat muestra solo la fase actual, progreso, cancelación y resultado. Los detalles de archivos, validaciones y diff permanecen colapsados. El diff reutiliza el preview producido por Proposal Runtime, conserva totales por archivo y permite filtrar y navegar sin volcarlo completo en la conversación. Los estados terminales distinguen completado, completado con advertencias, fallido, cancelado y revertido.

Web declara que la implementación local requiere Desktop. No crea operaciones falsas ni muestra Apply exitoso sin filesystem.

## Eventos y observabilidad

Los eventos persistentes cubren revisión congelada, preparación, análisis, conflictos, checkpoint, Apply por archivo, validaciones, refresh, cancelación, recovery, rollback y resultado final. Cada evento incluye timestamp y metadatos mínimos; no incluye contenido de archivos, comandos arbitrarios, rutas absolutas ni secretos.

## Garantías

- La aprobación congela una revisión inmutable identificada por SHA-256.
- No hay Apply antes de análisis y checkpoint.
- No hay overwrite silencioso.
- Un fallo durante Apply intenta rollback automático y verifica el resultado.
- Un fallo de Validation conserva los cambios y termina con advertencias.
- Rollback manual se bloquea si destruiría trabajo posterior.
- No se ejecutan instalaciones, commits, pushes, PRs ni deploys.

Los contratos detallados viven en `implementation-operation-lifecycle.md`, `implementation-conflict-resolution.md`, `implementation-validation.md`, `implementation-rollback.md`, `implementation-recovery.md` e `implementation-security.md`.

## Evidencia visual

- `live-implementation-web.png`: Chat Web limpio, sin diagnósticos ni implementación local simulada.
- `live-implementation-mobile.png`: composer y selector Chat/Live a 390 x 844 sin overflow horizontal.
