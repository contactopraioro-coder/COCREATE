# Codex Feature Parity Audit

Fecha de auditoria: 2026-07-16  
Codex validado: `0.134.0`  
Contrato: App Server JSON-RPC v2 generado con `codex app-server generate-ts --experimental`

## Regla de decision

CoCreate no infiere una capability desde la interfaz de otra aplicacion. Una feature solo se marca disponible cuando existe una surface oficial en el App Server, un contrato CoCreate ya integrado o un backend seguro configurado. Las surfaces experimentales se exponen con guardas y nunca como disponibilidad universal.

Clasificacion:

- `Inherited`: Codex conserva comportamiento y estado; CoCreate solo presenta.
- `Wrapped`: CoCreate traduce un contrato oficial a una experiencia de producto.
- `Extended`: CoCreate agrega contexto o persistencia sin duplicar Codex.
- `Owned by CoCreate`: no existe equivalente upstream y pertenece al producto.
- `Unsupported`: la version instalada no ofrece una surface suficiente.
- `Deferred`: existe una ruta posible, pero no se integra en esta version.

## Auditoria del shell actual

> Nota historica: esta seccion describe el estado previo a Feature Parity v1. La navegacion y composer actuales se resumen en la certificacion 10.1 al final del documento.

- `Nueva tarea` tiene un flujo real para Task y Conversation, pero aparece duplicada y no tiene route propia.
- `Programados`, `Complementos`, `Sitios`, `Pull requests` y `Chat` se dibujan como botones sin handler, estado activo ni historial.
- La busqueda superior del sidebar y el icono de archivo son controles decorativos.
- El contenido principal no tiene route outlet; siempre renderiza la conversacion.
- La barra superior expone Workspace, Project, Task, Conversation y Context como cinco controles consecutivos.
- La voz funciona con Speech Recognition o grabacion/transcripcion, pero no diferencia claramente permiso, grabacion, transcripcion y error.
- El composer no expone adjuntos, modelos, plan, skills, complementos ni objetivos.
- Desktop y Web comparten estructura, pero la UI no centraliza sus diferencias de capability.
- `CoCreateV01Experience.tsx` es la experiencia principal. `CoCreateExperience.tsx` permanece como legacy en `#/workbench` y no recibira features nuevas.

## Matriz de paridad

| Feature | Visible in CoCreate | Functional in CoCreate | Exists in Codex upstream | Official upstream surface | Desktop availability | Web availability | Implementation strategy | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nueva tarea | Si | Parcial | Si | `thread/start`, Workspace Runtime | Si | Si, sin App Server | Extended: route sobre el flujo Workspace existente | P0 | Extended |
| Chat general | Si | Si | Si | Provider Runtime | Si | Si | Extended: distinguir chat general, proyecto y Task | P0 | Extended |
| Task Conversation | Si | Si | Si | `thread/start`, `turn/start`, Workspace Runtime | Si | Si, provider web | Wrapped | P0 | Wrapped |
| Navegacion principal | Si | No | No aplica | Product layer | Si | Si | Registry + history + route outlet | P0 | Owned by CoCreate |
| Workspace / Project / Task | Si | Si | No aplica | Workspace Runtime | Si | Si | Simplificar header; mover estructura al sidebar | P0 | Owned by CoCreate |
| Restauracion | Si | Si | Si | `thread/resume`, Workspace Runtime | Si | Persistencia Workspace | Mantener restauracion existente | P0 | Wrapped |
| Streaming | Si | Si | Si | eventos `item/*/delta` | Si | Segun provider | Mantener Exposure Layer | P0 | Wrapped |
| Approvals | Si | Si | Si | requests `requestApproval` | Si | No filesystem local | Mantener broker sin autoaprobar | P0 | Wrapped |
| Diffs / Artifacts | Si | Si | Si | `turn/diff/updated`, file-change events | Si | Segun provider | Mantener metadatos y preview | P0 | Wrapped |
| Plan events | Si | Si | Si | `turn/plan/updated` | Si | Segun provider | Mostrar solo planes upstream | P0 | Wrapped |
| Plan mode | No | No | Si, experimental | `collaborationMode/list`, `TurnStartParams.collaborationMode` | Condicional | No configurado | Exponer solo si discovery lo confirma | P1 | Deferred |
| Objectives | No | No | Si, surface upstream adicional | `thread/goal/set|get|clear` generado como experimental | Condicional | Workspace local | No duplicar; diferir hasta integrar contrato de goal | P2 | Deferred |
| Model picker | No | No | Si | `model/list`; `TurnStartParams.model/effort` | Si, con App Server | Segun Provider Runtime | Catalogo real, ocultar modelos hidden, aplicar al siguiente Turn | P0 | Wrapped |
| Archivos e imagenes | No | No | Parcial | `UserInput`: `image`, `localImage`, `mention`, `skill` | Imagen local si App Server disponible | Imagen URL/data solo con provider compatible | Broker seguro; no prometer archivos arbitrarios | P0 | Wrapped |
| Carpetas como contexto | No | No | Parcial | runtime workspace roots y mentions | Desktop | No filesystem local | Selector de contexto, no upload automatico | P1 | Deferred |
| Voz | Si | Si, poco explicita | Si, experimental | `thread/realtime/*`; transcripcion CoCreate existente | Si | Si si API configurada | Conservar transcripcion v1 y estados accesibles; realtime deferred | P0 | Extended |
| Composer `+` | No | No | No aplica | Product layer sobre capabilities | Si | Si | Mostrar solo acciones disponibles | P0 | Owned by CoCreate |
| Web Search | Indirecto | Si | Si | web-search items/events | Si | Segun Trusted Web provider | Estados precisos y routing confiable | P0 | Wrapped |
| DateTime | No visible | Si | No aplica | `DateTimeTool` local | Si | Si | Mantener routing local antes de provider | P0 | Owned by CoCreate |
| Identity | No visible | Si | No aplica | Identity Runtime | Si | Si | Mantener routing local | P0 | Owned by CoCreate |
| Programados | Si | No | No en contrato integrado | Sin request estable fijado en manifiesto | No | No | Route con estado `Unsupported by current upstream` | P1 | Unsupported |
| MCP discovery | Parcial | Si | Si | `mcpServerStatus/list` | Si | No local MCP | Lista sanitizada y estado; sin config ni secrets | P1 | Wrapped |
| Skills | No | No | Si, surface generada | `skills/list`, `UserInput.skill` | Condicional | No local | Integrar solo tras fijar contrato y sanitizacion | P1 | Deferred |
| Plugins / marketplace | No | No | Si, experimental | `plugin/*`, `marketplace/*` generado | Condicional | No configurado | Discovery primero; instalacion fuera de v1 | P2 | Deferred |
| Complementos | Si | No | Parcial | MCP estable; skills/plugins aun no fijados | Parcial | Limitado | Vista agregada con fuentes y disponibilidad honesta | P1 | Wrapped |
| Sitios | Si | No | No confirmado | Sin surface App Server de sites/deployments | No | No | Empty state explicito; no crear hosting | P1 | Unsupported |
| Pull requests | Si | No | No nativo confirmado | Requiere GitHub connector/MCP/backend seguro | Si, si se configura | Si, si se configura | Estado `Authentication required` o `Not configured` | P1 | Deferred |
| Git branch / dirty | No | No | Parcial | Thread `gitInfo`/integracion local; no wrapper CoCreate | Si | No filesystem local | Servicio seguro que devuelve solo metadatos | P1 | Extended |
| Environment | Parcial | Parcial | Si | thread/turn environment params | Si | Provider dependiente | Resumen compacto; no raw config | P1 | Wrapped |
| Project instructions | No | No | Si | AGENTS/config/instructions upstream | Si | Contexto web propio | Mostrar procedencia, nunca system prompts | P2 | Deferred |
| Responsive / keyboard | Parcial | Parcial | No aplica | Product layer | Si | Si | Focus visible, routes operables y sidebar adaptable | P0 | Owned by CoCreate |

## Surface oficial confirmada

El manifiesto CoCreate fijado utiliza threads, turns, history, plans, streaming, approvals, diffs, commands, web search, MCP, auth, cancellation, usage y compaction. El contrato generado de `0.134.0` confirma ademas `model/list`, inputs de imagen/local image, settings por Turn y surfaces experimentales de collaboration mode, skills, plugins, realtime y goals.

La presencia en el contrato generado no equivale a soporte de producto. Antes de exponer una surface adicional se exige:

1. fijarla en el manifiesto versionado;
2. envolverla en Integration Layer;
3. sanitizar su respuesta;
4. definir Desktop/Web;
5. agregar contract e integration tests;
6. disponer de un fallback honesto.

## Decisiones para v1

- Implementar ahora registry, routes, sidebar, contexto compacto y estados honestos.
- Integrar `model/list` porque es una request oficial ya incluida en el manifiesto fijado.
- Implementar adjuntos v1 solo para modalidades que el provider o App Server declaren compatibles; nunca enviar archivos arbitrarios como si fueran soportados.
- Mantener la transcripcion de voz existente y hacer visibles sus estados. Realtime voice queda diferido por ser experimental.
- Mostrar MCP real desde status sanitizado. Skills y plugins se declaran parciales/deferred hasta fijar contratos adicionales.
- No construir scheduler, hosting ni cliente GitHub. Sus routes explicaran el gap y el requisito exacto.
- Implementar Git context como metadatos compactos de Desktop; Web declarara ausencia de filesystem local.
- No duplicar goals ni plan mode. Si discovery no confirma su integracion segura, la UI los marcara deferred en lugar de simularlos.

## Feature Parity v2 Revalidation

Revalidado el 16 de julio de 2026 contra Codex `0.134.0` mediante `codex --version`, el manifest fijado de CoCreate y un contrato generado con `codex app-server generate-ts --experimental`. La generacion experimental sirve para clasificar y aislar surfaces; no las convierte en estables.

| Feature | Current upstream version | Stable surface | Experimental surface | Unavailable | Desktop support | Web support | Auth requirement | Feature flag required | Integration recommendation | Blocking before Live Coding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plan Mode | 0.134.0 | `turn/start` acepta overrides fijados | `collaborationMode/list` y `collaborationMode` | No | Si, App Server | No local | Codex account | `planMode`, `experimentalUpstream` | Adapter experimental; preset aplicado al thread desde el siguiente Turn; fail closed | No |
| Skills | 0.134.0 | `UserInput.skill` existe en input generado | `skills/list`, `skills/changed`, config write | No | Read/list y seleccion experimental | No local skills | Codex account | `skills`, `experimentalUpstream` | Listado sanitizado y seleccion para el siguiente Turn; sin config write | No |
| Plugins | 0.134.0 | Ninguna surface fijada por CoCreate | `plugin/*`, `marketplace/*` | No | Solo discovery experimental | No local plugins | Puede variar por plugin | `plugins`, `experimentalUpstream` | Catalogo read-only; no instalar, desinstalar ni editar config | No |
| MCP | 0.134.0 | `mcpServerStatus/list`, tool progress | startup status, oauth y reload adicionales | No | Si | No local MCP | Segun server | No para inventario estable | Inventario sanitizado, deduplicado y refresh por eventos; no exponer arguments/config | No |
| Scheduled Tasks | 0.134.0 | Ninguna | Ninguna encontrada | Si | No | No | N/A | `scheduledTasks` | Mantener Unsupported; no scheduler propio | No |
| GitHub Authentication | 0.134.0 | Ninguna GitHub-specific | Ninguna GitHub-specific | Si | Solo si aparece connector/MCP externo | Solo backend futuro | GitHub OAuth/connector | `githubIntegration` | Estado Authentication required; no token ni OAuth propio en v2 | No |
| Pull Requests | 0.134.0 | Ninguna PR-specific | Ninguna PR-specific | Si sin connector | Condicional a GitHub externo | Condicional a backend | GitHub | `githubIntegration` | Mantener auth required; no cliente GitHub paralelo | No |
| Sites | 0.134.0 | Ninguna | Ninguna con semantica de hosting | Si | No | No | Provider futuro | Ninguno | Mantener Deferred y definirlo como deployments conectados futuros | No |
| Voice | 0.134.0 | Transcripcion CoCreate existente | `thread/realtime/*` | No | Media device + API configurada | Browser media + API configurada | Provider de transcripcion | `nativeVoice` | Endurecer permisos/dispositivos en servicio propio; realtime upstream diferido | Si, flujo local |
| File Picker | 0.134.0 | `localImage`, `mention`, `skill` inputs | Ninguna necesaria | No | Dialog broker en Main | Browser File API sin paths locales | No | `nativeFilePicker` | Validacion por entorno, tokens opacos y cleanup; Web usa File handles acotados | Si |
| Model / reasoning | 0.134.0 | `model/list`, `turn/start model/effort` | No requerida | No | Si | Provider web segun catalogo | Provider/Codex | No | Conservar catalogo oficial y override del siguiente Turn | Si |

### Scope confirmado

- `TurnStartParams.collaborationMode` tiene precedencia sobre model, effort e instrucciones de desarrollo y se aplica al Turn y Turns siguientes del mismo thread. CoCreate lo persiste por Task/Conversation como seleccion explicita y lo vuelve a enviar al siguiente Turn; nunca lo trata como objetivo.
- `skills/list` recibe `cwds` y `forceReload`; devuelve cwd, metadata, errores y paths. La UI solo recibira nombre, descripcion, scope, source, enabled y un token/path mantenido detras del bridge Desktop.
- `mcpServerStatus/list` admite paginacion y detalle `toolsAndAuthOnly`. `mcpServer/startupStatus/updated` permite refrescar estado sin reiniciar la app.
- No se encontro metodo estable ni experimental para scheduled tasks, GitHub PRs o Sites. Esas routes permanecen honestas.

## Riesgos encontrados

- El contrato generado contiene surfaces experimentales no cubiertas por el manifiesto fijado; activarlas sin pinning produciria drift.
- La voz web depende de permisos del navegador y, en fallback, de `/api/transcribe` configurado.
- Los modelos disponibles dependen de autenticacion y configuracion del App Server; no debe existir catalogo hardcodeado.
- PRs necesitan autenticacion GitHub separada o MCP configurado; el producto actual no dispone de ese contrato seguro.
- Los adjuntos requieren validar modalidad por provider y evitar que rutas locales o contenido privado se filtren al renderer o a Web.

## Criterio de cierre de auditoria

La implementacion puede comenzar porque las areas P0 tienen una estrategia respaldada por contratos reales, y las areas sin surface cuentan con un estado explicito. El Feature Parity Registry sera la unica fuente de disponibilidad para sidebar, routes y composer.

## Certification Gate 10.1

La auditoria en dispositivo real confirmo que Nueva tarea, Programados, Complementos, Sitios, Pull requests y Chat navegan con active state, history y restore. Programados permanece Unsupported, Sitios Deferred, Pull requests Authentication required y Web no simula filesystem/App Server/MCP local. DateTime respondio localmente; Plan, Skills y MCP se validaron contra Codex 0.134.0 real.

El cierre sigue pendiente por gates fisicos no sustituibles: microfono/transcripcion, picker, drag-and-drop y teclado. El unico defecto de producto observado fue un recorte del control de tema a 390 px, corregido y revalidado. Ver `docs/codex-feature-parity-v2-certification.md`.
