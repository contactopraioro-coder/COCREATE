# Codex App Server Integration

## Arquitectura

```text
Renderer UI
-> Application Services / CodexAdapter
-> typed Electron IPC
-> CodexRuntimeAdapter
-> CoCreate App Server Adapter
-> CoCreateCodexClient
-> JSON-RPC Client
-> CodexAppServerProcessManager
-> codex app-server (0.134.0)
```

Renderer no conoce procesos, stdio, JSON-RPC, auth, MCP ni configuración upstream. Web conserva `/api/chat`; este corte es Desktop-first.

## Lifecycle y health

Main crea un manager por aplicación. Sus estados son `stopped`, `starting`, `initializing`, `ready`, `degraded`, `restarting`, `failed` y `stopping`. Valida la versión exacta antes de spawn, hace handshake, descubre auth/MCP de forma sanitizada y aplica restart con backoff acotado. `before-quit`, cierre de ventana y smoke test llaman `dispose`; SIGTERM escala a SIGKILL tras el grace period.

Health solo es available cuando proceso, protocolo, versión y autenticación son válidos. Nunca expone tokens, email, rutas de configuración ni el resultado de `config/read`.

## JSON-RPC y protocolo

`CodexAppServerJsonRpcClient` implementa JSONL bidireccional sobre stdio: IDs crecientes, pending map, timeout, AbortSignal, backpressure, tamaño máximo, notifications, server requests, errores y cleanup. Mensajes desconocidos se observan; JSON inválido se reporta sin inventar respuestas.

La integración está pinneada a Codex `0.134.0`, App Server v2. `npm run codex:app-server:contract` regenera TypeScript oficial con `codex app-server generate-ts --experimental` y verifica el manifest mínimo. Los tipos runtime delgados no reemplazan al esquema oficial; el test evita drift.

## Cliente, threads y turns

`CoCreateCodexClient` ofrece status, create/resume/read/list thread, list turns, start/interrupt turn, account y MCP. La UI solo consume `CodexAdapter`.

Cada Conversation conserva `codexThreadId`, runtime/protocol y fecha de mapping. Task conserva `primaryCodexThreadId`. Al reabrir un chat se intenta `thread/resume`; un mapping realmente stale se reemplaza antes de iniciar turn. Cada Execution mapea un `codexTurnId`. No hay reintento ni fallback después de `turn/start`.

## Event Bridge

Texto sigue usando `execution.output` para compatibilidad. El resto cruza un sobre `codex.upstream` con versión, execution/thread/turn y datos acotados:

- `thread.started|resumed|statusChanged|compacted`;
- `turn.started|completed`, `plan.updated|delta`, `reasoning.summaryDelta`;
- `command.started|completed|output`;
- `fileChange.started|completed|patchUpdated`;
- `diff.updated`;
- `mcp.started|completed|progress`;
- `webSearch.started|completed`;
- `usage.updated`, `runtime.warning|error`;
- `approval.requested|resolved`.

Workspace persiste referencias y metadata, no streams completos. Un diff crea un único artifact por Execution y aumenta su versión; solo se conservan archivos, líneas agregadas/eliminadas, preview acotado y byte count. El output de comandos no cruza el Event Bridge.

## Approvals, commands y seguridad

Requests de command y file change entran a `ApprovalBroker` en Electron Main. El broker envía una solicitud redactada al renderer propietario y espera una decisión explícita a través de IPC dedicado. Timeout, cierre, respuesta stale, renderer ajeno y doble respuesta rechazan de forma segura; no hay auto-approval. El gate Desktop cubre una decisión reject y una approve reales, verificando efectos sobre un probe temporal. User input y MCP elicitation se rechazan de forma segura en v1; permisos adicionales reciben un perfil vacío de alcance turn. Dynamic tools y auth refresh no se simulan.

Comandos, cwd, estado y exit code se normalizan; secrets no se registran. Renderer no importa `node:child_process`, infrastructure App Server ni métodos raw. El lint protege estas fronteras.

## Search, MCP, auth y config

El thread recibe `config.web_search=live|cached|disabled` desde `CODEX_WEB_SEARCH_MODE`. Search es heredado y observable mediante items `webSearch`; las citas no se consideran verificadas si upstream no entrega URLs/annotations válidas. MCP se descubre con `mcpServerStatus/list` y solo se publica el conteo. Auth se descubre con `account/read`. CoCreate no ejecuta `config/read`; solo envía overrides seguros por thread.

## Fallback

`CODEX_RUNTIME_MODE` admite:

- `app-server`: exige App Server, sin fallback;
- `exec`: fuerza el adapter legacy;
- `auto`: App Server primario y exec solo si health falla antes de execute.

Nunca se cambia de runtime dentro de un turn. Esto evita doble respuesta, doble comando y doble modificación de archivos.

## Packaging, tests y actualización

Electron empaqueta `infrastructure/**/*` y `shared/**/*`; el binario Codex sigue siendo dependencia externa. Los assets del renderer son relativos para funcionar desde `file://` y los procesos empaquetados usan `userData` como cwd válido en vez de `app.asar`. El smoke verifica bridge, renderer real y health sin ejecutar un turn pagado. La integración real hace handshake/auth/MCP y requiere un entorno con sesión Codex válida.

Proceso de actualización:

1. Detectar versión candidata y leer changelog oficial.
2. Generar y diferenciar protocolo.
3. Actualizar versión pinneada y manifest.
4. Ejecutar contract, unit e integration tests.
5. Revisar capability matrix.
6. Validar build, packaging y smoke.
7. Promover con `auto`; conservar `exec` para rollback.

No seguir `latest` automáticamente. Web containerizado, Cloud worker, MCP UI, Memory, Live Coding y Co-Coding permanecen fuera de alcance.

La experiencia de Workspace que consume estos estados se documenta en `docs/workspace-experience-over-codex.md`.

## Feature Parity v1

La Product Layer consume `model/list` para poblar el selector y aplica `model`, reasoning effort e inputs oficiales al siguiente `turn/start`. Los archivos no cruzan como paths raw: Electron Main emite tokens opacos por ventana y los resuelve a `localImage` o `mention` sólo al enviar.

El contrato experimental generado se usa únicamente para auditar skills, plugins, realtime, collaboration mode y goals. Esas surfaces no se anuncian como estables ni se incorporan al manifest fijado sin un ciclo explícito de actualización. Programados y Sitios no se simulan. Ver `docs/codex-feature-parity-v1.md`.
# Feature Parity v2

El contrato fijado separa 35 metodos estables de las surfaces experimentales `collaborationMode/list`, `skills/list`, `plugin/list`, `skills/changed` y `mcpServer/startupStatus/updated`. `UpstreamStabilityAdapter` es el unico modulo que conoce esos nombres. Version mismatch, method-not-found y errores experimentales desactivan solo la capability opcional; el proceso, los Turns estables y Chat permanecen disponibles.

Los inputs `localImage`, `mention` y `skill` se resuelven en Main desde tokens temporales ligados a la ventana. `turn/start` recibe model, effort y collaboration mode desde servicios de aplicacion; React no construye requests App Server raw.
