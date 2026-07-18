# Workspace Runtime

## Estado

Implementado como primer runtime local funcional del Prompt #1.

Flujo vertical actual:

```text
Workspace personal local
-> Project
-> Task
-> Conversation
-> Execution
-> Artifact
-> Activity
```

## Arquitectura real

```text
Renderer UI
-> src/app/services/workspace-runtime-service.ts
-> src/infrastructure/workspace/*
-> electron/workspace-ipc.mjs
-> shared/workspace-runtime.js
-> electron/workspace-store.mjs
-> app.getPath("userData")/state/workspace-runtime.json
```

Separación vigente:

- Domain y runtime puro:
  - `shared/workspace-domain.js`
  - `shared/workspace-event-bus.js`
  - `shared/workspace-runtime.js`
- Infrastructure de persistencia local:
  - `electron/workspace-store.mjs`
- Infrastructure Electron / IPC:
  - `electron/workspace-ipc.mjs`
  - `electron/preload.cjs`
  - `electron/main.mjs`
- Renderer:
  - `src/app/services/workspace-runtime-service.ts`
  - `src/infrastructure/workspace/*`
  - `src/cocreate/CoCreateV01Experience.tsx`

El runtime central ya no depende de:

- Electron
- IPC
- filesystem
- `app.getPath`
- `BrowserWindow`
- `window`

## Modelo de dominio

Entidades persistidas:

- `Workspace`
- `Project`
- `Task`
- `Conversation`
- `Session`
- `ExecutionReference`
- `Artifact`
- `ActivityEntry`

Relaciones nuevas de ownership y actor:

- `Workspace.owner`
- `Project.createdBy`
- `Project.updatedBy`
- `Task.createdBy`
- `Task.updatedBy`
- `Conversation.createdBy`
- `Conversation.updatedBy`

Identificadores fuertes por prefijo:

- `ws-*`
- `project-*`
- `task-*`
- `conv-*`
- `session-*`
- `artifact-*`
- `activity-*`

Estos IDs no son branded types de TypeScript, pero sí son estables, serializables y distinguibles por tipo.

## Invariantes actuales

- no se crea `Project` sin `Workspace` activo
- no se crea `Task` sin `Project` activo
- no se crea `Conversation` sin `Task`
- la UI de “Nuevo chat” usa el caso de uso de compatibilidad `createChat`, que crea `Task + Conversation`
- la experiencia principal usa `createTaskWithConversation`, coordinado y protegido contra doble creación
- `Task` conserva relación con `executionIds`
- `Task` conserva relación con `artifactIds`
- `Activity` se genera por eventos del runtime, no desde logs técnicos
- todo `Workspace` personal local termina con owner explícito
- la atribución de `Activity` ya usa `Actor` estructurado

## Estados de Task

Estados implementados:

- `draft`
- `active`
- `blocked`
- `waiting`
- `review`
- `done`
- `archived`

Transiciones válidas:

- `draft -> active | archived`
- `active -> blocked | waiting | review | done | archived`
- `blocked -> active | waiting | review | archived`
- `waiting -> active | blocked | review | archived`
- `review -> active | done | archived`
- `done -> archived`
- `archived -> active` para restauración explícita

Una Task terminada debe restaurarse desde su estado archivado; no vuelve directamente de `done` a `active`.

## Eventos de dominio

Eventos tipados usados por el runtime:

- `workspace.created`
- `project.created`
- `project.opened`
- `task.created`
- `task.started`
- `task.statusChanged`
- `task.completed`
- `conversation.created`
- `conversation.updated`
- `session.started`
- `session.interrupted`
- `session.restored`
- `execution.started`
- `execution.completed`
- `execution.failed`
- `execution.cancelled`
- `artifact.created`
- `codex.thread.mapped`
- `codex.diff.updated`
- `codex.command.completed`
- `codex.mcp.completed`
- `codex.webSearch.completed`

Todos incluyen:

- `id`
- `type`
- `version`
- `workspaceId`
- `timestamp`
- `actor`
- `entity`
- `data`
- `correlationId`
- `causationId`

## Mapping Codex upstream

Workspace es dueño de la relación CoCreate ↔ Codex, no Renderer. `getCodexExecutionContext` resuelve workspace/project/task/conversation/root activo; `associateCodexThread` persiste `codexThreadId`, runtime y protocolo en Conversation y Task; `recordCodexUpstreamEvent` relaciona turn/eventos con `ExecutionReference`.

Los diffs crean un artifact `type: diff` por Execution. Nuevas actualizaciones incrementan `version` en vez de crear duplicados. Solo se persisten preview acotado, tamaño y metadatos de correlación; el stream completo permanece efímero.

## Persistencia local

Archivo:

- `app.getPath("userData")/state/workspace-runtime.json`

Propiedades:

- JSON versionado
- escritura atómica por archivo temporal + rename
- recuperación ante JSON corrupto con fallback al schema actual
- recuperación ante schema futuro desconocido con `metadata.recoveredFromUnsupportedVersion`
- migración legacy idempotente

Schema actual:

- `version: 1`

## Migración legacy

Fuente legacy:

- snapshots conversacionales guardados en `electron/app-state-store.mjs`

Estrategia:

- crear `Workspace personal local`
- crear `Project` de compatibilidad
- convertir cada thread legacy a:
  - `Task`
  - `Conversation`
  - `messagesByConversation`
- restaurar conversación activa cuando existe
- marcar `metadata.legacyMigrationCompleted`

La migración es idempotente y no remigra el mismo thread una vez completada.

## Sessions

Al iniciar:

- se asegura `Workspace` personal local
- se asegura `Project` de compatibilidad
- si había una sesión activa, se marca `interrupted`
- se crea una nueva sesión `active` o `restored`
- se conserva el contexto operativo:
  - workspace activo
  - project activo
  - task activa
  - conversation activa
- una Execution no terminal se marca `interrupted` y se conserva como última Execution revisable
- reinicios repetidos no convierten Sessions restauradas en Sessions activas duplicadas

## Workspace Experience

`WorkspaceExperienceService` consume el runtime mediante `WorkspaceGateway` y construye la proyección usada por la vista principal. Project/Task/Conversation, Active Work, Artifacts y Activity no se coordinan desde React. En Web el gateway mantiene el mismo modelo de navegación, con `rootPath: null` y sin filesystem ficticio.

La especificación completa está en `docs/workspace-experience-over-codex.md`.

## Ownership y actor

Ownership estructural:

- `Project` pertenece a `Workspace`
- `Task` pertenece a `Project`
- `Conversation` pertenece a `Task`
- `Artifact` pertenece a `Workspace` y `Project`

Ownership explícito implementado:

- `Workspace.owner = { type: "identity", id }`

Actor y autoría:

- las Activities nuevas usan actor estructurado
- las ejecuciones distinguen:
  - `requestedBy`
  - `performedBy`
- el owner del Workspace no duplica ownership humano innecesario en cada entidad

## Execution, Artifact y Activity

Cuando llega un evento de ejecución:

- se actualiza o crea `ExecutionReference`
- se vincula a la `Task` activa
- se registra `Activity`
- se conserva atribución mínima:
  - `requestedBy` actor humano local
  - `performedBy` agente Codex
- si la ejecución termina con salida persistible:
  - se crea `Artifact`
  - se vincula a `Task`
  - se vincula a `Execution`

`Activity` y logs técnicos permanecen separados.

## Integración con Codex

La integración de Workspace Runtime no reemplaza el runtime de Codex.

Integración actual:

- UI envía prompt mediante `CodexConversationService`
- Electron recibe eventos de ejecución de Codex
- `electron/main.mjs` llama `workspaceRuntime.recordExecutionEvent(...)`
- el runtime registra relación de dominio y Activity/Artifact

## Compatibilidad temporal de “Nuevo chat”

Visualmente, la UI sigue mostrando “Nuevo chat”.

Internamente, en desktop:

```text
Nuevo chat
-> createChat()
-> Task
-> Conversation
```

Eso preserva apariencia visual mientras el trabajo real deja de organizarse alrededor de threads sueltos.

## Estado de las vistas

Ruta principal actual:

- `CoCreateV01Experience.tsx`

Ruta legacy aún activa por hash:

- `CoCreateExperience.tsx` mediante `#/workbench`

Decisión de esta iteración:

- migrar fuerte solo `CoCreateV01Experience.tsx`
- mantener `CoCreateExperience.tsx` como vista legacy en proceso de retiro
- no introducir una segunda fuente de verdad nueva allí en este cierre

Riesgo restante:

- todavía existen dos experiencias activas en el renderer
- la legacy no está completamente migrada al Workspace Runtime

## Guardas automatizadas

`npm run lint` valida:

- el runtime de workspace no importa Electron ni APIs de infraestructura
- `src/app/services/*` no accede a `window`
- `src/app/services/*` no importa `electron`
- la UI no importa stores concretos
- el renderer no importa `node:child_process`
- la UI no importa el runner concreto de Codex

## Límites de esta iteración

No implementado en este cierre:

- Identity
- Login
- Cloud Sync
- Organizations
- Context Engine
- Memory Engine avanzado
- Tool Runtime
- Live Coding sobre Workspace Runtime
- Co-Coding
- nueva UI de Projects o Tasks

## Validaciones ejecutadas

Completadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

Pendientes de confirmación en esta documentación:

- `npm run build:desktop`
- `npm run smoke:desktop`
- validación manual visual completa del arranque desktop

Esos pasos dependen de entorno de ejecución desktop y acceso de red del empaquetador.
