# Local Identity And Ownership

## Propósito

Esta fase implementa identidad local persistente para CoCreate sin login, sin OAuth y sin sincronización cloud.

Responde localmente:

- quién usa esta instalación;
- qué perfil local tiene;
- qué dispositivo está usando;
- quién posee el Workspace personal local;
- quién actuó en Activity y Execution;
- qué parte es personal y qué parte pertenece al Workspace.

## Identity vs Authentication

- `Identity`:
  - representa a la persona local o actor persistente
  - funciona offline
  - no requiere cuenta
- `Authentication`:
  - no está implementada en esta fase
  - quedará para un prompt futuro

## Arquitectura real

```text
Renderer
-> src/app/services/identity-service.ts
-> src/infrastructure/identity/*
-> electron/identity-ipc.mjs
-> shared/identity-runtime.js
-> electron/identity-store.mjs
-> app.getPath("userData")/state/identity-store.json
```

Integración con Workspace:

```text
identity-runtime
-> electron/main.mjs bootstrap
-> shared/workspace-runtime.js initialize(...)
-> workspace owner
-> activity actor
-> execution attribution
```

## Entidades

### LocalIdentity

Archivo de dominio:

- `shared/identity-domain.js`

Campos implementados:

- `id`
- `type`
- `status`
- `displayName`
- `createdAt`
- `updatedAt`
- `linkedAccountId`
- `linkedAt`
- `metadata`

Estado funcional actual:

- `local`

### UserProfile

Campos implementados:

- `id`
- `identityId`
- `displayName`
- `locale`
- `timezone`
- `technicalLevel`
- `communicationPreferences`
- `accessibilityPreferences`
- `editorPreferences`
- `aiPreferences`
- `createdAt`
- `updatedAt`
- `schemaVersion`
- `metadata`

### DeviceIdentity

Campos implementados:

- `id`
- `identityId`
- `name`
- `platform`
- `architecture`
- `appVersion`
- `createdAt`
- `updatedAt`
- `lastSeenAt`
- `metadata`

No utiliza:

- fingerprinting
- MAC address
- seriales
- identificadores invasivos

### Actor

Tipos implementados:

- `human`
- `agent`
- `system`

Actores actuales:

- humano local estable
- sistema CoCreate
- agente Codex

### WorkspaceOwner

Modelo actual:

```ts
{
  type: "identity",
  id: string
}
```

No hay `organization` funcional todavía.

## Relaciones

- `UserProfile.identityId -> LocalIdentity.id`
- `DeviceIdentity.identityId -> LocalIdentity.id`
- `Workspace.owner.id -> LocalIdentity.id`
- `Activity.actor -> Actor`
- `ExecutionReference.metadata.requestedBy -> Actor`
- `ExecutionReference.metadata.performedBy -> Actor`

## Persistencia

Archivo:

- `app.getPath("userData")/state/identity-store.json`

Razón de store separado:

- evita mezclar datos personales con el dominio operativo del Workspace;
- facilita migración futura a account linking;
- mantiene separación entre preferencias personales y configuración del Workspace.

Propiedades:

- schema versionado
- escritura atómica
- recuperación ante corrupción
- recuperación ante schema futuro desconocido
- sin secretos
- sin tokens
- sin credenciales

Schema actual:

- `version: 1`

## Bootstrap real

Orden actual:

1. `identityRuntime.initialize(...)`
2. crear o recuperar `LocalIdentity`
3. crear o recuperar `UserProfile`
4. crear o recuperar `DeviceIdentity`
5. `workspaceRuntime.initialize(...)`
6. asegurar `Workspace` personal local
7. asignar owner del workspace
8. restaurar project, task, conversation y session

## Personal Preferences vs Workspace Settings

Clasificación actual:

### Personal Preferences

Viven en `identity-store.json`:

- nombre visible
- locale
- timezone
- nivel técnico
- preferencias de comunicación
- accesibilidad
- preferencias AI personales mínimas

### Workspace Settings

Viven en `workspace-runtime.json`:

- nombre del workspace
- owner del workspace
- proyectos
- tareas
- conversaciones
- activity
- artifacts
- sessions

### Device Settings

Viven principalmente en:

- `identity-store.json`:
  - metadata del dispositivo
  - plataforma
  - arquitectura
  - `lastSeenAt`
- `foundation-store.json`:
  - tema
  - modo activo
  - estado de sidebar

Deuda explícita:

- `foundation-store.json` aún contiene preferencias visuales que conceptualmente son personales o de dispositivo.

## Activity Attribution

Toda Activity nueva se guarda con:

- `actor`
- `type`
- `summary`
- `timestamp`
- `relatedEntity`
- `workspaceId`

Fallback legacy:

- si existía actor string o incompleto, se normaliza a un actor serializable.

## Execution Attribution

Ejecuciones actuales registran:

- `requestedBy`: actor humano local
- `performedBy`: actor agente Codex

La Activity de ejecución usa actor `Codex` cuando el resultado corresponde al agente.

## Account Linking futuro

Preparación implementada:

- `preparedLink` local
- evento `identity.linkPrepared`
- rechazo de múltiples preparaciones simultáneas
- la identidad sigue no vinculada por defecto
- ownership del Workspace no cambia

No implementado:

- backend de autenticación
- OAuth
- login
- merge real
- vinculación efectiva de cuenta

## Estado de la vista legacy

- `CoCreateV01Experience.tsx`:
  - experiencia principal
- `CoCreateExperience.tsx`:
  - ruta legacy en proceso de retiro

Esta fase no añade una segunda integración completa de identidad en la vista legacy.

## Deuda web

La experiencia web sigue usando `clientId` en:

- `src/cocreate/web-persistence.ts`

Eso no equivale todavía a `LocalIdentity`.

Deuda explícita:

- el backend web basado en `clientId` no fue migrado a la nueva capa de identidad local/autenticada.

## Límites de esta fase

No implementado:

- login
- email/password
- magic links
- OAuth
- Supabase Auth
- organizaciones
- membresías
- permisos avanzados
- cloud sync
- account merge real

## Validaciones ejecutadas

- `npm run typecheck`
- `npm run lint`
- `npm test`

Pendiente de reflejar tras la validación final del turno:

- `npm run build`
- `npm run build:desktop`
- `npm run smoke:desktop`
