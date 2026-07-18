# Checklist Operativo

## GitHub

- Confirmar acceso de escritura al repo `contactopraioro-coder/caleidoscopio-overlay`.
- Activar proteccion de rama sobre `main`.
- Exigir el workflow `CI`.
- Configurar pull requests con revisiones antes de merge.

## Vercel

- Confirmar que el proyecto `caleidoscopio-overlay` sigue apuntando a este repo.
- Revisar comando de build.
- Revisar rama de produccion.
- Configurar variables de entorno por ambiente.
- Validar si Vercel publicara solo la capa web o tambien APIs.

## Entorno local

- Instalar dependencias con `npm install`.
- Verificar build con `npm run build`.
- Verificar permisos de macOS para captura de pantalla.
- Verificar disponibilidad del binario `codex`.

## Persistencia

- No depender de `localStorage` para datos criticos.
- No depender de `data/store.json` para produccion.
- Definir base de datos durable.
- Definir object storage para grabaciones y artefactos.

## Sesiones

- Crear identificadores unicos de sesion, proyecto e hilo.
- Persistir mensajes, eventos y ejecuciones.
- Restaurar estado tras reinicio.

## Live editing

- Confirmar que Chat y Live conservan la misma conversación, draft y scroll.
- Confirmar que el sidebar no cambia al activar Live.
- Probar selector cancelado, permiso denegado, cambio de superficie y stop externo.
- Confirmar que la captura no solicita audio del sistema y que todos los tracks terminan al salir.
- Confirmar que Current permanece intacto durante todas las iteraciones de Proposal.
- Confirmar que `Aprobar y desarrollar` vuelve a Chat antes de Apply.
- Confirmar que salir y descartar produce cero cambios en el proyecto.
- Validar Current/Proposal como tabs en móvil y ausencia de overflow horizontal.
- Crear una tarea sin proyecto, asociarla después y comprobar que conserva historial.

## Manual QA — Live Coding Experience

1. Abrir una conversación existente y activar Live.
2. Elegir pantalla, ventana y pestaña en intentos separados.
3. Cambiar y pausar la superficie; probar encuadre y fullscreen.
4. Seleccionar, señalar y anotar una zona.
5. Enviar instrucciones por texto y voz; revisar tres iteraciones y deshacer una.
6. Aprobar y confirmar retorno a Chat, validación, diff y resultado.
7. Salir conservando y descartando borrador; confirmar cleanup.
8. Reiniciar con Live persistido y confirmar que captura solicita nuevo consentimiento.
9. Repetir en Web, Desktop y viewport móvil.

## Manual QA — Live Implementation

1. Aprobar una Proposal real y confirmar retorno inmediato a Chat.
2. Confirmar revisión congelada, progreso y conversación utilizable durante la operación.
3. Aplicar cambios added, modified, deleted, renamed, binary y permisos.
4. Provocar un cambio externo y resolver con Current, Proposal y Cancel en intentos separados.
5. Provocar fallos en el primer archivo y a mitad de Apply; verificar Current exacto después del rollback automático.
6. Probar Validation exitosa, fallida, no disponible, timeout y cancelación.
7. Revertir una implementación y comprobar validación y refresh posteriores.
8. Crear trabajo posterior sobre un archivo aplicado y confirmar que rollback manual se bloquea.
9. Reiniciar en Preparing, Applying, Validating y Refreshing; recuperar sin duplicar Apply.
10. Confirmar una sola operación activa por Project y paralelismo entre Projects distintos.
11. Confirmar que Web no simula filesystem, Apply ni resultado exitoso.
12. Repetir la tarjeta de progreso y conflictos en viewport móvil sin overflow.
