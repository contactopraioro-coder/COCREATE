# Implementation Security

## Límites de confianza

El renderer recibe IDs opacos y snapshots sanitizados. Solo Electron Main conoce source root, Proposal Workspace, revision root, checkpoint root y manifests privados.

Los IDs se validan como identificadores; no pasan por la redacción de diagnósticos, evitando pérdida de UUIDs. Logs y mensajes sí se redactan antes de persistir o cruzar IPC.

## Filesystem

- se rechazan paths absolutos, traversal y paths sensibles;
- se ignoran `.git`, dependencias, caches, builds, `.env*`, llaves y credenciales;
- no se siguen symlinks;
- cada destino se comprueba dentro del Project;
- los writes usan archivo temporal y rename;
- se conservan modos de archivo;
- existen límites de archivos y de salida.

## Procesos

Validation solo ejecuta una allowlist derivada de manifests conocidos. Usa `shell: false`, cwd del Project y una allowlist de variables de entorno. No ejecuta lifecycle installs ni acepta comandos de la Proposal. Cancelación y timeout terminan primero el grupo de procesos con `SIGTERM` y escalan a `SIGKILL` después de una espera acotada para evitar hijos huérfanos.

## Git y producto

El runtime no ejecuta commit, push, pull request ni deploy. Detecta operaciones Git incompletas y las bloquea; no toca `.git` ni fuerza checkout/reset. Web no recibe filesystem local ni simula Implementation Runtime.
