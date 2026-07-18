# Implementation Operation Lifecycle

## Flujo

```text
Queued
  -> Preparing
  -> Analyzing
  -> Conflict -> Preparing (después de decisiones explícitas)
  -> Applying
  -> Validating
  -> Refreshing
  -> Completed | Completed with warnings
```

Desde cualquier fase segura puede terminar en `Cancelled`. Un fallo pre-Apply no toca Current. Un fallo durante Apply termina en `Failed` después de intentar y verificar rollback. Una operación completada puede pasar a `Rolled back` mediante acción explícita.

## Aprobación y freeze

`Aprobar y desarrollar` aprueba la Proposal, cierra captura, vuelve inmediatamente a Chat y crea la operación. Proposal Runtime entrega roots y manifests solo dentro de Main. Implementation Runtime copia los archivos cambiados a una revisión privada y guarda el `approvedRevisionId` antes de analizar Current.

El mismo par Proposal/Conversation es idempotente: repetir Create o Start devuelve la operación existente y una operación terminal no vuelve a aplicar archivos.

## Concurrencia

Puede existir una sola operación activa por Project. Operaciones de Projects distintos sí pueden avanzar en paralelo. El lock se mantiene durante conflictos para impedir que otra operación invalide el análisis.

## Cancelación

- antes de Apply: cancelación inmediata, sin cambios;
- durante Apply: se respeta al terminar el archivo atómico y se restaura el checkpoint;
- durante Validation: se aborta el proceso activo; los cambios quedan aplicados y se ofrece rollback;
- después de completar: no cambia el resultado; se usa la acción de rollback.

