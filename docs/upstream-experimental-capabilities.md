# Upstream Experimental Capabilities

Version fijada: Codex `0.134.0`.

## Politica

Una surface generada con `codex app-server generate-ts --experimental` no se considera estable. Para exponerla, CoCreate exige version exacta, feature flag, adapter en infraestructura, payload normalizado, fallback honesto y contract tests. React nunca usa nombres de metodos raw.

| Capability | Metodo o evento | Adapter | Exposicion |
| --- | --- | --- | --- |
| Plan Mode | `collaborationMode/list` | `UpstreamStabilityAdapter.listPlanModes` | preset Plan/Default para el siguiente Turn |
| Skills | `skills/list`, `skills/changed` | `listSkills` + bridge opaco | catalogo seguro y seleccion por Turn |
| Plugins | `plugin/list` | `listPlugins` | catalogo read-only |
| MCP lifecycle | `mcpServer/startupStatus/updated` | subscription normalizada | starting/ready/failed/cancelled |

## Fallo seguro

Si la version cambia, el contrato no coincide, el metodo desaparece, el payload no es valido o la cuenta no autoriza la llamada:

1. la capability queda Disabled o Error;
2. la route conserva contexto y explicacion;
3. no se inventan datos ni se reutiliza una respuesta anterior;
4. Chat normal sigue usando el routing y provider correctos;
5. no se inicia exec fallback despues de comenzar un Turn App Server.

Plan y Skills se persisten solo como preferencias de Task. Paths, config, errores privados y contenido interno permanecen en Main. Los tokens de Skills expiran a los 30 minutos, estan ligados a la ventana y son de un solo uso.

## Upgrade

Al actualizar Codex se debe regenerar el contrato, ejecutar `npm run codex:app-server:contract`, revisar params/responses/events, actualizar `UPSTREAM_VALIDATED_VERSION` y habilitar nuevamente los flags solo despues de los gates. Nunca se amplian rangos de version para ocultar un mismatch.

## Evidencia de certificacion 10.1

En Codex 0.134.0 real, `collaborationMode/list` devolvio Plan/Default y un Turn Plan emitio `plan.delta`; Default no emitio plan. Se descubrieron 77 Skills y una seleccion real se envio con token opaco consumido una vez. MCP devolvio cinco servidores ready y 137 tools sanitizadas, y el inventario reaparecio despues de reiniciar App Server. Plugins continuo read-only y no se probo instalacion/configuracion.

Estas aprobaciones no cambian su estabilidad: Plan, Skills, Plugins y lifecycle MCP siguen experimentales, version-pinned y fail-closed.
