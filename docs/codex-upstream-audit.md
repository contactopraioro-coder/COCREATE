# Codex Upstream Audit

## Alcance y fecha

Auditoría realizada el 16 de julio de 2026 antes de integrar App Server. Se inspeccionaron los runners, contratos, IPC, Application Services, Workspace, Provider Runtime, Trusted Assistant, Trusted Web, pruebas, scripts, packaging y smoke tests de CoCreate.

## Upstream instalado

| Dato | Evidencia |
| --- | --- |
| Versión exacta | `codex-cli 0.134.0` |
| Binario resuelto | `~/.local/bin/codex` |
| Distribución | symlink a standalone release `0.134.0-aarch64-apple-darwin` |
| Arquitectura | Mach-O arm64 sobre host arm64 |
| SHA-256 | `9c412eba7f46728e971eb8c25cf44b37b918b470848f509474eb91f8ff19b98f` |
| App Server | disponible, experimental |
| Transporte probado | `stdio://`, JSON Lines bidireccional |
| Protocolo integrado | App Server v2 generado por el binario oficial |
| Autenticación | sesión ChatGPT configurada; API key no almacenada por CoCreate |
| Modelo observado | `gpt-5.4` en la configuración upstream auditada |
| Sandbox observado | filesystem/network restringidos, approvals `OnRequest` |
| MCP observado | servidores configurados; el runtime solo publica el conteo sanitizado |

El binario no procede de npm ni está vendorizado en CoCreate. `codex app-server --help` confirma `stdio://` por defecto y los generadores oficiales `generate-ts` y `generate-json-schema`. La generación usada por contract tests incluye `--experimental` porque las aprobaciones y parte de la superficie consumida están marcadas así en `0.134.0`.

## Handshake y protocolo real

El handshake real probado fue:

```text
spawn codex app-server --listen stdio://
-> initialize(clientInfo, capabilities)
<- userAgent, codexHome, platformFamily, platformOs
-> initialized
-> account/read
-> mcpServerStatus/list
```

La comunicación no usa el campo `jsonrpc`; App Server `0.134.0` intercambia objetos JSON delimitados por newline. El inventario generado confirmó threads, turns, history, streaming, commands, file changes, diffs, approvals, web search items, MCP, account, config, usage, compaction, cancellation y server requests bidireccionales.

CoCreate no llama `config/read`: la auditoría demostró que esa respuesta contiene rutas, identidad y configuración privada. Main solo conserva estado sanitizado de auth, versión, web mode y cantidad de servidores MCP.

## Capability Inventory

App Server expone `thread/start`, `thread/resume`, `thread/read`, `thread/list`, `thread/turns/list`, `turn/start`, `turn/interrupt`, deltas de mensajes, planes y reasoning summaries, items de comandos/files/MCP/web, `turn/diff/updated`, usage y compaction. También solicita aprobaciones de comando, cambios, permisos, input y elicitation MCP.

La búsqueda upstream está disponible mediante la configuración `web_search` y produce items `webSearch`. La versión auditada no garantiza un contrato de citas verificadas equivalente a Trusted Web; por ello CoCreate no fabrica URLs ni clasifica esas salidas como citas verificadas.

## CoCreate antes de la migración

Los caminos existentes eran:

```text
Desktop UI -> Application Service -> DesktopCodexAdapter -> IPC -> shared/codex-runner.js -> codex exec
Web UI -> WebCodexAdapter -> /api/chat
legacy codex:run -> collectExecutionOutput -> shared/codex-runner.js -> codex exec
```

Cada ejecución Desktop creaba un proceso `codex exec`, transmitía stdout como texto, stderr como progreso y cancelaba con `SIGTERM`. Workspace asociaba `ExecutionReference` con Task/Conversation y generaba un artifact de resultado, pero no conocía thread/turn upstream, approvals, diffs, tools ni MCP.

## Reutilización y duplicación

Se reutilizan sin rediseño:

- `CodexAdapter`, contratos `execution.*`, Application Services y Desktop IPC;
- ownership por ventana y cancelación al destruir Renderer;
- Workspace `ExecutionReference`, Artifact y Activity;
- `shared/codex-runner.js` como fallback explícito;
- packaging `shared/**/*` e `infrastructure/**/*`.

La duplicación temporal es el harness de `codex exec`. No se elimina hasta validar paridad operativa; queda aislado detrás de `CODEX_RUNTIME_MODE=exec|auto` y no puede activarse después de iniciar un turn App Server.

## Riesgos de migración

- App Server es experimental y su protocolo puede cambiar entre versiones.
- Un thread persistido puede quedar stale si se elimina su rollout upstream.
- Una caída a mitad de turn no puede reintentarse sin riesgo de doble acción.
- Las aprobaciones y permisos tienen contratos distintos; solo comando/file muestran diálogo nativo en v1.
- App Server hereda auth, MCP y configuración del usuario; esos datos no deben llegar a Renderer o logs.
- El binario es externo y debe existir también en la máquina que ejecuta la app empaquetada.

## Estrategia y rollback

CoCreate fija exactamente `0.134.0`, regenera contratos oficiales en `npm run codex:app-server:contract`, inicia un único proceso persistente y mantiene el contrato visual existente. En `auto`, el fallback a exec ocurre solo si health falla antes de ejecutar. En una regresión se fuerza `CODEX_RUNTIME_MODE=exec`, se restaura el binario validado y se ejecutan contract, integration, build y smoke tests. No se migra automáticamente a `latest`.
