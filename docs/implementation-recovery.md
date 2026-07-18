# Implementation Recovery

## Restauración

Al iniciar Desktop, las operaciones persistidas en una fase activa se marcan `recoveryRequired`. CoCreate no presupone que un proceso sobrevivió ni continúa en silencio: muestra una acción para revisar y recuperar.

## Estrategia por fase

- Queued, Preparing, Analyzing o Conflict: retoma desde análisis o desde las decisiones ya persistidas.
- Applying parcial: restaura el checkpoint y verifica antes de terminar.
- Applying con todos los archivos persistidos: continúa directamente con Validation, sin repetir Apply.
- Validating: vuelve a ejecutar Validation sobre Current ya aplicado.
- Refreshing: repite únicamente Refresh y finaliza.

Las operaciones terminales son no-op ante Start repetido. El mismo `approvedRevisionId` no crea una segunda operación para la misma conversación.

## Fallos de store

El store usa reemplazo atómico. Un store ausente o corrupto no autoriza cambios por inferencia: inicia vacío. Revisions y checkpoints solo se aceptan si permanecen dentro de los roots administrados.

