# Codex Feature Parity v2

Version validada: Codex `0.134.0`, App Server v2, 16 de julio de 2026.

## Resultado de arquitectura

```text
Codex App Server
  -> UpstreamStabilityAdapter
  -> IPC Main con tokens opacos
  -> UpstreamStabilityService / FeatureParityService
  -> Navigation y Composer CoCreate
```

React no conoce metodos raw del App Server, configuracion MCP, paths de Skills ni secretos. La disponibilidad visible se obtiene de version, descriptor de estabilidad, entorno, autenticacion y feature flags centralizadas. Un fallo experimental se contiene en su catalogo y no deshabilita Chat, Workspace ni las tools locales.

## Surfaces revalidadas

| Area | Surface | Estabilidad | Estado CoCreate v2 |
| --- | --- | --- | --- |
| Threads, Turns, streaming, approvals, diffs, plans emitidos | App Server v2 fijado | Stable | Inherited / Wrapped |
| Modelos y reasoning | `model/list`, overrides de `turn/start` | Stable | Wrapped |
| MCP inventory | `mcpServerStatus/list` | Stable | Wrapped, sanitizado y resiliente |
| Plan Mode | `collaborationMode/list`, `collaborationMode` | Experimental | Habilitado solo en Desktop 0.134.0 exacto |
| Skills | `skills/list`, `skills/changed`, input `skill` | Experimental | Catalogo y seleccion por Turn con token opaco |
| Plugins | `plugin/list` | Experimental | Catalogo read-only; sin marketplace ni config write |
| MCP startup updates | `mcpServer/startupStatus/updated` | Experimental | Actualiza ready/failed sin recargar la app |
| Scheduled Tasks | Sin surface encontrada | Unsupported | Route honesta; sin scheduler propio |
| GitHub / Pull Requests | Sin surface GitHub-specific | Unsupported sin connector seguro | Authentication required; flag forzado off |
| Sites | Sin surface de deployments/hosting | Deferred | Empty state honesto; sin hosting paralelo |

El manifiesto mantiene por separado los 35 metodos estables y cinco metodos/eventos experimentales. La verificacion de CI genera el contrato oficial con `--experimental` y falla si una surface fijada desaparece.

## Stability y flags

Los descriptores viven en `shared/upstream-stability.js`. Los defaults experimentales se activan solo cuando Desktop reporta contrato compatible y version exacta `0.134.0`; cualquier mismatch los apaga. Scheduled Tasks y GitHub permanecen desactivados aunque exista un override, porque no hay contrato seguro implementado.

| Flag | Default seguro |
| --- | --- |
| `experimentalUpstream` | Desktop + version exacta |
| `planMode`, `skills`, `plugins` | Desktop + contrato exacto |
| `scheduledTasks`, `githubIntegration` | Disabled |
| `nativeVoice` | Enabled cuando el dispositivo y provider responden |
| `nativeFilePicker` | Desktop only |

Los overrides `COCREATE_FEATURE_*` se resuelven en Main y nunca dependen solo de `localStorage`. Desactivar una capability conserva su route y muestra una razon especifica.

## Plan, Skills y Complementos

Plan Mode es un preset de colaboracion upstream con scope de thread: el App Server lo aplica al Turn actual y a los siguientes hasta recibir Default. CoCreate guarda la seleccion explicita por Task para restaurar UX, vuelve a enviarla al siguiente Turn y permite salir; no genera planes ni lo mezcla con Goals.

Skills se deduplican por scope y nombre. La UI recibe nombre, descripcion acotada, scope, source, enabled y un token temporal; el path permanece en Main, pertenece a una ventana, expira y se consume una vez. No cruzan prompts internos, system instructions ni contenido de `SKILL.md`.

Complementos distingue tres dominios: Skills experimentales seleccionables, MCP servers/tools estables y Plugins experimentales de solo lectura. Incluye busqueda, filtros, provider, estado, auth normalizada, tool count, version y errores. No ofrece instalar, desinstalar o editar configuracion porque upstream no publica ese contrato fijado.

## Voz y adjuntos

Voice usa `VoiceService` como maquina de estados: inspect, permission, device, requesting, recording, transcribing, cancel, disconnect, timeout y error. `getUserMedia` solo se llama por accion explicita; tracks y listeners se liberan al detener/cancelar. El audio vive en memoria hasta transcripcion y el API key permanece en Main o Vercel.

Desktop File Picker usa `dialog` en Main y devuelve tokens opacos. Valida allowlist, 20 MB, archivo no vacio, inexistencia, symlink, duplicados, maximo ocho items, ownership, expiracion, remove y consumo unico. Drag-and-drop obtiene el path mediante preload; React no lo recibe. Web no simula paths o carpetas locales mientras el gateway web no tenga un contrato de attachment seguro.

## Producto y entornos

Las seis routes siguen operativas: Nueva tarea, Programados, Complementos, Sitios, Pull requests y Chat. El contexto principal conserva `Project · Task`; Git, runtime, Plan y ejecucion aparecen de forma compacta o progresiva. Desktop expone App Server, Git, MCP, Plan, Skills, voz y picker segun disponibilidad. Web mantiene Chat, Workspace, Identity, DateTime y voz del navegador, pero declara Desktop only para filesystem y MCP local.

## Resiliencia, seguridad y diagnostico

- Reinicio, method-not-found, payload malformado y fallo MCP se normalizan sin fallback silencioso de una ejecucion ya iniciada.
- La fotografia local registra capability, source, stability, enabled, environment, auth, last error, upstream version y flag; no envia telemetria externa.
- No se registran prompts, audio, archivos, tokens, secrets, config raw, system prompts ni chain-of-thought.
- No se infiere autenticacion GitHub por detectar un MCP llamado GitHub.
- Las URLs externas solo podran publicarse cuando una integracion real las entregue y las valide.

## Deuda conocida

No bloqueante: Plan, Skills, Plugins y startup updates dependen del contrato experimental pinneado; Web no envia attachments; GitHub/PRs, Scheduled Tasks y Sites esperan surfaces oficiales. Realtime voice, marketplace, scheduler, hosting y cliente GitHub permanecen fuera de alcance.

La salida hacia Live Coding depende de gates reales de Desktop/Web, no de convertir estas capabilities opcionales en runtimes propios.

## Certificacion real 10.1

El gate del 16 de julio de 2026 reemplaza la evidencia anterior limitada por sandbox. Quedaron aprobados build Desktop fresco, smoke, App Server real, Turn, streaming, tools, diffs, Artifacts, approvals, Plan, Skills, MCP, Web Search, restore, reinicio con continuidad, Web y las seis routes. La suite reporto 167 tests: 166 pass, cero fail y un integration probe opcional skipped.

La revision visual encontro y corrigio un recorte del boton de tema a 390 px; el retest movil paso sin overflow. Permanecen bloqueantes la grabacion/transcripcion fisica, picker nativo, drag-and-drop fisico y teclado fisico. El detalle reproducible, matriz y checklist humana estan en `docs/codex-feature-parity-v2-certification.md`.

**Veredicto vigente:** `PROMPT #10 INCOMPLETO`.

**Recomendacion vigente:** `REMAIN IN FEATURE PARITY`. No agregar mas capabilities; completar unicamente los gates fisicos pendientes.
