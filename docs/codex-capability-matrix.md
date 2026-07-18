# Codex Capability Matrix

Versión validada: Codex `0.134.0`, protocolo App Server v2, 16 de julio de 2026.

Clasificaciones: **Inherited** from Codex, **Wrapped** by CoCreate, **Extended** by CoCreate, **Owned** by CoCreate, **Unsupported** in current upstream y **Deferred**.

| Capability | CoCreate actual | Upstream | App Server oficial | Clasificación | Acción / fallback | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Agent loop | no se reimplementa | completo | threads/turns/items | Inherited | delegar; exec fallback | integration |
| Threads | Conversation local | persistentes | start/read/list | Wrapped | mapear IDs; exec sin paridad | contract/workspace |
| Turns | Execution local | nativos | start/completed | Wrapped | mapear Execution | adapter |
| Resume | nuevo | soportado | thread/resume | Wrapped | recrear solo si mapping stale antes del turn | adapter |
| History | mensajes locales | soportado | read/turns/list | Wrapped | cliente fino; UI futura | contract |
| Streaming | stdout exec | soportado | agent delta | Wrapped | conservar `execution.output` | adapter |
| Text output | soportado | soportado | agentMessage | Wrapped | fallback a item final | adapter |
| Reasoning summaries | ausente | soportado | summary delta/items | Wrapped | evento normalizado, sin chain-of-thought | contract |
| Plans | ausente | soportado | plan updated/delta | Wrapped | evento normalizado | contract |
| Commands | opacos en stderr | soportado | command items/output | Wrapped | metadata acotada | adapter |
| Shell output | stdout global | soportado | command output delta | Wrapped | `command.output` | adapter |
| Filesystem reads | harness exec | soportado | agent tools/items | Inherited | no duplicar tool | integration |
| File modifications | resultado opaco | soportado | fileChange items | Wrapped | evento + approval | adapter |
| Patches | ausente | soportado | patchUpdated | Wrapped | cambios normalizados | contract |
| Diffs | ausente | soportado | turn/diff/updated | Extended | artifact versionado | workspace |
| Approvals | tarjeta contextual segura | soportado | server requests | Extended | broker Main + gateway Renderer; deny seguro | adapter/broker/manual |
| Cancellation | SIGTERM | soportado | turn/interrupt | Wrapped | no exec mid-turn | adapter |
| Sandbox | workspace-write exec | soportado | thread sandbox | Wrapped | workspace-write | contract |
| Network | política CLI | soportado | permissions/approvals | Inherited | nunca autoaprobar | manual |
| Web search | Trusted Web propio | soportado | config + webSearch item | Inherited | Desktop coding lo hereda; exec fallback | integration |
| Citas/annotations | Trusted Web verificadas | no garantizado | sin garantía de URL verificable | Unsupported | no fabricar citas | contract |
| MCP servers | no visible | soportado | status/tools/progress | Wrapped | discovery sanitizado | process/contract |
| Native tools | tools CoCreate separados | soportado | item/tool call | Deferred | no simular dynamic tools | contract |
| Skills/instructions | parcial | soportado | config/skills | Inherited | heredar configuración upstream | integration |
| Model selection | catálogo y selector Desktop | soportado | model/list/turn override | Wrapped | aplicar modelo/effort al próximo Turn | contract/UI |
| Authentication | no bridge | soportado | account/read/login | Wrapped | health sanitizado; login UI futura | process |
| Configuration | env CoCreate | soportado | config APIs/thread config | Wrapped | solo overrides seguros; nunca raw config | lint |
| Usage/tokens | métricas provider | soportado | tokenUsage updated | Wrapped | evento normalizado | contract |
| Errors | normalizados | soportado | error/turn error | Extended | safeMessage + upstream code | adapter |
| Retry/restart | por ejecución | proceso reiniciable | lifecycle externo | Owned | retry acotado del proceso, no del turn | process |
| Context compaction | ausente | soportado | compacted/item | Wrapped | evento, no motor propio | contract |
| Images/attachments | tray seguro Desktop | superficie parcial | image/localImage/mention input | Wrapped | broker opaco Main; validar antes del Turn | contract/UI |
| Git metadata | contexto compacto | soportado | Thread.gitInfo/comandos | Extended | consulta local redactada; Web lo declara ausente | contract/UI |
| Worktrees | no implementado | core puede operar | sin wrapper dedicado v1 | Deferred | no simular | manual |
| Multi-thread paralelo | chats múltiples | soportado | IDs independientes | Wrapped | maps por thread/turn | adapter |
| Remote/cloud execution | Web usa API actual | superficie local App Server | sin worker CoCreate | Deferred | Web sin cambios | web tests |
| Workspace Experience | context bar, Active Work, Artifacts y Activity | eventos técnicos | threads/turns/items | Extended | proyección de producto; no reimplementar upstream | workspace/experience |

## Resumen

- Inherited: agent loop, filesystem/tool behavior, network policy, search, skills.
- Wrapped: protocolo, threads, turns, streaming, commands, MCP, auth y usage.
- Extended: ownership Workspace, artifacts de diff, activities, errores y approvals nativas.
- Owned: UI, dominio CoCreate, persistencia y policy de fallback/restart.
- Unsupported: citas/annotations verificables garantizadas por App Server `0.134.0`.
- Deferred: dynamic tools, worktrees, Plan Mode experimental, scheduled tasks, sites y ejecución cloud.

## Paridad de producto v1

La navegación y disponibilidad se centralizan en `FeatureParityService`; no se infieren dentro de componentes. Nueva tarea y Chat están disponibles. Programados queda Unsupported por no existir una surface estable fijada, Sitios queda Deferred, Pull requests requiere autenticación y Complementos expone sólo MCP discovery estable. La matriz completa y evidencia están en `docs/codex-feature-parity-v1.md`.

## Delta de paridad v2

Plan Mode, Skills y Plugins se revalidaron como experimentales en `0.134.0` y ahora viven detras de Stability Layer, version exacta y flags. Plan/Default se aplican mediante collaboration mode real; Skills usan input upstream con tokens opacos; Plugins permanece read-only. MCP conserva inventario estable y agrega lifecycle experimental normalizado. Scheduled Tasks, GitHub/PRs y Sites siguen Unsupported/Deferred porque no se encontro una surface oficial suficiente. La matriz no interpreta discovery como autenticacion.

## Evidencia real 10.1

- App Server, Turns, streaming, commands/tools, diffs, Artifacts, approvals, Web Search y restore: pass real.
- Plan/Default: pass con `plan.delta`, scope por Task y restore despues de reinicio.
- Skills: pass con catalogo real y token opaco one-use.
- MCP: cinco servidores y 137 tools sanitizadas; inventario recuperado despues de reiniciar App Server.
- Web/navigation/context/composer: pass funcional; teclado fisico pendiente.
- Voice/picker/drag-and-drop: implementados y cubiertos por tests, pero no certificados fisicamente; bloquean el cierre.

La matriz de evidencia completa vive en `docs/codex-feature-parity-v2-certification.md`.
