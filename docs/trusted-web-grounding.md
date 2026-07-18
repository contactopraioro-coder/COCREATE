# Trusted Web Grounding & Citation Runtime v1

## Objetivo

Trusted Web permite verificar información pública y cambiante sin convertir CoCreate en un navegador autónomo. Una búsqueda produce candidatos; solo el contenido recuperado mediante Safe Fetch puede convertirse en evidencia o cita.

Regla central: ninguna afirmación actual puede ser `Verified` sin fuentes recuperadas, evidencia, citas válidas y `verifiedAt`.

## Arquitectura

```text
UI
  -> AssistantRuntimeService
  -> Trusted Assistant Runtime
  -> Provider Runtime
  -> TrustedWebTool
  -> WebSearchProviderPort / Safe Web Fetch
  -> Grounding Bundle
  -> Evidence-only synthesis
  -> Trusted Response + Citations
```

Responsabilidades:

- Shared: contratos, errores, grounding, citas, síntesis y orquestación limitada.
- Provider Runtime: selección estricta de `web-tool`, timeout, request ID, métricas y health.
- Infrastructure: Brave Search, Safe Web Fetch y síntesis OpenAI limitada a evidencia.
- Electron Main: credenciales, ejecución, IPC, cancelación y Activity.
- API: credenciales, rate limit, tamaño de request, cancelación y respuesta normalizada.
- Renderer: gateway seguro y render mínimo de citas; nunca conoce credenciales ni adapters concretos.

## Contratos

`shared/trusted-web-contracts.js` define:

- `TrustedWebSearchInput` y `TrustedWebSearchResult`;
- `TrustedWebFetchInput` y `TrustedWebFetchResult`;
- `GroundingSource`, `GroundingEvidence`, `GroundingConflict` y `GroundingBundle`;
- `Citation` y `TrustedWebAnswer`;
- errores normalizados y validación de citas.

`TrustedWebTool` soporta `search`, `fetch`, `answer`, timeout, `AbortSignal`, request ID, correlation ID, health, límites y metadata serializable. No depende de React, Electron, Vercel, OpenAI ni un buscador concreto.

## Proveedor

El adapter inicial usa Brave Search API detrás de `WebSearchProviderPort`. Se eligió por resultados estructurados, índice propio, filtros de actualidad, API estable, integración HTTP simple y compatibilidad con Node/Vercel/Electron Main.

La [referencia oficial de Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/get) documenta autenticación mediante `X-Subscription-Token`, query máxima de 400 caracteres/50 palabras, `count`, `safesearch`, país, idioma y freshness `pd`, `pw`, `pm`, `py`.

A 16 de julio de 2026, el [pricing oficial](https://api-dashboard.search.brave.com/documentation/pricing) indica USD 5 por 1.000 requests, USD 5 de crédito mensual y capacidad de hasta 50 requests por segundo para Search. Estos valores son externos y deben revisarse antes de decisiones comerciales.

No existe fallback a otro proveedor en v1. `SEARCH_PROVIDER=brave` documenta la selección. Si falta `BRAVE_SEARCH_API_KEY`, health devuelve `Misconfigured`; nunca se simulan resultados.

## Search

La entrada valida query, longitud, locale, timezone, país de dos letras, freshness, dominios y límites. No acepta Identity ID, Workspace ID, rutas locales ni conversaciones. El Assistant Runtime no envía historial al Web Tool.

El resultado normaliza URL, dominio, snippet, `publishedAt`, `retrievedAt`, rank, provider, status y request ID. Los parámetros de tracking conocidos se eliminan sin modificar host o path. Un resultado sigue siendo candidato, no evidencia.

## Safe Fetch y SSRF

Safe Fetch usa HTTP/HTTPS de Node, no navegador y no JavaScript. Antes de cada request y redirect:

- bloquea `file:`, `ftp:`, `data:`, `javascript:` y protocolos distintos de HTTP/HTTPS;
- bloquea credenciales embebidas y puertos no estándar;
- bloquea localhost, `.local`, metadata endpoints, loopback, privadas, link-local, multicast y rangos reservados IPv4/IPv6;
- resuelve todos los registros DNS y rechaza el host si alguno no es público;
- fija el socket a una IP pública validada para reducir DNS rebinding;
- revalida cada redirect y limita su cantidad;
- no envía cookies, authorization ni credenciales personales;
- solicita encoding identity, limita bytes, texto, tiempo y tipos MIME;
- rechaza binarios y no ejecuta scripts.

HTML se reduce a texto: scripts, styles, templates, iframes, SVG y comentarios se eliminan. `statusCode`, URL final, tipo, bytes, redirects, `retrievedAt`, truncación y warnings quedan trazados.

## Grounding y fuentes

La selección inicial prioriza fuentes oficiales/primarias, standards, papers, medios reconocidos y luego fuentes secundarias. Combina autoridad, fecha y rank; no toma automáticamente el primer resultado.

Una fuente solo entra al `GroundingBundle` después de Safe Fetch. La evidencia conserva source ID, excerpt sanitizado, fecha de recuperación, fecha de publicación disponible y reliability inicial. No se almacena la página completa en mensajes o Activity.

`Verified` requiere una fuente oficial/primaria o al menos dos dominios independientes con evidencia. Sin ese soporte, el resultado es `InsufficientEvidence` y el Assistant Runtime reemplaza cualquier afirmación actual por una explicación honesta.

## Freshness y conflictos

La intención aplica una política simple:

- noticias, precios y estado actual: `today`;
- versiones y resultados recientes: `week`;
- cargos públicos actuales: `today`;
- otras consultas cambiantes: `month`.

Brave traduce esos valores a sus filtros oficiales. `publishedAt` mejora prioridad cuando existe, pero su ausencia no fabrica una fecha.

Los conflictos del sintetizador se aceptan solo con dos source IDs recuperados. También se detectan versiones divergentes. Un conflicto material produce `VerifiedWithConflict`; se conserva la descripción y la UI lo indica. Nunca se inventa consenso.

## Citas

Una cita requiere source ID, título, URL HTTP/HTTPS, dominio coincidente, `retrievedAt` y relación con evidence IDs. `buildCitations` solo usa fuentes presentes en el bundle. La normalización de síntesis descarta source IDs desconocidos y elimina URLs emitidas por el modelo.

La UI vuelve a validar cada cita antes de renderizar. Los enlaces usan `target="_blank"` y `rel="noopener noreferrer"`. No se renderiza `javascript:`, una URL inventada o una cita sin evidencia.

## Síntesis y prompt injection

La síntesis recibe secciones separadas de System Instructions, User Request y Grounding Evidence. El texto recuperado se marca `UNTRUSTED_WEB_CONTENT` y nunca se incorpora como system prompt.

Las instrucciones exigen usar solo evidencia, no agregar datos actuales, nombres, fechas, URLs o citas, no revelar chain-of-thought ni secretos y reportar conflictos. Patrones como `ignore previous instructions`, `reveal API key`, `execute command`, `upload files` o `change system prompt` se detectan y eliminan de evidence excerpts.

Si la síntesis falla, un resumen determinista puede presentar excerpts recuperados. Las mismas guardas de confidence siguen aplicando; un fallback no convierte evidencia débil en `Verified`.

## Privacidad

Web recibe únicamente query, locale opcional, timezone opcional, country hint no preciso, freshness e intent. No recibe identidad, workspace, conversación, rutas, archivos ni historial privado. La tool no inicia sesión, no usa cookies personales y no accede a páginas autenticadas.

Las claves existen solo en API server o Electron Main. React, renderer, preload, localStorage, respuestas, métricas y Activity no contienen `BRAVE_SEARCH_API_KEY` ni `OPENAI_API_KEY`.

## Desktop

```text
Renderer -> Trusted Web gateway -> Secure IPC -> Electron Main -> Provider Runtime -> TrustedWebTool
```

Los canales tipados son status, execute y cancel. Cada request pertenece a una ventana. Main crea un `AbortController`, cancela al cerrar la ventana, rechaza request IDs duplicados, normaliza errores y limpia listeners/mapas. Electron Main carga `.env` y `.env.local`; preload solo expone métodos IPC.

## Web y Vercel

```text
Renderer -> /api/chat -> Server Provider Runtime -> TrustedWebTool
```

`api/chat.ts` limita tamaño, prompt, historial y requests por cliente mediante un rate limit in-memory best-effort. El evento `aborted` del request cancela Provider Runtime, search, fetch y síntesis. Vercel debe tener `BRAVE_SEARCH_API_KEY` y `OPENAI_API_KEY` cifradas; ninguna se devuelve al navegador.

El rate limit in-memory no es global entre regiones o instancias. Un store distribuido es deuda futura si el volumen o el riesgo de abuso crecen.

## Activity y Execution

Cada consulta registra requestedBy, performedBy, tool, provider, status, timestamps, duration, sources count, `verifiedAt`, confidence y error seguro. Activity produce mensajes humanos para started/completed/failed/cancelled. No guarda páginas completas y una respuesta puntual no genera Artifact.

## Errores

Los códigos públicos incluyen configuración, auth, rate limit, timeout, red, payload inválido, cero resultados, URL bloqueada, tipo no soportado, exceso de tamaño, parse, evidencia insuficiente, proveedor no disponible y cancelación. Producción solo expone `safeMessage` y code; desarrollo conserva provider, request ID, status y causa en el runtime seguro.

## Límites

Defaults de v1:

- una búsqueda por respuesta;
- cuatro fuentes/fetches, máximo configurable de seis;
- 512 KB por fuente, máximo de 1,5 MB;
- 80.000 caracteres de texto útil;
- 8 segundos por fetch;
- 30 segundos totales;
- tres redirects;
- sin loops, crawling o navegación autónoma.

Variables: `BRAVE_SEARCH_API_KEY`, `SEARCH_PROVIDER`, `TRUSTED_WEB_TOTAL_TIMEOUT_MS`, `TRUSTED_WEB_FETCH_TIMEOUT_MS`, `TRUSTED_WEB_MAX_SOURCES`, `TRUSTED_WEB_MAX_FETCHES`, `TRUSTED_WEB_MAX_BYTES`, `TRUSTED_WEB_MAX_REDIRECTS`, `CHAT_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_WINDOW_MS` y `CHAT_MAX_BODY_BYTES`.

## Testing

La suite cubre routing, provider, search, health, auth, rate limit externo, timeout, cancelación, SSRF, DNS rebinding, redirects, bytes, MIME, HTML, truncación, grounding, freshness, conflictos, citas, URLs inventadas, prompt injection, Activity, persistencia y regresiones de Assistant/Workspace/Identity/DateTime/Codex.

Lint impide claves o endpoints de Brave en renderer/preload, imports de adapters concretos desde UI, acceso directo de UI al IPC, `FutureWebTool` activo, proveedor concreto dentro del dominio y citas sin validación en la experiencia principal.

## Deuda futura

- rate limit distribuido para producción de alto tráfico;
- cache controlado por query/freshness para reducir coste;
- segundo search provider con fallback explícito y probado;
- extracción específica por tipo de fuente, sin navegador general;
- detección semántica de conflictos más profunda;
- métricas agregadas y alertas de cuota.

No forman parte de v1: browser agent, cookies, login, formularios, crawling, compras, navegación visual, investigación autónoma multi-step, Memory Engine o Marketplace.
