# Roadmap de Confiabilidad de CoCreate

Este documento aterriza los huecos actuales del proyecto sin cambiar la interfaz existente. La meta es volverlo confiable para desarrollo, pruebas, despliegue y sesiones en vivo.

## Estado vigente — 17 de julio de 2026

La Foundation, Workspace Runtime, Provider Runtime, Codex Integration, Feature Parity y Product UX Polish ya forman parte de la base cerrada de CoCreate.

Live Coding Foundation, Visual Collaboration, Proposal Runtime, Live Coding Experience Alignment y Live Implementation Runtime ya están cerrados. CoCreate dispone de captura autorizada, Current/Proposal/Split/Overlay, selección visual, workspaces temporales aislados, preview independiente, iteraciones y un ciclo post-aprobación persistente con revisión inmutable, conflictos, checkpoint, Apply incremental, Validation, Refresh, recovery y rollback seguro.

La siguiente fase recomendada es Assistant Intelligence Runtime. No incluye automatizar commits, pushes, pull requests o deploys, y no debe relajar aprobación explícita, consentimiento de captura, conflictos, Validation ni rollback.

> Las prioridades y fases que aparecen a continuación se conservan como registro histórico del roadmap inicial. Cualquier conflicto se resuelve a favor del estado vigente y de la arquitectura upstream actual.

## Estado actual verificado

- El repositorio ya tiene remoto GitHub configurado: `origin -> contactopraioro-coder/caleidoscopio-overlay`.
- El proyecto ya esta linkeado a Vercel mediante `.vercel/project.json`.
- La app actual ya puede:
  - ejecutar `codex` por CLI desde Electron
  - capturar pantalla y audio
  - guardar una grabacion
  - enviar la grabacion a Gemini
  - convertir el analisis en un prompt para Codex
- El build de produccion pasa correctamente con `npm run build`.

## Lo que falta para considerarlo confiable

### Prioridad 0: base operativa y seguridad

1. CI en GitHub
- Ejecutar `npm ci` y `npm run build` en cada push y pull request.
- Bloquear merges a `main` si el build falla.

2. Convenciones de entorno
- Definir variables requeridas para desarrollo, preview y produccion.
- Separar secretos locales de configuracion compartida.

3. Estrategia de errores
- Estandarizar errores de captura, Codex, LLM, persistencia y networking.
- Registrar errores estructurados con `sessionId`, `projectId`, `userId`, `phase` y timestamp.

4. Observabilidad
- Agregar telemetria minima:
  - inicio y fin de sesion
  - inicio y fin de captura
  - prompts generados
  - ejecuciones de Codex
  - fallos de analisis
  - latencia por etapa

### Prioridad 1: sesiones y memoria robustas

Problema actual:
- La UI usa estado local de React y `localStorage` para parte de la configuracion.
- No existe un backend persistente para sesiones, memoria conversacional ni recuperacion post-crash.
- El archivo `data/store.json` parece ser un almacenamiento local de prueba, no una base durable para produccion.

Arquitectura recomendada:

1. Session service
- Crear un backend con tabla o coleccion de sesiones.
- Cada sesion debe tener:
  - `id`
  - `userId`
  - `projectId`
  - `threadId`
  - `status`
  - `startedAt`
  - `endedAt`
  - `metadata`

2. Conversation memory
- Persistir mensajes, prompts generados, acciones ejecutadas y contexto de pantalla.
- Guardar snapshots resumidos por cada cierto numero de mensajes para rehidratacion rapida.

3. Durable storage
- Para produccion usar Postgres gestionado.
- Para blobs grandes usar object storage para:
  - grabaciones
  - frames
  - diffs visuales
  - artefactos de prompt

4. Recuperacion
- Si Electron o el navegador se cierran, restaurar:
  - hilo activo
  - modo activo
  - grabacion pendiente
  - ultimo prompt
  - ultimo resultado ejecutado

### Prioridad 2: modo "comparar antes / despues" con pantalla compartida

Objetivo de producto:
- Izquierda: estado actual o "antes".
- Derecha: estado modificado o "despues".
- Un divisor vertical fijo permite comparar visualmente mientras se hacen cambios en tiempo real.

Requisitos tecnicos:

1. Fuente del panel izquierdo
- Captura en vivo de la aplicacion o ventana compartida por el usuario.
- Alternativa: snapshot congelado del estado inicial para evitar jitter.

2. Fuente del panel derecho
- Preview local del proyecto que se esta editando.
- Debe refrescarse automaticamente tras cada cambio del repo o tras cada ejecucion de Codex.

3. Sin tocar la estetica actual
- Implementar este modo como una vista nueva o feature flag.
- No modificar los layouts existentes por defecto.

4. Sincronizacion visual
- Marcar eventos de cambio por "steps":
  - `captured_context`
  - `generated_prompt`
  - `codex_started`
  - `files_changed`
  - `preview_reloaded`

### Prioridad 3: edicion en tiempo real a partir de voz y video

Objetivo:
- Mientras el usuario habla, el sistema arma contexto incremental y dispara iteraciones cortas de trabajo hacia Codex.

Gap actual:
- Hoy el flujo es "capturar -> guardar -> analizar -> generar prompt -> ejecutar".
- No hay streaming continuo ni chunks periodicos hacia el agente.

Arquitectura recomendada:

1. Ingesta en chunks
- Cortar la sesion en ventanas de 5 a 10 segundos.
- Cada chunk genera:
  - transcripcion parcial
  - frame summary
  - eventos visuales detectados

2. Orquestador en tiempo real
- Un worker agrega los chunks y decide cuando disparar una accion.
- No todos los chunks deben ejecutar Codex; primero deben pasar por una capa de decision.

3. Planner antes de Codex
- Antes de modificar codigo, clasificar:
  - solo observacion
  - actualizar memoria
  - proponer cambio
  - ejecutar cambio automatico

4. Ejecucion segura
- Las ejecuciones automaticas deben entrar con:
  - limite de archivos editables
  - limite de tiempo
  - validacion de build
  - opcion de rollback semantico

5. Streaming de salida
- Mostrar texto incremental del analisis y luego el estado de ejecucion:
  - escuchando
  - entendiendo
  - planeando
  - editando
  - validando
  - listo

### Prioridad 4: GitHub y Vercel confiables

GitHub
- Proteger rama principal.
- Requerir CI verde.
- Definir PR template con:
  - objetivo
  - riesgo
  - plan de prueba
  - impacto visual

Vercel
- Mantener preview deploy por PR.
- Reservar produccion para merges a rama protegida.
- Separar variables de entorno por ambiente.
- Verificar que el comando de build y el output coincidan con el artefacto que realmente se quiere publicar.

Nota importante:
- Este repo hoy es principalmente Electron. Si se quiere que Vercel sirva una experiencia web real del mismo producto, hay que decidir si Vercel hospedara:
  - solo el preview web
  - una API backend
  - ambos

### Prioridad 5: modelo de datos minimo recomendado

Tablas o colecciones sugeridas:

1. `users`
2. `projects`
3. `sessions`
4. `threads`
5. `messages`
6. `recordings`
7. `prompt_runs`
8. `codex_runs`
9. `artifacts`
10. `events`

Campos clave por evento:
- `id`
- `sessionId`
- `projectId`
- `type`
- `payload`
- `createdAt`
- `source`

## Tareas ejecutables sin tocar la UI actual

Estas son las que se pueden avanzar sin afectar estetica ni usabilidad:

1. Agregar CI de build.
2. Formalizar `.env.example`.
3. Documentar arquitectura objetivo y fases.
4. Definir feature flags para activar el modo live compare sin exponerlo por defecto.
5. Crear una capa de persistencia separada del estado visual actual.

## Fases sugeridas

### Fase 1
- CI
- variables de entorno
- decisiones de despliegue
- observabilidad basica

### Fase 2
- backend de sesiones
- persistencia durable
- recuperacion post-crash

### Fase 3
- split view antes/despues
- preview recargable
- eventos de comparacion

### Fase 4
- pipeline de audio/video en chunks
- planner en tiempo real
- ejecucion incremental con validaciones

## Riesgos a vigilar

- Ejecutar cambios automaticos demasiado frecuente puede degradar calidad y estabilidad.
- Analizar video completo en cada iteracion es caro y lento; hay que resumir por chunks.
- Guardar solo en `localStorage` o JSON local expone perdida de datos.
- Mezclar preview web, app Electron y automatizacion en un solo flujo sin colas o estados intermedios puede producir condiciones de carrera.

## Decisiones abiertas

1. Si el backend vivira en Vercel, en un servidor aparte, o embebido parcialmente en Electron.
2. Si el almacenamiento durable sera Postgres + Blob o algun proveedor alterno.
3. Si la edicion automatica en vivo sera:
- totalmente automatica
- semiautomatica con aprobacion
- solo sugerencias hasta confirmar
4. Si el panel izquierdo mostrara stream en vivo o snapshot estable del "antes".

## Prompt #13 — Live Coding: Visual Collaboration

Estado: cerrado el 17 de julio de 2026.

Implementado:

- layout Current / Proposed dentro de Live;
- modos Actual, Dividida y Superpuesta;
- preview seguro por URL local o web;
- selección visual nombrada sin selectores ni inspección DOM cross-origin;
- puntero, flecha, círculo y rectángulo efímeros;
- contexto visual asociado a texto y voz;
- historial y decisiones de propuestas;
- aprobación de ideas separada de Working Changes;
- persistencia Desktop/Web de sesión, selección, propuestas, timeline y layout;
- experiencia Web reducida sin superficies locales ficticias;
- gate Desktop real y browser gate responsive.

## Prompt #14 — Live Coding: Proposal Runtime

Estado: cerrado el 17 de julio de 2026.

Implementado:

- Temporary Copy-on-Write Workspace aislado y owner-scoped;
- Codex App Server con `cwd` y writable root de la Proposal;
- preview independiente con start, stop, restart, refresh y cierre keep-alive acotado;
- estados Draft, Preparing, Applying, Running, Ready, Failed, Rejected, Approved, Applied y Destroyed;
- iteraciones encadenadas de texto o voz sin modificar Current;
- diff, componentes, validaciones y rechazo honesto de propuestas vacías;
- aprobación separada de Apply;
- copia transaccional de archivos modificados y rollback automático;
- restore, limpieza de workspaces abandonados y estado Web honesto;
- gate Desktop real empaquetado y gate Web responsive.

Siguiente fase recomendada: Live Implementation. Debe convertir propuestas aprobadas en flujos guiados de implementación sin relajar Apply, Validation o aprobación explícita.

## Prompt #14.1 — Live Coding Experience Alignment

Estado: cerrado el 17 de julio de 2026.

Implementado:

- Live transforma el área completa de la conversación sin alterar el sidebar;
- captura real y explícita de pantalla, ventana o pestaña en Web y Desktop;
- permiso recuperable de Screen Recording en macOS y cleanup determinista;
- Current con stream, encuadre, pausa, stop, fullscreen, selección, pointer y anotaciones;
- Proposal Runtime integrado con texto, voz, historial, undo y descarte;
- acción única `Aprobar y desarrollar` con retorno a Chat antes de Apply;
- nueva tarea inmediata, sin formulario ni Project obligatorio;
- Projects y Tasks separados con asociación posterior;
- restauración de layout y borrador sin reiniciar captura.

Siguiente fase recomendada: Live Implementation.
