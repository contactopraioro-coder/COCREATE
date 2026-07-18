# Workspace Experience over Codex v1

## Propósito y auditoría inicial

Prompt #8 convierte el runtime operativo existente en una experiencia navegable sin recrear capacidades de Codex. La auditoría previa encontró que la UI principal ya recibía Workspace, Project, Task, Conversation y Session, y que Capability Exposure ya proyectaba Thread, Turn, streaming, plan, command, tool, diff, approval, usage y warnings. Sin embargo, Project y Task no tenían controles de producto completos; Artifacts y Activity no eran navegables; la relación Conversation/Thread y la restauración eran poco visibles; y el snapshot Web duplicaba parte del estado operacional.

Se preservaron `CoCreateV01Experience`, sidebar, composer, layout, responsive y lenguaje visual. `CoCreateExperience` permanece funcional como vista legacy, pero no recibe la nueva capability. Su retiro deberá hacerse tras migrar cualquier ruta o preferencia todavía dependiente de esa vista.

## Arquitectura

```text
CoCreateV01Experience / componentes de presentación
-> WorkspaceExperienceService / ApprovalRuntimeService
-> WorkspaceGateway + CapabilityExposureService + ApprovalGateway
-> Electron IPC seguro o gateways Web
-> Workspace Runtime + Codex Integration Layer
-> Codex App Server
-> Codex Core
```

Las responsabilidades se separan así:

- Domain: Workspace, Project, Task, Conversation, Session, ExecutionReference, Artifact y Activity.
- Application: selección, creación atómica Task+Conversation, restauración y proyección de experiencia.
- Codex Integration: Thread, Turn y eventos upstream normalizados.
- Experience Projection: estado serializable, acotado y sin secretos.
- Renderer: presentación y estado puramente visual; no importa stores, JSON-RPC ni IPC crudo.
- Electron Main: filesystem, persistencia, App Server y broker de approvals.
- Web: comparte contratos y servicios, pero usa persistencia local y no finge App Server, shell ni filesystem local.

`WorkspaceExperienceState` distingue explícitamente estado de dominio, runtime y UI. No persiste paneles abiertos, filtros o estados efímeros dentro del dominio.

Los stores locales serializan `load/save/update` mediante una cola por store. Esto evita que eventos concurrentes de Workspace, Foundation, Identity o App State compitan por el mismo archivo temporal durante un Turn real.

## Contexto de Workspace

`WorkspaceContextBar` presenta Workspace, Project, Task y Conversation sin IDs técnicos. El detalle progresivo permite crear, abrir, renombrar, archivar y restaurar Projects y Tasks; cambiar estado de Task; crear conversaciones adicionales; y asociar un directorio sólo en Desktop.

Project mantiene `rootPath` en Desktop, pero la UI muestra únicamente una etiqueta acotada. Web usa `rootPath: null`, no ofrece selector de directorio y explica que esa capacidad es Desktop-only. Archivar conserva la jerarquía y selecciona un contexto alternativo seguro; restaurar reactiva la entidad sin perder datos.

Task es la unidad de trabajo y admite `draft`, `active`, `blocked`, `waiting`, `review`, `done` y `archived` mediante transiciones del Workspace Runtime. “Nueva tarea” reutiliza el caso de uso público `createChat` para crear Task activa y Conversation inicial bajo una sola llamada del gateway, con lock para evitar duplicados por clics repetidos. “Nueva conversación” reutiliza la Task activa.

Al abrir una Conversation se restauran Project, Task y Session. Conversation conserva el mapping a Codex Thread; Task conserva el Thread primario. La UI presenta estados humanos como nuevo, activo, restaurado, no disponible o fallback, nunca JSON-RPC ni el Thread ID como identidad principal.

## Turn y Active Work

Codex App Server sigue siendo la fuente de verdad de Turn, plan, commands, tools, approvals y cambios. `deriveActiveWorkState` vive junto al Event Mapping central y produce:

- Idle;
- Preparing;
- Planning;
- Running;
- Waiting for approval;
- Applying changes;
- Running tests;
- Completed;
- Cancelled;
- Failed;
- Interrupted.

La UI no clasifica eventos crudos ni inventa porcentajes. Un estado terminal tiene prioridad sobre command/tool antiguos. Cambiar de Task no cancela una Execution en background y los eventos posteriores se correlacionan con la Task originaria mediante `ExecutionReference`.

## Plan, Commands y Tools

`WorkspaceWorkPanel` sólo presenta un plan si App Server entregó pasos válidos. Conserva estado y paso activo durante el Turn, permite colapsar el detalle y no infiere un plan desde texto libre.

Commands y tools muestran nombre humano, estado, duración, resultado y error seguro cuando existen. No se proyecta stdout ilimitado, configuración MCP, headers, tokens ni variables sensibles. Las summaries de Activity provienen del mapper central; los logs técnicos permanecen separados.

## Approvals

Las approvals de command y file change se reciben en Electron Main. `ApprovalBroker` crea un ID efímero, asocia la solicitud al renderer propietario y la envía por un canal IPC dedicado. `ApprovalRuntimeService` expone una única solicitud pendiente a React y responde mediante `ApprovalGateway`.

La tarjeta muestra acción redactada, categoría, riesgo y contexto Project/Task. Aprobar y rechazar son decisiones explícitas; después de responder los controles quedan deshabilitados. Timeout, cierre de ventana, renderer ajeno, solicitud stale y doble respuesta terminan en rechazo o error seguro. No existen permisos permanentes ni auto-approval.

El gate Desktop ejecuta dos requests upstream reales sobre un probe temporal fuera del workspace. El primero se rechaza y verifica que el archivo no exista; el segundo se aprueba una sola vez y verifica su creación. El directorio completo se elimina al terminar.

## Artifacts y Activity

La Task activa presenta Artifacts de diff, patch, generated file y output. La proyección incluye tipo, título, estado, versión, timestamp, Execution, archivos afectados, líneas añadidas/eliminadas y preview acotado. Deduplica por identidad/version y limita la colección a 50 elementos. El diff completo no se copia si upstream ya lo conserva.

Activity se presenta como timeline humano, cronológico y acotado. Conserva actor, timestamp y relación de contexto; agrupa eventos repetitivos contiguos y limita la proyección a 80 entradas. Activity, Artifacts y logs técnicos son capas distintas.

## Capabilities y errores

El detalle compacto publica Codex status, runtime mode, Web Search, Approvals, Diffs, MCP y Streaming desde el registry real. Los estados son `Available`, `Unavailable`, `Not configured`, `Desktop only`, `Degraded` o `Unsupported`; no se hardcodean como disponibles.

Los mensajes de runtime distinguen App Server unavailable, binary missing, authentication required, Web Desktop-only, provider not configured, Turn failed, connection lost y exec fallback. Los diagnósticos de desarrollo no se convierten en Activity ni se muestran como error genérico de proveedor.

## Restauración

Al iniciar Desktop se restaura Workspace, Project, Task, Conversation, Thread, última Execution, último Turn, Artifacts y Activity. Una Session previamente activa se marca `interrupted` y se crea una sola Session restaurada; reinicios repetidos no duplican Sessions. Una Execution sin terminal queda `interrupted`: la UI no simula que continúa.

La Session se recontextualiza al crear o abrir Conversation. `lastExecutionId` y `lastCodexTurnId` permiten revisar el último resultado, mientras los campos `active*` sólo representan trabajo vivo.

La inicialización conserva un Project activo válido y sólo usa el Project de compatibilidad cuando no existe otro contexto restaurable. El gate compara los IDs antes y después del reinicio para impedir una restauración visualmente correcta pero jerárquicamente inconsistente.

## Desktop y Web

Desktop usa App Server, threads/turns, commands, tools, approvals, diffs, Artifacts, MCP y selector local de directorio. Web mantiene Workspace/Project/Task/Conversation locales y Trusted Assistant Runtime, pero informa que App Server, Codex Thread local, MCP local, shell y filesystem local son Desktop-only.

El snapshot Web de `CoCreateV01Experience` conserva sólo preferencias visuales. El estado operacional se hidrata siempre desde `WorkspaceGateway`, evitando una segunda fuente de verdad.

El build Vite usa assets relativos para que el renderer funcione desde `file://`. En el paquete, App Server y exec reciben un directorio de trabajo real bajo `userData`; nunca se intenta ejecutar desde `app.asar`.

## Seguridad, accesibilidad y rendimiento

Las proyecciones vuelven a redactar secretos y limitan paths, previews, Activity y Artifact lists. No exponen auth, API keys, MCP config, cookies, prompts de sistema ni chain-of-thought. Sólo podrían mostrarse reasoning summaries oficiales si upstream las entrega y la política lo permite.

Los controles tienen labels, focus visible, semántica de botones, estados `disabled` y regiones vivas para trabajo importante. La composición se adapta a viewport móvil sin convertir Activity en consola.

Existe una suscripción central a Capability Exposure y cleanup explícito. La UI no crea listeners por panel, no mantiene command output ilimitado y refresca persistencia con scheduling acotado.

## Testing

La cobertura automatizada incluye:

- Project/Task archive y restore;
- creación atómica Task+Conversation;
- múltiples Conversations sin duplicar Task;
- aislamiento de Execution, Artifact y Activity al cambiar Task;
- restauración e interrupción sin duplicar Session;
- Active Work derivado del mapper;
- plan real/no inventado y eventos upstream;
- redacción y límites de Artifacts/Activity;
- Web sin filesystem ni App Server ficticios;
- approvals approve/reject, timeout, renderer owner y doble respuesta;
- regresión de Assistant, Provider, Identity, Workspace, App Server y Web.

Los gates reales se documentan en el informe de cierre: una prueba de protocolo o mock no se presenta como Turn UI real.

El gate Desktop final validó Codex `0.134.0` en modo `app-server`, Turn completado con streaming, command/tool y diff/patch, tres Artifacts, Activity persistida, approve/reject upstream y restauración exacta de Project/Task/Conversation. También creó una segunda Task con Conversation independiente y cero Artifacts, volvió mediante el selector y recuperó Conversation, Thread y Artifacts originales sin mezcla. El gate Web validó Project, Task y dos Conversations, `rootPath: null`, aviso Desktop-only, teclado, mobile y ausencia de errores de consola.

## Límites y deuda

Fuera de alcance permanecen Live Coding, editor de diff avanzado, terminal completa, Git dashboard, Co-Coding, colaboración, Cloud Sync, App Server cloud, Memory, Context propio, marketplace y MCP management.

La vista legacy no se elimina en este corte. El siguiente paso es retirar su routing sólo después de confirmar que no conserva flujos exclusivos. El paquete macOS de desarrollo no está firmado y continúa usando el icono por defecto; distribución, notarización e identidad visual de instalador permanecen como deuda de release, no del runtime.

## Evolución hacia Live Coding

Live Coding deberá consumir `WorkspaceExperienceState`, Active Work, Artifacts y Approval Runtime. Puede enriquecer presencia, preview y control humano, pero no debe crear otro Turn runtime, mapper, command executor ni sistema de diffs paralelo.

## Navigation Foundation v1

El sidebar es ahora la navegación estructural para features, Project y Conversations recientes. El header sólo presenta `Project · Task`; Workspace, Conversation, Thread y capabilities quedan bajo detalle progresivo. Nueva tarea reutiliza las operaciones atómicas existentes de Workspace Experience y no crea otro modelo de Project/Task/Conversation.

Las rutas de capability reciben disponibilidad desde `FeatureParityService`. Web conserva el mismo shell pero declara honestamente la ausencia de App Server, filesystem, branch y MCP local. La especificación completa está en `docs/codex-feature-parity-v1.md`.
# Preferencias de Assistant v2

Task metadata guarda unicamente `planModeEnabled`, `planModeName` y hasta ocho nombres de Skills seleccionadas. No persiste paths, tokens, contenido de Skills, prompts internos ni audio. La seleccion se restaura al volver a la Task, se valida contra el catalogo actual y los tokens reales se regeneran por ventana antes del siguiente Turn.
