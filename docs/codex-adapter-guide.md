# Codex Adapter Guide

## Objetivo

CoCreate solo puede comunicarse con Codex a traves de un adaptador.

Flujo permitido:

```text
UI
  -> Application Services
  -> CodexAdapter
  -> IPC o infraestructura autorizada
  -> Codex upstream
```

## Donde consumir `CodexAdapter`

- Servicios de aplicacion en `src/app/services/`
- Integraciones de Electron Main en `electron/`
- Rutas o tooling de desarrollo que deban delegar en el mismo runner compartido

## Donde esta prohibido importar la integracion concreta

No se debe importar el runner concreto de Codex desde:

- `src/cocreate/`
- `overlay-src/`
- componentes React
- utilidades visuales del renderer

En particular:

- no usar `node:child_process` en el renderer;
- no importar `shared/codex-runner` desde UI;
- no llamar desde el workbench directamente a `window.overlayBridge.startCodexExecution`, `cancelCodexExecution` o `getCodexStatus`.

Estas restricciones se verifican con `npm run lint`.

## Como añadir un nuevo caso de uso

1. Definir o reutilizar contratos en `shared/codex-contracts.*`.
2. Implementar el caso de uso en `src/app/services/`.
3. Consumir `CodexAdapter` desde el servicio, no desde el componente.
4. Si requiere Electron, exponer solo el canal IPC minimo necesario.
5. Conectar la UI al servicio manteniendo JSX y comportamiento visual.
6. Agregar o actualizar pruebas de contrato y de servicio.

## Adaptadores actuales

- `DesktopCodexAdapter`
  - usa el bridge tipado expuesto por Electron preload
  - recibe eventos de streaming por IPC
  - permite cancelacion

- `WebCodexAdapter`
  - fallback para browser preview
  - usa `/api/chat`
  - soporta cancelacion mediante `AbortController`

## Runtimes autorizados

Desktop usa App Server como runtime primario:

- `infrastructure/codex-app-server/process-manager.js`
- `infrastructure/codex-app-server/json-rpc-client.js`
- `infrastructure/codex-app-server/cocreate-codex-client.js`
- `infrastructure/codex-app-server/app-server-adapter.js`
- `infrastructure/codex-app-server/runtime-selector.js`

`shared/codex-runner.js` queda autorizado exclusivamente como adapter fallback `codex exec`. No deben aparecer nuevos spawns de Codex fuera de estas dos infraestructuras.

## Seguridad IPC

- canales cerrados y centralizados en `shared/codex-ipc.*`
- preload sin acceso arbitrario a `ipcRenderer.invoke`
- payloads validados en runtime
- ownership por ventana para ejecuciones activas
- cancelacion de ejecuciones si la ventana propietaria se destruye
- handlers removibles para reinicios limpios

## Persistencia local relacionada

La Etapa 1 agrega una persistencia local minima de soporte:

- `electron/app-state-store.mjs`
  - sesiones del renderer
- `electron/foundation-store.mjs`
  - preferencias basicas
  - ultimo estado de Codex
  - metadatos minimos de ejecuciones recientes

Ruta base:

- `app.getPath("userData")/state/`

Schema actual:

- `foundation-store.json` version `1`

## Actualizacion de Codex upstream

Politica actual:

- distribucion: binario externo requerido
- version validada: `0.134.0`
- compatibilidad App Server: pin exacto `0.134.0`
- protocolo: App Server v2, JSONL stdio, contratos oficiales regenerados
- `CODEX_RUNTIME_MODE=auto|app-server|exec`; nunca hay fallback despues de iniciar un turn

1. Verificar el binario activo con `npm run codex:version`.
2. Regenerar/verificar contratos con `npm run codex:app-server:contract`.
3. Revisar `docs/codex-capability-matrix.md` y el changelog oficial.
4. Actualizar el binario upstream fuera de este repositorio y el pin de forma controlada.
5. Reejecutar:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `npm run codex:app-server:integration`
   - `npm run build:desktop`
   - `npm run smoke:desktop`
5. Validar manualmente el flujo:
   - consultar estado
   - ejecutar prompt
   - recibir streaming
   - cancelar ejecucion

## Rollback

Si una actualizacion del upstream rompe compatibilidad:

1. Restaurar `CODEX_BINARY` a una version anterior conocida.
2. Ejecutar `npm run codex:version` para confirmar la version efectiva.
3. Repetir la bateria de validacion local.

## Pruebas de contrato

- `tests/codex-runner.contract.test.ts`
- `tests/codex-execution-service.test.ts`
- `tests/codex-runner.integration.test.mjs`

Ejecucion:

```bash
npm test
```

La prueba de integracion real queda omitida por defecto y solo corre si existe `RUN_CODEX_INTEGRATION=1`.

## Checklist rapido

| Tema | Estado | Evidencia |
| --- | --- | --- |
| Adaptador unico | completado | `DesktopCodexAdapter` y `WebCodexAdapter` |
| Runner unico | completado | `shared/codex-runner.js` |
| IPC seguro | completado | `electron/codex-ipc.mjs`, `electron/preload.mjs` |
| Persistencia local minima | completado | `electron/foundation-store.mjs` |
| Integracion reproducible | completado con politica externa | `npm run codex:version`, `RUN_CODEX_INTEGRATION=1 npm test` |
## Packaging y verificación desktop

El adaptador de Codex en desktop no vive solo en `electron/`. Su runtime real depende también de:

- `shared/codex-contracts.js`
- `shared/codex-ipc.js`
- `shared/codex-runner.js`

Estos módulos son consumidos por el proceso principal y por el preload, así que el empaquetado de Electron debe incluir `shared/**/*` dentro de `app.asar`.

Verificación recomendada:

```bash
npm run build:desktop
npm run smoke:desktop
```

El smoke test comprueba:

- presencia de los módulos compartidos en `app.asar`;
- arranque del binario empaquetado;
- carga correcta de `preload`;
- disponibilidad de `window.overlayBridge`;
- resolución básica de `CodexAdapter` e IPC.
