# Trusted Assistant Runtime v1

## Objetivo

El Trusted Assistant Runtime v1 evita que CoCreate improvise datos actuales, contexto del workspace, identidad o referencias no verificadas. Desktop y Web consumen el mismo runtime de decisión para reducir diferencias de comportamiento.

## Arquitectura

```text
UI
  ->
Application Services
  ->
Assistant Runtime
  ->
Tool Runtime
  ->
Trusted Response
```

Capas principales:

- `AssistantRuntimeService`: punto de entrada desde la aplicación.
- `IntentService`: analiza la intención del prompt.
- `CapabilityRouter`: decide qué capability lidera la respuesta.
- `Tool Router`: ejecuta la herramienta mínima necesaria.
- `TrustedResponseService`: construye respuestas seguras cuando no es posible responder con confianza.

## Flujo

1. La UI envía un prompt al `AssistantRuntimeService`.
2. El runtime clasifica la intención con `analyzeAssistantIntent`.
3. El router decide si la pregunta requiere `datetime`, `workspace`, `identity`, `system`, `web` o `model`.
4. Si existe herramienta adecuada, el runtime la consulta.
5. Si no existe herramienta para información actual, el runtime responde `Unavailable`.
6. La respuesta sale con metadatos de confianza, grounding y provider.

## Capability Router

Capacidades soportadas en v1:

- `datetime`
- `workspace`
- `identity`
- `system`
- `web`
- `model`

Las solicitudes `model` se refinan antes de Provider Selection como `coding` o `chat`; no existe un fallback cruzado entre ambas.

La clasificación es híbrida y heurística. Una solicitud puede activar varias señales, pero siempre se resuelve una `primaryCapability`.

Las capabilities se priorizan en este orden:

1. `datetime`
2. `identity`
3. `workspace`
4. `system`
5. `web`
6. `model`

El texto se normaliza sin depender de mayúsculas, tildes o signos de interrogación. `hoy`, `today`, `ahora` y `current` no fuerzan Web por sí solos: deben aparecer junto a señales externas como noticias, resultados, precios o cargos actuales. Las explicaciones generales sobre calendarios o zonas horarias se mantienen en el modelo.

## Herramientas

Implementadas:

- `DateTimeTool`
- `WorkspaceTool`
- `IdentityTool`
- `SystemTool`
- `TrustedWebTool`

Contratos preparados para extensión futura:

- `FutureMemoryTool`

Desktop usa herramientas reales conectadas a `WorkspaceRuntimeService` e `IdentityService`.

Web usa:

- fecha/hora verificadas por sistema
- system tool real
- Workspace e Identity locales persistentes mediante gateways del navegador
- `TrustedWebTool` mediante gateway seguro a Electron Main o API server
- contrato no disponible para memory mientras no exista una herramienta verificable

## Resolución de DateTime

`DateTimeTool` produce `Verified` e incluye internamente `tool`, `timezone`, `timezoneSource` y `resolvedAt`.

La zona horaria se resuelve así:

1. timezone válida de `UserProfile`
2. timezone reportada por el navegador en el contexto Web
3. timezone del runtime como último fallback explícito

El locale sigue la misma estrategia usando perfil o navegador y `es-CO` como fallback. Nunca se usa una fecha hardcodeada ni se delega una consulta local de calendario al modelo o a Web.

## Niveles de confianza

- `Verified`: dato obtenido de una herramienta o runtime verificable.
- `VerifiedWithConflict`: evidencia recuperada y citada con conflicto material explícito.
- `InsufficientEvidence`: la búsqueda se ejecutó pero no reunió soporte suficiente.
- `Derived`: dato inferido a partir de datos verificados.
- `Estimated`: respuesta del modelo sin herramienta verificadora.
- `Unavailable`: el sistema no puede responder sin inventar.

Regla central:

- solo `Verified` puede afirmar datos actuales
- `VerifiedWithConflict` puede describir el dato y debe exponer el conflicto
- `Estimated` no debe presentarse como hecho verificado
- `Unavailable` explica la limitación

## Grounding

Los orígenes se mantienen separados:

- `model`
- `workspace`
- `identity`
- `system`
- `tool`

El runtime no fabrica citas ni URLs. Si una herramienta no entrega fuente, la respuesta no cita.

## Manejo de errores

Si una herramienta falla:

- se normaliza por componente, provider y categoría
- no se inventa el dato faltante
- la respuesta baja a `Unavailable`
- se conserva el `provider` y el `capability` para diagnóstico

Los fallos de modelo distinguen configuración, autenticación, red, timeout, parsing, error del provider y respuesta vacía. `ASSISTANT_MODEL_TIMEOUT_MS` permite ajustar el límite; si no existe usa 30 segundos.

En desarrollo, el runtime registra intent, capability, classification, provider requerido, provider elegido, adapter, tool, providers descartados, motivo, fallback, confidence, request id, duración, error original y stack. En producción la respuesta conserva metadatos seguros y un código normalizado, pero no expone la excepción, el stack, prompts ni secretos.

## Desktop y Web

Ambos entornos usan `shared/trusted-assistant-runtime.js` como núcleo compartido.

Desktop:

- resuelve workspace e identity con servicios locales
- usa el runtime antes de delegar al modelo

Web:

- usa el mismo runtime compartido
- resuelve Workspace e Identity desde almacenamiento local del navegador, sin pasar esos datos al provider
- responde información actual mediante `TrustedWebTool`, con fuentes, citas y `verifiedAt`
- evita fallback con fechas u horas fabricadas

## Guardas

Se agregaron reglas de lint arquitectónico para asegurar que:

- la UI principal use `AssistantRuntimeService`
- `api/chat.ts` y `api/_lib/assistant.ts` pasen por `runTrustedAssistantRuntime`
- no aparezcan URLs placeholder en las superficies críticas del asistente
- no reaparezca el acceso directo al modelo desde la UI principal
- los imports ESM de las funciones Web conserven su extensión `.js`

## Extensión futura

Siguientes piezas naturales sobre esta base:

- ampliar providers web y scoring de fuentes sin cambiar el contrato de `TrustedWebTool`
- `Memory Engine`
- `Context Engine`
- política de citas con fuentes reales
- routing más fino por tipo de tarea y autorización
