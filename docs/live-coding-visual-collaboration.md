# Live Coding: Visual Collaboration

## Objetivo

Visual Collaboration convierte Live en una mesa de trabajo compartida. El desarrollador puede navegar una aplicación real, señalar una región, nombrarla en lenguaje de producto y conversar con Codex sobre ese contexto sin abandonar Workspace.

La capacidad no captura la pantalla, no inspecciona DevTools, no modifica el DOM del preview y no aplica código automáticamente.

## Arquitectura

```text
CoCreate Workspace
  -> Chat / Live
  -> VisualCollaborationWorkspace
     -> Current Preview
     -> Visual Interaction Layer
     -> Proposed State + History
  -> VisualCollaborationService
     -> safe selection context
     -> proposal lifecycle
     -> persisted session model
  -> Assistant Runtime
  -> Provider Runtime
  -> Codex Integration Layer
  -> Codex App Server
```

`VisualCollaborationService` es un Application Service sin acceso a `window`, DOM, Electron o IPC. La UI proyecta su snapshot y traduce gestos a puntos normalizados; el servicio solo conserva lenguaje de producto y estado de sesión.

## Layout

Live mantiene una sola conversación y un solo composer.

```text
Current application | Proposed state
------------------------------------
Timeline
Conversation
Voice / Composer / Actions
```

El usuario puede comparar con tres modos:

- `Actual`: prioriza la aplicación actual;
- `Dividida`: muestra Current y Proposed en columnas;
- `Superpuesta`: presenta Proposed como capa translúcida sobre Current.

Proposed nunca dibuja una versión falsa de la aplicación. Sin una respuesta real muestra un estado vacío; durante un Turn muestra `Preparando`; con respuesta muestra una propuesta textual verificable y su historial.

## Preview actual

El preview acepta únicamente URLs `http` o `https`. Antes de persistirlas elimina:

- usuario y contraseña;
- query parameters;
- fragments.

El iframe usa sandbox sin `allow-same-origin` y `referrerPolicy="no-referrer"`. Esto impide que CoCreate lea cookies, campos ocultos o DOM cross-origin. El preview puede navegar, hacer scroll, refrescarse y cambiar entre tamaños Desktop, tablet y móvil.

No se implementó captura de pantalla ni grabación de video.

## Selección y contexto

La herramienta `Seleccionar` resalta una región al pasar el puntero y la fija al hacer clic. El usuario la nombra con una etiqueta amigable, por ejemplo:

```text
Botón Guardar
Tarjeta de precio
Formulario de contacto
```

El contexto enviado al siguiente Turn contiene solamente:

- nombre del preview;
- URL sanitizada;
- viewport;
- etiqueta amigable;
- ubicación aproximada en lenguaje natural;
- Project, Task y Conversation.

Nunca contiene selectores CSS, IDs, clases, HTML o coordenadas crudas. Al decir “esto”, Codex recibe el nombre y la ubicación seleccionados. Si el browser no expone una integración semántica oficial, CoCreate lo trata honestamente como una región nombrada y no afirma haber inspeccionado el elemento.

## Puntero y anotaciones

Live incluye:

- puntero compartido visible;
- flecha;
- círculo;
- rectángulo;
- limpieza manual.

Estas marcas son efímeras. No modifican el preview, no forman parte del prompt y se eliminan al salir de la sesión. Tampoco se incluyen en `serialize()`.

## Propuestas

Cada instrucción visual crea una propuesta aislada con estados:

```text
generating -> available -> approved | discarded
```

Una propuesta conserva:

- orden y timestamp;
- instrucción sanitizada;
- origen texto o voz;
- selección asociada;
- resumen real del modelo;
- decisión del usuario.

`Aprobar idea` cambia únicamente el estado de la propuesta. No crea Working Changes, no responde approvals de archivos y no aplica patches. Cualquier modificación de código continúa pasando por App Server, Artifact/Diff y Approval Runtime.

## Voz

La voz usa el mismo `VoiceService` y el mismo composer. Una transcripción enviada en Live crea una propuesta con `source: voice` y captura la selección visual activa. Si la transcripción queda como borrador, el composer conserva su origen hasta el envío.

El audio se limpia mediante el contrato existente y no se guarda dentro de Visual Collaboration.

## Persistencia

Se persisten en Desktop y Web:

- sesión y contexto activo;
- URL sanitizada e historial de navegación;
- modo de comparación;
- viewport;
- selección nombrada;
- propuestas e historial;
- timeline visual.

No se persisten:

- hover;
- puntero;
- herramienta activa;
- anotaciones.

Desktop usa `saveRendererState` y restaura desde `getAppState`. Web reutiliza `/api/state`. Cambiar de Project o Task crea un contexto visual independiente para evitar mezclar previews y propuestas.

## Desktop y Web

### Desktop

Desktop ofrece preview local o web, App Server, Activity, Working Changes, artifacts, approvals, voz y persistencia después de reiniciar la app.

### Web

Web ofrece una experiencia reducida y honesta:

- preview por URL web;
- selección nombrada;
- puntero y anotaciones;
- comparación y persistencia;
- conversación mediante providers Web disponibles.

No muestra Activity de filesystem, shell, Git local, MCP local ni Codex App Server ficticio.

## Seguridad

- No se usan `getDisplayMedia` ni `MediaRecorder`.
- No se accede a `contentDocument`, cookies, local storage del preview ni campos ocultos.
- Las URLs pierden credenciales y tracking antes de persistirse.
- Las etiquetas y propuestas pasan por redacción de secretos y límites de tamaño.
- El contexto del modelo no contiene selectores ni coordenadas.
- El iframe no comparte origen con CoCreate.
- Aprobar una idea no modifica archivos.
- Working Changes conserva aprobación explícita y scope de Project.

## Pruebas

La cobertura automatizada valida:

- URL segura y redacción de secretos;
- selección amigable sin DOM internals;
- puntero y anotaciones efímeras;
- Actual, Dividida y Superpuesta;
- historial y decisiones de propuesta;
- voz asociada a selección;
- persistencia y restauración;
- disponibilidad honesta Desktop/Web;
- contexto sanitizado enviado a Codex;
- responsive sin overflow.

El gate Desktop ejecuta un Turn visual real, confirma `generating -> available -> approved`, verifica cero Working Changes por aprobar una idea y después ejecuta el gate de coding, diffs, approvals y restauración ya existente.

## Certificación — 17 de julio de 2026

- Web browser gate: aprobado a 1440 px y 390 px, sin errores de consola ni overflow.
- Desktop real gate: `ok: true` con Codex App Server 0.134.0.
- Propuesta visual real: completada, asociada a `Botón Guardar` y aprobada sin Working Changes.
- Restauración Desktop: selección y preview restaurados; anotaciones eliminadas.
- Evidencia: `/tmp/cocreate-visual-collaboration-web.png`, `/tmp/cocreate-visual-collaboration-mobile.png` y `/tmp/cocreate-live-visual-collaboration.png`.

## Deuda

- La identificación automática de un botón, input o card requiere una surface oficial y segura del preview. La versión actual usa regiones nombradas y no inspecciona DOM cross-origin.
- Proposed utiliza Proposal Runtime para mostrar una aplicación funcional aislada, con lifecycle, preview, diff, validación y Apply transaccional.
- No existe colaboración remota multiusuario ni presencia de red en esta versión.
- No existe captura de pantalla o grabación, por decisión de seguridad y alcance.

## Siguiente fase

Visual Collaboration queda conectada a Proposal Runtime sin alterar el principio de aprobación explícita ni mezclar Working Changes con la copia temporal.
