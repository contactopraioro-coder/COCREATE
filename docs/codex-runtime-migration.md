# Codex Runtime Migration

## Estado

App Server es el runtime primario de Codex en Desktop. `codex exec` permanece como fallback temporal y reversible hasta cerrar paridad manual en producción.

## Modos

| Modo | Comportamiento | Uso |
| --- | --- | --- |
| `auto` | prueba health App Server; usa exec solo antes del turn si no está disponible | default |
| `app-server` | exige App Server `0.134.0` autenticado | validación y rollout estricto |
| `exec` | usa el proceso por ejecución legado | rollback |

Configuración:

```bash
CODEX_RUNTIME_MODE=auto
CODEX_WEB_SEARCH_MODE=live
CODEX_BINARY=codex
```

## Compatibilidad y datos

No cambia el contrato UI, IPC público, Application Services ni los mensajes existentes. Workspace schema sigue en v1 y añade metadata opcional, por lo que estados previos cargan sin migración destructiva. La primera ejecución de una Conversation crea su mapping; las siguientes reanudan el thread.

Exec no tiene thread/turn, approvals ni diff parity. Sus resultados continúan generando el artifact legacy. App Server genera metadata upstream y un artifact de diff idempotente/versionado.

## Rollout

1. Ejecutar `codex:version`, contract y capabilities.
2. Ejecutar unit tests e integration handshake.
3. Probar `CODEX_RUNTIME_MODE=app-server` en Desktop.
4. Verificar create/resume, streaming, cancel, approve/decline, search y MCP.
5. Empaquetar y ejecutar smoke.
6. Mantener `auto` durante observación.
7. Retirar exec solo tras demostrar paridad y actualizar esta decisión.

## Rollback

Forzar `CODEX_RUNTIME_MODE=exec` y reiniciar CoCreate. No se borran mappings ni threads; App Server puede retomarlos al restaurar `auto`. Nunca hacer rollback a mitad de una ejecución activa.

## Deuda para retirar exec

- validar manualmente stale thread en una instalación empaquetada;
- probar approvals de permisos/user input con UX dedicada;
- validar search con evidencia suficiente y MCP real representativo;
- monitorear lifecycle durante sesiones largas;
- decidir distribución soportada del binario externo por plataforma.
