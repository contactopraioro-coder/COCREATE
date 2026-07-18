# Proposal Runtime

## Objetivo

Proposal Runtime convierte `Proposed` en una versión funcional, aislada y reversible del Project. Codex modifica esa copia; `Current` permanece intacto hasta que el usuario valida, aprueba y aplica la propuesta explícitamente.

```text
Conversation / Voice
  -> ProposalRuntimeService
  -> Electron Proposal Runtime IPC
  -> Temporary Copy-on-Write Workspace
  -> Codex App Server (cwd = proposal)
  -> Preview Runtime independiente
  -> Diff + Validation
  -> Approve
  -> Apply transaccional / Rollback
  -> Current
```

No se modifica el protocolo de Codex ni se hace fork. CoCreate selecciona un `cwd` y writable root aislados usando las surfaces oficiales de App Server.

## Contrato de confianza

React nunca recibe rutas del filesystem. El renderer envía un `proposalWorkspaceId` opaco; Main verifica la ventana propietaria, resuelve la ruta administrada y reemplaza cualquier `cwd` del payload. Para un Turn de propuesta:

- `interactionMode` es `proposal`;
- `cwd` y `runtimeWorkspaceRoots` apuntan solo al Proposal Workspace;
- el Thread temporal no reemplaza el Thread del Project;
- los eventos no crean Artifacts ni Working Changes en `Current`;
- los cambios se descubren desde el workspace aislado al terminar el Turn.

## Proposal Engine

Cada Proposal conserva:

- instrucción y origen (`text` o `voice`);
- autor y timestamp;
- selección visual nombrada;
- Proposal padre y número de iteración;
- workspace y estado de preview;
- archivos y componentes afectados;
- diff, adiciones y eliminaciones;
- validaciones, errores y duración;
- timeline completo.

El lifecycle implementado es:

```text
Draft -> Preparing -> Applying -> Running -> Ready
                                      |         |
                                      v         v
                                    Failed   Approved -> Applied
                                                |
                                                v
                                           Destroyed copy

Ready / Failed -> Rejected -> Destroyed
```

Cada transición se registra. Al restaurar la aplicación, los procesos no se simulan: el workspace reaparece detenido y el usuario puede levantar nuevamente su preview.

Una iteración que termina sin archivos modificados pasa a `Failed`; nunca se presenta como una Proposal `Ready` ni habilita Validation/Approve sobre un resultado vacío. Los Turns `live` y `proposal` usan una ventana acotada de diez minutos, alineada con Codex App Server. Si vence, el `AbortSignal` cancela también la ejecución upstream en lugar de dejarla trabajando en segundo plano.

## Iteraciones

Una nueva instrucción nace de la Proposal activa cuando esta conserva su workspace. La copia hija contiene los cambios de su padre, pero el diff acumulado siempre se calcula contra `Current`. Las instrucciones de voz usan exactamente este flujo y nunca cambian el Project principal.

## Validation y Apply

Cuando existen scripts se ejecutan, en orden:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npm run build`

Los scripts ausentes se muestran como omitidos. Un fallo detiene el gate del Apply transaccional original, que requiere estado `Approved` y validación `Passed`.

La experiencia de producto actual no invoca ese Apply directamente después de aprobar. Entrega la revisión aprobada a Live Implementation Runtime, vuelve a Chat y ejecuta Analysis, checkpoint, Apply incremental, Validation, Refresh y rollback observable.

Apply vuelve a calcular el diff, verifica que `Current` no haya cambiado desde el nacimiento de la Proposal y copia únicamente esos archivos. Cada archivo actual se respalda antes de tocarlo. Si una operación falla, el runtime restaura el backup en orden inverso y registra el rollback. No hay commit, push ni pull request automáticos.

## Desktop y Web

Desktop es la referencia y dispone de filesystem, Codex local, procesos de preview, validación y Apply. Web comparte Current/Proposal/Split/Overlay, pero muestra honestamente que las propuestas ejecutables requieren Desktop; no fabrica workspace, URL, diff ni resultado.

## Seguridad

- Se excluyen `.git`, caches, builds, `node_modules`, `.env*`, credenciales y llaves privadas de la copia.
- Los symlinks del Project no se copian ni se aplican.
- `node_modules` se reutiliza mediante un enlace administrado; Codex solo recibe el Proposal Workspace como writable root.
- Los procesos reciben una allowlist de variables de entorno, nunca las API keys de CoCreate.
- Preview escucha únicamente en `127.0.0.1` y el iframe conserva sandbox y `no-referrer`.
- Diff y logs se limitan y sanitizan.
- Workspaces huérfanos o abandonados se eliminan desde el directorio administrado.

## Certificación

El gate Desktop empaquetado ejecuta un Turn real con Codex App Server 0.134.0 sobre un Project temporal. Verifica que `Current` conserva el texto original antes de Apply, que Proposed publica su propio preview, que Validation y aprobación son explícitas, que Apply copia un solo archivo y que el workspace temporal desaparece sin crear Working Changes paralelos.

El gate Web usa almacenamiento efímero y verifica Current/Proposal/Split/Overlay, mensaje Desktop explícito, ausencia de iframe o Apply falsos, ausencia de Activity local, responsive a 390 px y cero errores de consola.

## Extensión actual

Proposal Runtime expone `resolveApprovedRevision` y `finalizeImplementation` únicamente dentro de Main. La primera entrega una revisión privada identificada por SHA-256; la segunda elimina el workspace temporal cuando Implementation Runtime termina. Ninguna ruta interna cruza IPC.
