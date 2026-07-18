# Codex Feature Parity & Navigation Foundation v1

> Esta fundacion permanece vigente, pero su estado de Plan, Skills, Plugins, MCP, voz y adjuntos fue reemplazado por [Codex Feature Parity v2](./codex-feature-parity-v2.md). v2 no cambia las seis routes ni recrea upstream; agrega aislamiento experimental y gates de dispositivo.

Versión validada: Codex `0.134.0`, 16 de julio de 2026.

## Arquitectura

```text
Codex Upstream
  -> CoCreate Integration
  -> FeatureParityService
  -> NavigationService
  -> CoCreate Experience
```

La UI no consulta App Server, IPC ni configuración raw. `FeatureParityService` publica una matriz central de disponibilidad y `NavigationService` mantiene rutas, estado activo e historial. Las vistas consumen servicios de aplicación; nunca infieren una capability por la presencia de un botón.

## Navegación y contexto

Las rutas de producto son `new-task`, `scheduled`, `extensions`, `sites`, `pull-requests` y `chat`. Todas conservan el shell, funcionan con historial del navegador y restauran su URL. El sidebar separa navegación de producto, Project activo y conversaciones recientes.

El header se redujo a `Project · Task`. Workspace, Conversation, Thread y detalle técnico viven bajo disclosure progresivo. No se muestran IDs ni una cadena de cinco selectores.

## Registry

Cada entrada declara source, estrategia, entorno, autenticación, razón y uno de estos estados: Available, Partially available, Desktop only, Not configured, Authentication required, Unsupported by current upstream o Deferred. Desktop y Web comparten contrato, pero no disponibilidad ficticia.

| Feature | Estrategia v1 | Estado real |
| --- | --- | --- |
| Nueva tarea | Extended sobre Workspace Experience | Available |
| Chat | Wrapped por Trusted Assistant + Provider Runtime | Available |
| Programados | No hay surface fijada en el contrato estable | Unsupported |
| Complementos | MCP discovery estable; skills/plugins experimentales diferidos | Desktop only / partial |
| Sitios | Sin surface App Server estable con semántica de hosting | Deferred |
| Pull requests | Integración segura requiere GitHub auth/connector | Authentication required |
| Adjuntos | UserInput upstream mediante broker opaco en Main | Desktop only |
| Modelos | `model/list`, selección aplicada al siguiente Turn | Desktop only |
| Voz | Web MediaRecorder + transcripción segura existente | Available cuando hay permiso |
| Plan Mode | collaboration mode sólo experimental en el contrato generado | Deferred |
| Objetivos | thread goals sólo experimental; no se duplican en Workspace | Deferred |
| Git context | consulta local redactada, sin shell en Renderer | Desktop only |

## Composer

El menú `+` sólo ofrece acciones reales: archivo/carpeta en Desktop, referencia al Artifact más reciente y acceso a Complementos. Los adjuntos se validan en Electron Main, se representan con tokens opacos y sólo se resuelven al enviar. El renderer no recibe paths completos ni lee contenido privado.

El selector muestra únicamente modelos devueltos por `model/list`; provider, reasoning effort y compatibilidad proceden del catálogo upstream. La selección se aplica al próximo Turn. Plan aparece como estado diferido, no como toggle decorativo. Voz conserva grabar, cancelar, detener, transcribir, revisar y enviar sin persistir audio indefinidamente.

## Vistas de capability

Programados, Complementos, Sitios y Pull requests tienen loading, error y empty/capability state específicos. No contienen datos simulados. La vista Nueva tarea reutiliza Project, Task y Conversation del Workspace Runtime y evita un flujo paralelo.

Web mantiene chat, Workspace, Identity y DateTime. Informa claramente que filesystem, branch, MCP local, App Server, adjuntos locales y modelos upstream requieren Desktop. Desktop usa App Server y brokers seguros en Main.

## Seguridad

- No cruzan al renderer API keys, auth tokens, GitHub tokens, MCP config, cookies, headers ni config raw.
- Los adjuntos usan allowlist, límite de tamaño, ownership por ventana y resolución de un solo uso.
- Git usa argumentos sin shell y sólo publica branch, dirty state, conteos y nombre de directorio.
- Los enlaces externos requieren una fuente real y apertura segura; v1 no inventa PRs ni URLs de sitios.
- No se exponen system prompts, instrucciones internas ni chain-of-thought.

## Evidencia

El gate Web recorrió las seis rutas, back/forward, active shell, estados honestos, consola sin errores y viewport de 390 px sin overflow horizontal. Tests cubren registry Desktop/Web, navegación/restauración, adjuntos, modelos, routing DateTime y contratos IPC/App Server. Build Desktop y smoke validan los bridges nuevos sin ejecutar un Turn pagado.

## Legacy y evolución

`CoCreateV01Experience.tsx` sigue siendo la experiencia principal. `#/workbench` queda congelada: no recibirá nuevas features. Su retiro se hará cuando los gates confirmen que no conserva ningún flujo exclusivo y después se eliminarán route, snapshot y estilos legacy en un único cambio reversible.

La deuda upstream no se resuelve con runtimes paralelos. Parity v2 debe reevaluar scheduled tasks, skills/plugins, sites, GitHub y collaboration mode contra una nueva versión fijada de Codex. Live Coding sólo debe empezar cuando la navegación y los flujos reales de Desktop mantengan estos contratos.
