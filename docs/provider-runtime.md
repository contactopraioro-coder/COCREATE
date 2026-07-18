# Provider Runtime

## Objetivo

Provider Runtime es la frontera única entre CoCreate y proveedores de inteligencia, herramientas internas o servicios externos. Ningún componente de UI, Workspace Runtime ni Assistant Runtime selecciona o invoca directamente OpenAI, Codex, Gemini u otro proveedor.

```text
UI
  -> Application Services
  -> Trusted Assistant Runtime
  -> Provider Runtime
  -> Provider Adapter
  -> Provider o Tool
```

Web y Desktop comparten `shared/provider-runtime.js` y `shared/provider-runtime.d.ts`. Cada entorno registra adaptadores distintos sin cambiar la interfaz pública.

## Arquitectura

- `ProviderRuntime`: selecciona, ejecuta, limita por timeout, observa y mide.
- `ProviderRegistry`: registra adaptadores y expone enabled, health, capabilities y metadata.
- `ProviderSelection`: aplica prioridades por capability fuera del Assistant Runtime.
- `ProviderFactory`: construye adaptadores por id sin acoplar consumidores a clases concretas.
- `ProviderMetrics`: conserva métricas recientes y sanitiza secretos.
- `ProviderAdapter`: contrato único para ejecución, streaming, health, capabilities y metadata.

## Contrato

Cada adaptador declara:

- identidad estable (`id`, `name`);
- operaciones, por ejemplo `chat`, `completion`, `query`, `search` o `transcription`;
- dominios, por ejemplo `chat`, `coding`, `datetime`, `workspace` o `identity`;
- flags de streaming, tools, reasoning, multimodal y embeddings;
- `getHealth()`;
- `execute(request)`;
- `stream(request)` cuando declara streaming.

El registro rechaza adapters sin `id`, sin `execute`, sin operaciones/dominos o que anuncien streaming sin implementarlo.

## Registry

El registry puede responder qué providers existen, cuáles están habilitados, su estado y qué capabilities anuncian. Los adapters registrados actualmente son:

| Provider | Entorno | Estado funcional |
| --- | --- | --- |
| OpenAI | Servidor Web y gateway del renderer Web | Chat general, completion y transcripción |
| Codex | Desktop | Coding y streaming |
| Codex | Web/servidor | Contrato explícito `Unavailable`; nunca se sustituye por OpenAI |
| DateTime Tool | Web y Desktop | Query verificada |
| Workspace Tool | Web y Desktop | Query de contexto |
| Identity Tool | Web y Desktop | Query de identidad |
| System Tool | Web y Desktop | Query del sistema |
| Claude | Contrato futuro | Not Implemented |
| Gemini | Contrato futuro general | Not Implemented |
| Local Model | Contrato futuro | Not Implemented |
| Trusted Web Tool | API server y Electron Main | Search, Safe Fetch, grounding y citas |
| Memory Engine | Contrato futuro | Not Implemented |

Electron mantiene además `gemini-screen-analysis`, un adapter especializado que encapsula la capacidad de análisis de video preexistente. No habilita Gemini como proveedor general.

## Selection

`ProviderSelection` recibe operation y capability. La prioridad estricta por defecto es:

- chat general: OpenAI;
- coding: Codex;
- fecha, workspace, identidad y sistema: su tool local;
- web: `TrustedWebTool`; memory: contrato futuro;
- transcripción: OpenAI.

Solo se eligen providers habilitados, saludables y compatibles con operation/domain. Para `datetime`, `workspace`, `identity`, `system`, `web`, `coding` y `chat`, un provider fuera de la lista estricta queda descartado aunque anuncie una capability compatible. Si el provider requerido está ausente o no saludable, la respuesta es `Unavailable`; no se cambia de dominio para obtener una respuesta meramente aceptable.

La decisión conserva `requiredProvider`, `selectedProvider`, adapter, providers descartados, motivo y política de fallback. El Capability Router clasifica la solicitud; Provider Selection es la única capa que traduce esa capability a un provider.

## Routing Matrix

| Consultas obligatorias | Intent | Capability | Provider requerido | Resultado/confidence | Classification | Fallback |
| --- | --- | --- | --- | --- | --- | --- |
| ¿Qué día es hoy?; ¿Qué hora es?; ¿Qué fecha es?; What date is it today?; Hoy; Ahora; Zona horaria; Hora local; Fecha actual | `datetime-query` | `datetime` | `datetime-tool` | `Verified` | DateTime | Ninguno |
| ¿Qué proyecto tengo abierto?; ¿Cuál es mi tarea activa?; ¿Qué conversaciones existen?; ¿Qué workspace estoy usando? | `workspace-context` | `workspace` | `workspace-tool` | `Verified` | Workspace | Ninguno |
| ¿Cómo me llamo?; ¿Quién soy?; ¿Qué perfil uso?; ¿Qué dispositivo estoy usando? | `identity-context` | `identity` | `identity-tool` | `Verified` | Identity | Ninguno |
| ¿Qué sistema operativo uso?; ¿Cuál es mi carpeta de trabajo?; ¿Cuál es mi versión? | `system-context` | `system` | `system-tool` | `Verified` | System | Ninguno |
| Explícame React.; ¿Qué es TypeScript?; Haz un componente.; Escribe una API. | `coding` | `coding` | `codex` | `Estimated` si ejecuta; `Unavailable` si Codex no está saludable | Coding | Prohibido usar OpenAI |
| ¿Quién es el presidente de Colombia?; ¿Quién es el Papa?; ¿Qué pasó hoy con OpenAI?; Precio de Bitcoin.; Clima en Medellín.; Resultados deportivos recientes.; Noticias recientes.; Versión más reciente de React. | `current-information` | `web` | `web-tool` | `Verified`/`VerifiedWithConflict` con evidencia; `InsufficientEvidence` o `Unavailable` en fallo | Web | `unavailable-no-fallback` |
| ¿Qué es una zona horaria?; Explícame TCP/IP.; ¿Cómo funciona Git?; ¿Qué es GraphQL? | `general-knowledge` | `chat` | `openai` | `Estimated` si ejecuta; `Unavailable` si OpenAI no está saludable | General Knowledge | Prohibido usar Codex |

### Criterios de selección

1. El Capability Router separa datos internos, datos actuales, coding y conocimiento general antes de consultar providers.
2. Registry descarta providers deshabilitados o con health distinto de `Healthy`.
3. Provider Selection descarta adapters sin operation/domain compatible.
4. Los dominios estrictos descartan cualquier provider no autorizado con `provider-not-allowed:<domain>`.
5. La prioridad decide solo entre candidatos autorizados; actualmente las rutas obligatorias tienen un único provider válido.
6. Si no queda candidato, se conserva el provider requerido, `selectedProvider` queda `null` y la respuesta baja a `Unavailable`.

Las razones de descarte posibles incluyen provider explícito distinto, deshabilitado, health no saludable, operation no soportada, capability no soportada, provider no autorizado y menor prioridad. `tests/provider-routing-matrix.test.mjs` ejecuta cada consulta de la tabla y verifica intent, capability, provider, confidence, classification, selección y descarte.

## Health

Los únicos estados públicos son:

- `Healthy`;
- `Unavailable`;
- `Misconfigured`;
- `Rate Limited`;
- `Maintenance`.

Una credencial ausente produce `Misconfigured`; HTTP 429 produce `Rate Limited`; mantenimiento upstream puede producir `Maintenance`. Los placeholders futuros exponen `Unavailable` y `Not Implemented`, nunca una implementación simulada.

## Errores y timeout

`ProviderError` conserva code, provider, kind, health, safeMessage, retriable, requestId y status. Provider Runtime normaliza errores de red, autenticación, cuota, parsing, upstream y timeout. El timeout usa `AbortController` y se registra explícitamente en métricas.

Trusted Assistant Runtime transforma esos fallos en respuestas `Unavailable` sin inventar resultados ni exponer detalles internos en producción.

## Streaming

El contrato de streaming es `AsyncIterable`. El registry impide declarar `streaming: true` sin `stream()`. Codex puede producir `text-delta`; el consumidor no necesita conocer IPC, HTTP ni el formato del proveedor upstream.

## Observabilidad

Cada ejecución registra:

- request id;
- intent, capability y classification;
- provider requerido, provider elegido, adapter y tool;
- providers descartados y motivo;
- selection reason y fallback;
- confidence esperada y final;
- provider y modelo;
- duración;
- tokens/usage cuando existen;
- error normalizado;
- streaming;
- timeout;
- timestamp.

El observer no participa en la ruta crítica. `ProviderMetrics` redacta API keys, access/refresh tokens, passwords, authorization y secrets. No almacena prompts ni credenciales.

## Seguridad

- OpenAI vive únicamente en `api/_lib/providers/`.
- La clave especializada de análisis de video se lee únicamente en Electron main desde `GEMINI_API_KEY`.
- React, renderer y preload no reciben ni persisten API keys.
- La migración elimina del localStorage la clave histórica `caleidoscopio-gemini-api-key`.
- Los eventos y metadata pasan por sanitización antes de registrarse.

## Web y Desktop

Web server usa `createServerProviderRuntime`. Registra OpenAI, tools disponibles, `TrustedWebTool`, Codex `Unavailable` y contratos futuros. El navegador usa `createRendererProviderRuntime`; sus adapters actúan como gateways HTTPS hacia `/api/chat`, por lo que las claves nunca cruzan al cliente. Codex permanece explícitamente `Unavailable` en Web hasta que exista una integración segura real.

Desktop usa el mismo runtime compartido. El provider Codex llega por Application Services al `CodexAdapter`; Electron selecciona App Server como upstream primario y conserva `codex exec` solo como fallback pre-turn. Provider Runtime no conoce JSON-RPC, procesos, thread IDs ni decisiones de fallback interno. `TrustedWebTool` continúa disponible para respuestas públicas verificadas; la búsqueda heredada de Codex pertenece al agent runtime de coding y no se promociona automáticamente a citas verificadas. OpenAI permanece explícitamente `Unavailable` como chat general en Desktop. DateTime, Workspace, Identity y System se registran como adapters internos.

## Extensión futura

Para agregar un provider:

1. Implementar un adapter sin importar infraestructura en UI o Assistant Runtime.
2. Declarar capabilities reales, sin anunciar funciones todavía ausentes.
3. Implementar health y errores tipados.
4. Registrarlo mediante Provider Factory en el entorno seguro correspondiente.
5. Añadir prioridad en Provider Selection si la selección automática lo requiere.
6. Probar contrato, health, timeout, streaming y redacción de observabilidad.

Claude, Gemini general, Local Model, Memory Engine y embeddings permanecen fuera de alcance hasta una etapa posterior. La extensión de Trusted Web a más proveedores debe mantener Safe Fetch, grounding y citas compartidos.

## Model selection en Feature Parity v1

Provider Runtime mantiene selección por capability; el selector visual de coding no registra providers ni modelos hardcodeados. En Desktop consulta el catálogo oficial de Codex mediante `model/list` y pasa la elección al próximo Turn a través del adapter. En Web explica que ese catálogo local no está disponible. Attachments incompatibles se rechazan antes de llamar al provider y nunca se degradan silenciosamente a texto inventado.
# Parity v2: voz

Desktop registra `openai-transcription` como adapter de Provider Runtime en Electron Main. Web conserva el adapter server-side existente. Ambos normalizan health, timeout, rate limit y respuesta vacia; API keys y audio nunca entran en observabilidad. El renderer solo recibe texto, provider y modelo despues de una accion explicita del usuario.
