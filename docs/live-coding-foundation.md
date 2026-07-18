# Live Coding Foundation

## Objetivo

Live Coding es un modo de trabajo dentro del Workspace de CoCreate. No crea una segunda aplicación, no duplica el chat y no expone el protocolo de Codex App Server. La conversación, el composer y el contexto activo continúan siendo la superficie principal.

La fundación implementada permite iniciar una sesión Live, observar su progreso, revisar cambios propuestos y responder aprobaciones sin modificar código de forma implícita. Visual Collaboration extiende esta base sin reemplazarla; su contrato está documentado en `docs/live-coding-visual-collaboration.md`.

## Arquitectura

```text
CoCreate Workspace
  -> Chat / Live Mode
  -> LiveCodingSessionService
  -> WorkspaceExperienceService
  -> Upstream Capability Exposure
  -> Codex Integration Layer
  -> Codex App Server
```

La UI recibe un modelo de producto. No interpreta eventos raw de App Server, no accede a IPC y no ejecuta operaciones de filesystem.

## Sesión Live

Cada sesión proyecta el estado compartido del Workspace y conserva:

- Project, Task y Conversation activos;
- estado, hora de inicio y duración;
- ejecución y acción actual;
- archivos involucrados;
- herramientas utilizadas;
- artifacts y diffs;
- approvals pendientes;
- Working Changes pendientes, aprobados o descartados.

La sesión se restaura como modo de interfaz, pero solo se activa cuando Codex Desktop está realmente disponible. En Web, Chat continúa operativo y Live no simula acceso local.

## Timeline de producto

Los eventos técnicos se proyectan a una secuencia breve y comprensible:

```text
Analizando proyecto
Leyendo archivos
Generando propuesta
Aplicando cambios
Ejecutando validaciones
Finalizado
```

El timeline no muestra stdout completo, nombres de métodos RPC ni diagnósticos internos. Durante una ejecución solo presenta progreso, acción actual y cancelación real.

## Working Changes

Live comienza cada Turn con sandbox de solo lectura. Una escritura requiere una solicitud upstream real y pasa por el Approval Runtime existente.

```text
Codex propone un cambio
  -> App Server solicita permiso
  -> CoCreate valida que la ruta pertenezca al Project
  -> Working Change queda pendiente
  -> Usuario aprueba o descarta
  -> Approval Broker responde al Turn
```

Las autorizaciones se limitan al directorio del Project. Live no concede acceso de red desde una solicitud de permisos ni acepta rutas externas al Workspace. No existen commits, pushes ni pull requests automáticos.

Una decisión visual nunca se considera aplicada por sí sola: el estado `applied` requiere evidencia de patch o file change publicada por upstream para la misma ejecución.

CoCreate no habilita aprobación a ciegas. Si upstream solicita escritura sin publicar un preview, el usuario puede descartar la propuesta, pero la acción de aprobar permanece bloqueada.

## Activity Panel

El panel lateral colapsable reúne sin desplazar la conversación:

- Working Changes;
- archivos abiertos y modificados;
- approvals;
- artifacts;
- diffs;
- herramientas utilizadas.

Los artifacts y previews de diff se renderizan dentro del Workspace. El diff usa líneas, hunks y estados visuales de adición/eliminación en vez de texto plano.

## Voz

El composer y su experiencia de voz son compartidos por Chat y Live. Cuando una instrucción de voz se detiene durante Live, el timeline registra el evento sin persistir el contenido de la transcripción en el runtime de sesión.

## Seguridad

- Live usa `read-only` como sandbox inicial.
- Compartir pantalla siempre requiere una selección explícita del usuario.
- El `MediaStream` permanece en memoria, nunca se serializa y se detiene al salir, aprobar o desmontar.
- La captura solicita `audio: false`; no graba audio del sistema ni usa `MediaRecorder`.
- macOS expone recuperación de Screen Recording Permission mediante IPC mínimo, sin enumerar fuentes en React.
- Toda escritura requiere aprobación explícita.
- Los permisos se normalizan y restringen al Project activo.
- La UI no recibe rutas fuera de los metadatos seguros ya expuestos.
- No hay commits, pushes, PRs ni aprobaciones automáticas.
- La cancelación utiliza la ejecución real activa.

## Desktop y Web

Desktop habilita Live completo cuando App Server está disponible. Desde Visual Collaboration, Web ofrece Live reducido por URL sin filesystem, shell, Activity local ni Codex App Server simulado.

## Pruebas

La cobertura de la fundación incluye:

- creación y duración de sesión;
- Project, Task y Conversation activos;
- timeline, archivos, herramientas y cancelación;
- Working Changes basados en approvals reales;
- aprobar y descartar;
- evidencia upstream antes de marcar un cambio como aplicado;
- instrucciones de voz sin contenido sensible;
- parsing de unified diff con números de línea;
- sandbox Live de solo lectura;
- permisos de escritura limitados al Project;
- rechazo de rutas externas y de acceso de red.

## Evolución visual

Visual Collaboration ya implementa preview por URL, selección visual nombrada, puntero, anotaciones efímeras, comparación, historial de propuestas y contexto de voz. No implementa captura de pantalla, inspección DOM cross-origin ni aplicación automática; esos límites son deliberados.

## Siguiente gate

La certificación de Visual Collaboration mantiene las mismas guardas de Live Coding y habilita como siguiente bloque Proposal Runtime.

## Certificación — 17 de julio de 2026

- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado con guardas específicas de Live Coding.
- `npm test`: 181 pruebas, 180 aprobadas y 1 integración opcional omitida.
- `npm run build`: aprobado para Web y overlay.
- `npm run build:desktop`: aprobado para macOS arm64.
- `npm run smoke:desktop`: aprobado sobre la app empaquetada.
- `npm run codex:app-server:contract`: contrato v2 aprobado para Codex 0.134.0.
- `npm run qa:workspace:desktop`: aprobado con App Server real, Chat/Live, panel colapsable, Turn, approvals y restauración.

La evidencia visual Desktop se capturó en `/tmp/cocreate-live-coding-foundation.png`. El gate confirmó una sola conversación, un solo composer, ausencia de diagnostics en Live y retorno inmediato a Chat.
