# Upstream Capability Exposure v1

## Principio

CoCreate es una Product Layer construida sobre Codex Upstream. Si Codex App Server ya ofrece una capacidad, CoCreate la observa, traduce y presenta; no modifica su protocolo, no intercepta su lógica y no la reimplementa.

```text
CoCreate UI
-> Application Services
-> Capability Exposure Layer
-> Codex Integration Layer
-> Codex App Server
-> Codex Core
```

La UI nunca recibe JSON-RPC ni conoce métodos como `turn/start`. Sólo consume `CapabilityExposureState`, una proyección de producto compartida y segura.

## Componentes

### Event Mapping

`shared/upstream-capability-exposure.js` es la única tabla de traducción. Recibe eventos `codex.upstream` normalizados por el adapter y produce estados con etiqueta, status, capability, metadatos acotados y una Activity opcional.

| Evento upstream | Estado de producto | Sincronización |
| --- | --- | --- |
| `thread.started`, `thread.resumed` | Thread nuevo o restaurado | Workspace, Task, Session |
| `turn.started`, `turn.completed` | Running o terminal | Execution y Turn |
| `plan.updated` | Plan con pasos upstream | UI y metadata de Execution |
| `command.started`, `command.completed` | Resumen de comando | UI y Activity |
| `fileChange.*` | Patch y archivos afectados | Artifact y Activity |
| `diff.updated` | Métricas y preview | Artifact versionado |
| `approval.*` | Waiting o decisión | UI, Turn y Execution |
| `webSearch.*` | Searching o Verified | UI y Activity |
| `mcp.*` | Tool activa o terminal | UI y Activity |
| `usage.updated` | Tokens del evento | UI y Execution |
| `warning`, `error`, compaction | Warning legible | UI y Activity |

Un evento desconocido no crea un estado inventado. Un plan sin pasos válidos no muestra placeholders.

### Capability Registry

El registry se deriva de `CodexStatus.appServer.capabilities`. No habilita capacidades por constantes locales. Publica:

- disponibilidad real de App Server;
- versión de Codex y protocolo;
- Streaming, Approvals, Diffs, Web Search, MCP, Planning, Commands y Usage;
- cantidad sanitizada de MCP servers conectados.

El registry no expone configuración MCP, auth, tokens, headers, cookies ni secretos. En Web permanece unavailable porque `/api/chat` no equivale a Codex App Server.

### Exposure Service

`UpstreamCapabilityExposureService` mantiene una proyección observable por conversación. `CodexConversationService` entrega cada evento a este servicio sin cambiar la respuesta pública del asistente. Una nueva ejecución limpia plan, command, tool, diff, patch, approval, web, usage y warnings transitorios anteriores.

## Estados de producto

Thread distingue `Active`, `Restored`, `Idle` y `Failed`. Turn y Execution usan `Running`, `Waiting`, `Completed`, `Cancelled`, `Failed` e `Interrupted`. Streaming sólo está activo entre output y un evento terminal.

Approvals nunca se resuelven mediante IPC crudo desde React. Electron Main conserva ownership y timeout en `ApprovalBroker`; Renderer responde a través de `ApprovalRuntimeService` y `ApprovalGateway`. El adapter devuelve `accept` únicamente después de una acción explícita; rechazar, expirar o cerrar la ventana devuelve rechazo seguro.

Web Search muestra `Searching Web...` durante el item y `Verified from Web` al completarse. Si la Execution termina antes que search, la proyección lo marca failed para impedir un spinner infinito.

## Activity y Execution

Workspace usa el mismo `mapUpstreamEventToProductEvent`; no contiene una segunda tabla de traducción. Las Activities relevantes incluyen:

- Started coding;
- Updated plan;
- Executed command o tests;
- Applied patch;
- Created diff;
- Verified from Web;
- Completed MCP tool;
- Approval requested;
- Codex warning.

Cada `executionId` conserva una sola `ExecutionReference`. Turn actualiza esa referencia, no crea otra Execution. Los eventos terminales limpian `activeExecutionId`, `activeCodexTurnId` y `activeCapability` sin alterar una ejecución concurrente distinta.

## Artifacts

Diff crea un Artifact por Execution y aumenta su versión. Persiste únicamente:

- archivos modificados;
- líneas agregadas y eliminadas;
- bytes;
- timestamp;
- preview redactado y acotado;
- indicador de truncado.

Patch conserva archivos, archivos generados, cantidad de cambios y status. Un generated file crea un Artifact con ruta y metadata, pero sin copiar contenido. El output final reutiliza el Artifact report existente del Workspace Runtime.

## Workspace

Task y Session conocen la Execution, Thread, Turn, capability y status activos. `getBootstrap().runtime.codex` permite restaurar este contexto sin consultar directamente App Server desde la UI.

## Seguridad y observabilidad

La frontera App Server elimina stdout de comandos y redacta diagnósticos, comandos, motivos, paths, diffs, warnings y errores. La Product Layer vuelve a aplicar redacción defensiva y límites. No se almacena el diff completo si ya vive upstream.

La observabilidad se relaciona por execution, thread y turn. Registra capability, provider/model cuando App Server los entrega, duración, token usage, resultado y error seguro. Nunca sintetiza métricas ausentes.

## Desktop y Web

Desktop muestra un indicador compacto del registry y una banda viva en el espacio existente del chat. Plan, approval, diff, web, MCP y usage sólo aparecen si existe estado upstream real.

Web comparte contratos y Application Services, pero no simula el registry de App Server. Su experiencia continúa usando el Trusted Assistant Runtime y Provider Runtime actuales sin indicadores upstream falsos.

## Extensión futura

Live Coding, Co-Coding, Context, Memory, MCP UI y colaboración deben consumir esta capa cuando necesiten estados heredados. Sólo podrán agregar comportamiento propio cuando represente una capacidad exclusiva de CoCreate; nunca deberán duplicar una capacidad disponible en Codex Upstream.

## Workspace Experience

Prompt #8 agrega `deriveActiveWorkState` al mapper central y una proyección de experiencia por encima de este servicio. Plan, command, tool, approval y estados terminales no se vuelven a clasificar en componentes. La implementación y sus límites están en `docs/workspace-experience-over-codex.md`.
