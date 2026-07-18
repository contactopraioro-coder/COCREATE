# Arquitectura Fundacional - Etapa 1

## Objetivo de esta etapa

Esta etapa no introduce funcionalidades nuevas visibles para el usuario.

Su objetivo es preparar la base arquitectonica de CoCreate para evolucionar sin reescrituras, preservando por completo la experiencia actual y reduciendo el riesgo de acoplamiento con Codex upstream.

## Criterio rector

Toda interaccion con Codex debe converger hacia este flujo:

```text
UI
  -> Application Services
  -> Codex Adapter
  -> Codex Upstream
```

No debe existir acceso directo desde componentes React hacia IPC de Codex ni hacia detalles del proceso upstream.

## Cierre operativo de Foundation

El cierre oficial de esta etapa exige que la arquitectura no solo funcione en desarrollo, sino también dentro del artefacto empaquetado de Electron.

La implicación práctica es importante:

- `electron/main.mjs` y `electron/preload.cjs` importan contratos, runner e IPC desde `shared/`.
- esos módulos no son opcionales ni solo de tipado;
- por lo tanto `shared/**/*` forma parte del runtime desktop y debe viajar dentro de `app.asar`.

La línea base aprobada para Foundation exige dos garantías permanentes:

1. El packaging desktop incluye automáticamente `shared/**/*`.
2. Existe un smoke test automatizado del artefacto empaquetado para detectar regresiones antes de avanzar a etapas superiores.

## Auditoria del estado actual

### Lo que ya esta bien y debe preservarse

- La base visual ya existe y es amplia.
- La app desktop ya corre sobre Electron con `preload` y `contextIsolation`.
- La app web y la app desktop ya comparten una experiencia de producto coherente.
- Ya existe una capa de persistencia local para sesiones del renderer en Electron.
- Ya existe una integracion funcional con el binario `codex` sin modificar upstream.
- Ya existe un flujo funcional de captura de pantalla, guardado, analisis y generacion de prompts.

### Estructura actual verificada

```text
electron/
  main.mjs
  preload.mjs

src/
  App.tsx
  cocreate/
    CoCreateExperience.tsx
    CoCreateV01Experience.tsx
    web-persistence.ts

api/
  _lib/assistant.ts
  chat.ts
  state.ts
  title.ts
  transcribe.ts

overlay-src/
  App.tsx
  types.ts
```

### Hallazgos clave

1. El renderer esta demasiado cargado

`src/cocreate/CoCreateExperience.tsx` concentra UI, estado conversacional, persistencia, voz, grabacion, analisis y ejecucion de Codex. Hoy funciona, pero mezcla responsabilidades de presentacion, aplicacion e infraestructura.

2. La UI conoce detalles de infraestructura

El renderer invoca `window.overlayBridge.getCodexStatus()`, `window.overlayBridge.runCodex()`, `window.overlayBridge.saveRecording()` y `window.overlayBridge.analyzeRecording()` directamente. Eso rompe el borde arquitectonico deseado.

3. El bridge expone primitivas demasiado bajas

`electron/preload.mjs` expone operaciones tecnicas del sistema en lugar de casos de uso de aplicacion. La interfaz publica hoy esta pensada desde infraestructura, no desde producto.

4. Hay duplicacion del flujo Codex

La ejecucion de Codex existe tanto en `electron/main.mjs` como en `vite.config.ts`. Ambos hacen `spawn` del binario, gestionan timeout, capturan salida y leen `last-message.txt`. Esto aumenta el riesgo de deriva y bugs inconsistentes.

5. Electron main mezcla demasiados dominios

`electron/main.mjs` contiene en un solo archivo:

- bootstrap de ventana
- persistencia local
- estado de sesiones
- ejecucion de Codex
- analisis con Gemini
- manejo de archivos
- IPC

Eso vuelve dificil probar, evolucionar y reemplazar piezas sin tocar el resto.

6. El proyecto ya esta cerca del modelo correcto, pero aun no llega

La decision mas importante ya esta bien tomada: CoCreate no modifica Codex upstream y lo consume como proceso externo. El problema no es la direccion del producto, sino la falta de capas intermedias claras.

## Flujo actual verificado

### Desktop

```text
React component
  -> window.overlayBridge.runCodex(...)
  -> ipcRenderer.invoke("codex:run")
  -> ipcMain.handle("codex:run")
  -> spawn(codex exec ...)
```

### Web dev fallback

```text
React component
  -> fetch("/api/chat")
  -> api/_lib/assistant.ts
```

### Live Coding

```text
React component
  -> getDisplayMedia / MediaRecorder
  -> overlayBridge.saveRecording(...)
  -> overlayBridge.analyzeRecording(...)
  -> ipcMain handlers
  -> Gemini upload + interaction
```

## Riesgos actuales

### Riesgo alto

- Acoplamiento directo entre UI e infraestructura.
- Duplicacion de la ejecucion de Codex en desktop y dev server.
- Archivo `electron/main.mjs` con demasiadas responsabilidades criticas.

### Riesgo medio

- Tipos del bridge definidos de forma manual y muy ancha.
- Dificultad para testear casos de uso sin levantar Electron.
- Evolucion futura de organizaciones, proyectos y colaboracion sobre una base aun centrada en componentes.

### Riesgo bajo

- Refactorizar sin disciplina podria romper la experiencia actual aunque la intencion sea mejorar la arquitectura.

## Partes que deben conservarse sin cambios visibles

- `src/cocreate/CoCreateExperience.tsx` y `src/cocreate/CoCreateV01Experience.tsx` a nivel visual.
- `src/cocreate/cocreate.css` y `src/cocreate/cocreate-v01.css`.
- Navegacion, sidebar, layouts, responsive y componentes ya existentes.
- Flujo actual de captura y de chat desde la perspectiva del usuario.

## Partes que deben refactorizarse

- Invocaciones directas del renderer hacia `window.overlayBridge`.
- Implementacion duplicada de ejecucion de Codex.
- Manejo monolitico de IPC en `electron/main.mjs`.
- Mezcla de servicios de aplicacion dentro de componentes React.

## Arquitectura objetivo recomendada

```text
src/
  app/
    services/
      chat-service.ts
      live-coding-service.ts
      workspace-service.ts
  domain/
    chat/
    live-coding/
    sessions/
  infrastructure/
    bridge/
      desktop-bridge.ts
      web-bridge.ts
    codex/
      codex-adapter.ts
    persistence/
      session-store.ts
    analysis/
      gemini-analysis-service.ts
  ui/
    cocreate/
```

Y para Electron:

```text
electron/
  main/
    bootstrap/
    ipc/
    services/
    infrastructure/
```

## Estrategia de migracion recomendada

### Principio operativo

Refactorizar por extraccion, no por reemplazo.

La UI debe seguir renderizando igual mientras movemos responsabilidades hacia servicios y adaptadores.

### Fase 1

Introducir una capa de servicios de aplicacion en el renderer sin cambiar la UI:

- `ChatService`
- `CodexExecutionService`
- `LiveCodingService`
- `SessionStateService`

En esta fase, los componentes siguen existiendo, pero dejan de conocer detalles del bridge o del fetch.

### Fase 2

Crear un `CodexAdapter` unico y centralizado:

- una interfaz comun
- implementacion desktop
- implementacion web o mock cuando aplique

Toda ejecucion de Codex debe pasar por este adaptador.

### Fase 3

Separar `electron/main.mjs` en modulos:

- `codex-runner`
- `session-store`
- `recording-service`
- `analysis-service`
- `ipc-handlers`
- `create-main-window`

### Fase 4

Reducir la superficie publica de `preload` para exponer casos de uso, no detalles tecnicos:

- `workspace.getBootstrapData`
- `workspace.sendPrompt`
- `liveCoding.saveRecording`
- `liveCoding.analyzeRecording`

Si se quiere ir mas lejos, incluso `sendPrompt` podria envolver internamente el adaptador y no exponer `runCodex` como accion aislada.

## Primer corte de implementacion recomendado

Si comenzamos a escribir codigo, el primer cambio seguro deberia ser este:

1. Crear `src/app/services/codex-execution-service.ts`.
2. Crear `src/infrastructure/bridge/desktop-bridge.ts`.
3. Mover desde `CoCreateExperience.tsx` la logica de `refreshCodexStatus` y `sendPrompt`.
4. Mantener el JSX casi intacto.
5. No tocar estilos ni estructura visual.

Ese primer corte reduce acoplamiento sin reescribir la interfaz ni mover demasiadas piezas a la vez.

## Reglas para siguientes etapas

- No reemplazar componentes si ya funcionan.
- No mover estilos salvo que sea estrictamente necesario.
- No introducir cambios visuales como efecto colateral del refactor.
- No agregar dependencias nuevas sin necesidad clara.
- No tocar Codex upstream.
- No duplicar logica ya existente entre desktop y web.

## Conclusiones

La direccion del producto es correcta y la base ya construida tiene valor real.

El principal problema actual no es de experiencia de usuario ni de identidad visual. Es de concentracion de responsabilidades y de limites arquitectonicos incompletos entre UI, servicios e integraciones.

La mejor siguiente etapa no es una reescritura. Es una migracion por capas, gradual, con cortes pequenos, medibles y sin impacto visual.

## Estado de implementacion al 16 de julio de 2026

### Implementado

- Contratos compartidos de Codex en `shared/codex-contracts.*`.
- Canales y validaciones IPC de Codex en `shared/codex-ipc.*`.
- Runner unico reutilizable en `shared/codex-runner.*`.
- Registro de IPC tipado para Codex en `electron/codex-ipc.mjs`.
- Servicios de aplicacion:
  - `CodexExecutionService`
  - `CodexStatusService`
- Adaptadores de infraestructura:
  - `DesktopCodexAdapter`
  - `WebCodexAdapter`
- Primer flujo vertical funcional:

```text
UI existente
  -> CodexExecutionService
  -> CodexAdapter
  -> IPC tipado
  -> Electron Main
  -> NodeCodexAdapter
  -> Codex upstream
  -> eventos tipados
  -> UI existente
```

- Streaming de salida hacia la UI del workbench.
- Cancelacion de ejecucion desde el mismo boton de envio del workbench.
- Compatibilidad retroactiva de `runCodex` para `v01` sin reescribir esa experiencia.
- Pruebas de contrato del runner y pruebas de servicios con fake adapter.
- Script de lint arquitectonico para impedir accesos directos prohibidos desde el renderer.
- Script de verificacion de version efectiva de Codex.

### Implementado con cambios minimos en UI

- `sendPrompt` ya no ejecuta Codex ni llama al bridge de forma directa.
- `refreshCodexStatus` ya no consulta IPC de forma directa.
- El boton de envio del workbench ahora permite cancelar una ejecucion activa sin cambiar el layout.

### Pendiente

- Extraer mas responsabilidades de `CoCreateExperience.tsx` fuera del componente.
- Llevar la misma estrategia de servicios a otras capacidades no relacionadas con Codex.
- Completar la abstraccion de persistencia local con implementaciones concretas para preferencias, cache e historial de ejecuciones.
- Modularizar mas `electron/main.mjs` fuera de la zona Codex.
- Agregar una validacion automatizada mas fuerte del limite "no importar Codex fuera del directorio autorizado" si mas adelante aparece una integracion JS del upstream.

### Desviaciones respecto a la propuesta inicial

- No se agrego ESLint ni una dependencia nueva para reglas de imports. En su lugar se implemento un lint arquitectonico liviano basado en script para mantener el repo estable sin introducir tooling pesado.
- La compatibilidad legacy con `runCodex` se mantuvo para no tocar la experiencia `v01`, pero ahora delega en el runner unico.

### Riesgos conocidos

- `CoCreateExperience.tsx` sigue siendo un componente grande aunque ya no conoce el runner concreto de Codex.
- El streaming actual es por chunks de salida de proceso; no existe aun un protocolo de semantica mas rica por pasos internos del upstream.
- La version web usa un adaptador fallback sin streaming incremental real del backend.

## Flujo real implementado

```text
CoCreateExperience / CoCreateV01Experience
  -> CodexExecutionService / CodexConversationService / CodexStatusService
  -> CodexAdapter
    -> DesktopCodexAdapter
      -> preload tipado
      -> canales centralizados
      -> Electron Main
      -> NodeCodexAdapter
      -> codex exec
    -> WebCodexAdapter
      -> /api/chat
```

## Seguridad IPC

- `contextIsolation: true`
- `nodeIntegration: false`
- nombres de canales centralizados en `shared/codex-ipc.*`
- validacion runtime de payloads en el limite IPC
- listeners con `unsubscribe`
- ownership de ejecuciones por ventana en `electron/codex-ipc.mjs`
- cancelacion automatica de ejecuciones si la ventana propietaria se destruye
- handlers removibles para evitar duplicacion en reinicios

## Persistencia local

### Implementado

- Store de sesiones del renderer:
  - archivo: `app-state.json`
  - ruta: `app.getPath("userData")/state/`
- Store fundacional:
  - archivo: `foundation-store.json`
  - ruta: `app.getPath("userData")/state/`
  - schema version: `1`

### Se almacena

- preferencias basicas:
  - `theme`
  - `activeMode`
  - `sidebarCollapsed`
- ultimo estado conocido de Codex:
  - disponibilidad
  - binario
  - version
  - compatibilidad
  - timestamp
- ejecuciones recientes:
  - `executionId`
  - estado terminal o de inicio
  - previews acotados
  - timestamps

### No se almacena

- prompts completos mas alla de previews acotados
- tokens
- API keys
- credenciales
- secretos

## Auditoria del renderer

### Migrado correctamente

- `src/cocreate/CoCreateExperience.tsx`
  - envio de prompt
  - refresh de estado Codex
- `src/cocreate/CoCreateV01Experience.tsx`
  - envio de prompt
- `overlay-src/App.tsx`
  - consulta de estado Codex

### Permitido temporalmente

- accesos a `window.overlayBridge` para:
  - `getConfig`
  - `getAppState`
  - `saveRendererState`
  - `appendAppEvent`
  - `saveRecording`
  - `analyzeRecording`
  - `copyText`

Estas capacidades no forman parte del alcance obligatorio de Etapa 1 salvo donde tocan directamente a Codex.

### Etapa futura

- extraer grabacion, transcripcion y analisis a servicios de aplicacion dedicados
- reducir aun mas el tamano de `CoCreateExperience.tsx`

## Revision de `CoCreateV01Experience.tsx`

- el ajuste de tipado previo no altero JSX
- no altero estilos
- no altero props
- no altero layout
- no altero comportamiento visible
- durante este cierre se elimino la dependencia directa a `runCodex` sin cambiar la UI

## Alineación Chat / Live

La superficie principal usa un único `Conversation Workspace` con dos modos visuales: Chat y Live. El sidebar, Workspace Runtime y Conversation no se duplican. Live sustituye temporalmente el thread y el composer con `Live Header`, `Current | Proposal` y `Live Controls`.

La captura atraviesa `ScreenSharingService` y un gateway específico de plataforma. Proposal atraviesa `ProposalRuntimeService` y su workspace temporal. La única transición a archivos reales exige `Validate → Approve`; después se detiene la captura, se restaura Chat y se ejecuta Apply con rollback.

Las Tasks admiten `projectId: null`. Projects y Tasks son colecciones hermanas dentro del Workspace; la asociación puede establecerse o cambiarse después sin migrar la conversación.

## Checklist de cierre

| Requisito | Estado | Evidencia | Archivos | Pruebas | Pendiente |
| --- | --- | --- | --- | --- | --- |
| UI -> Services -> Adapter -> IPC -> Main -> Codex | completado | flujo vertical implementado | `src/app/services`, `src/infrastructure/codex`, `electron/*` | `npm test` | no |
| Interfaz unica `CodexAdapter` | completado | desktop y web comparten contrato | `shared/codex-contracts.*`, `src/infrastructure/codex/*` | `npm test` | no |
| Prohibir importaciones directas | completado | lint arquitectonico | `scripts/lint.mjs` | `npm run lint` | no |
| Runner unico reutilizable | completado | Vite y Electron delegan al mismo runner | `shared/codex-runner.js`, `vite.config.ts`, `electron/main.mjs` | `npm test` | no |
| Secure IPC tipado | completado | canales centralizados y payloads validados | `shared/codex-ipc.*`, `electron/preload.mjs`, `electron/codex-ipc.mjs` | `tests/codex-ipc.test.mjs` | no |
| Streaming | completado | eventos `execution.output` y `execution.progress` | `shared/codex-runner.js` | `tests/codex-runner.contract.test.ts` | no |
| Cancelacion | completado | cancelacion idempotente y por ventana | `shared/codex-runner.js`, `electron/codex-ipc.mjs` | `tests/codex-runner.contract.test.ts` | no |
| Persistencia local minima | completado | store fundacional versionado y store de sesiones | `electron/foundation-store.mjs`, `electron/app-state-store.mjs` | `tests/foundation-store.test.mjs` | no |
| Preparacion para sincronizacion | parcial | frontera de store definida | `src/infrastructure/persistence/local-state-store.ts` | inspeccion de codigo | implementar repositorios cloud despues |
| Errores normalizados | completado | `CodexError` y mensajes seguros | `shared/codex-contracts.*`, `shared/codex-runner.js` | `npm test` | no |
| Actualizacion del upstream | completado | politica documentada y version validada | `shared/codex-runner.js`, `docs/codex-adapter-guide.md` | `npm run codex:version`, `RUN_CODEX_INTEGRATION=1 npm test` | no |
| Validacion manual observable | parcial | navegador del renderer verificado, Electron arranca sin crash visible | `npm run dev`, inspeccion de browser | manual + browser | no hubo acceso visual directo a la ventana nativa |

## Validacion manual registrada

### Observado

- `npm run dev` levanto `vite` en `http://localhost:5173/`
- el renderer cargo sin pantalla en blanco
- no hubo overlay de error de Vite
- no aparecieron warnings ni errores en consola del navegador observado
- la vista inicial `v01` renderizo sidebar, navegación, hero y composer
- `#/workbench` renderizo sidebar, conversacion, composer y panel Codex
- el envio de prompt en workbench funciono y mostro respuesta visible

### Limitacion real

No pude inspeccionar visualmente la ventana nativa de Electron como superficie independiente desde este entorno. Pude validar:

- arranque real de `npm run dev`
- ausencia de crash en salida de terminal
- carga del renderer que Electron consume
- contrato desktop mediante pruebas automatizadas e integracion real segura

Por honestidad, la validacion visual nativa del marco Electron queda registrada como limitada por superficie de observacion.

## Extensión vigente: implementación aprobada

La arquitectura fundacional se materializa en el flujo de implementación actual:

```text
React Chat
  -> ImplementationRuntimeService
  -> Desktop Gateway
  -> typed IPC
  -> Electron Implementation Runtime
  -> Proposal Runtime / Current Workspace
```

React no conoce roots, procesos ni manifests. Codex trabaja upstream dentro del Proposal Workspace; CoCreate agrega la semántica propia de producto para aprobación, conflictos, aplicación incremental, validación, recuperación y rollback.
