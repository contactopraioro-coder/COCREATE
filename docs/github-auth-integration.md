# GitHub Authentication Integration

## Estado v2

`Disabled / Authentication required`.

Codex `0.134.0` no expone una surface GitHub-specific de autenticacion o Pull Requests fijada por CoCreate. Un MCP llamado GitHub puede aparecer en discovery, pero su nombre, auth label o tool list no prueban scopes ni autorizan a CoCreate a publicar datos de PRs. Por seguridad, `githubIntegration` permanece forzado a `false`.

CoCreate v2 no solicita, almacena ni transporta personal access tokens, OAuth codes o refresh tokens. Tampoco implementa un cliente GitHub, OAuth paralelo ni URLs simuladas. Pull Requests muestra `Authentication required`; filtros, listas y apertura externa solo se habilitaran con una gateway real.

## Contrato futuro minimo

Una integracion aceptable debe vivir en Main o backend seguro y publicar solo:

- estado `disconnected`, `connecting`, `connected`, `expired` o `scopes-missing`;
- identidad publica minima de la cuenta;
- scopes normalizados sin credenciales;
- lista paginada de PRs con Project relation;
- URL HTTPS validada entregada por GitHub;
- disconnect y revocacion verificables;
- errores seguros y timestamps de ultima comprobacion.

El renderer nunca recibira token, cookie, header, client secret ni config MCP. Hasta que ese contrato exista y tenga tests de auth expirada, scopes, disconnect y no-exposicion, la capability debe seguir deshabilitada sin bloquear Chat ni Live Coding.

## Certificacion 10.1

El gate real detecto MCP y tools sanitizadas, pero no encontro una surface GitHub-specific ni uso discovery como prueba de autenticacion. Pull requests siguio mostrando `Authentication required` en Desktop/Web, sin datos simulados, URLs inventadas o tokens en renderer. No se amplio alcance ni se creo OAuth durante la certificacion.
