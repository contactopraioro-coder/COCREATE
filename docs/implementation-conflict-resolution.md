# Implementation Conflict Resolution

## Detección

Analysis compara Baseline de Proposal, Current actual y la revisión aprobada por hash y modo. Si Current sigue igual a Baseline, el cambio puede aplicarse. Si Current ya coincide con Proposal, se omite. Si ambos cambiaron, la operación se pausa antes de crear el checkpoint.

También se bloquea cuando Git tiene un merge, rebase o cherry-pick en curso. Los cambios ajenos fuera del change set no se tocan.

## Decisiones

Para cada archivo resoluble el usuario elige:

- `Conservar Current`: omite ese cambio;
- `Usar Proposal`: aplica la revisión aprobada;
- `Cancelar`: termina la operación sin Apply.

Dependencias y configuración se marcan como alto riesgo y exigen revisión explícita. Un conflicto de estado del repositorio no puede resolverse fingiendo una versión: debe terminarse fuera de CoCreate y luego usarse `Volver a comprobar`. El runtime repite Analysis completo antes de permitir Apply.

No hay merge textual automático en v1. Esta decisión evita presentar una combinación no revisada como si formara parte de la Proposal aprobada.
