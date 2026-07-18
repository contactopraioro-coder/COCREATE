# Live Preview Runtime

## Responsabilidad

Live Preview Runtime ejecuta exclusivamente la aplicación del Proposal Workspace. Nunca reutiliza la URL o el proceso de Current.

## Flujo

```text
Proposal Applying
  -> calcular diff
  -> elegir preview command
  -> reservar puerto localhost
  -> iniciar proceso con cwd aislado
  -> health check
  -> Ready + URL opaca para renderer
```

El runtime soporta `start`, `stop`, `restart` y `refresh`. `refresh` cambia el token del iframe; `restart` reemplaza proceso y puerto. Si el proceso termina inesperadamente, la Proposal pasa a `Failed` y muestra un error sanitizado.

El cierre del servidor está acotado y finaliza conexiones HTTP idle o persistentes del iframe antes de destruir el workspace. Esto evita que Stop o Apply queden esperando una conexión keep-alive.

## Detección

El orden de scripts es:

1. `dev`
2. `preview`
3. `start`

Vite y Next reciben host/puerto explícitos. Otros scripts reciben `PORT` y se ejecutan sin shell. Si no hay script pero existe `index.html`, se levanta un servidor estático seguro con fallback SPA. Si ninguna surface es ejecutable, la UI explica el motivo y no simula éxito.

## Hot reload y rendimiento

Un script `dev` declara hot reload. Las fuentes se sirven desde la copia y las dependencias se reutilizan, por lo que no se ejecuta `npm install` ni se duplica `node_modules`. La carga y health check son incrementales; reiniciar el preview no recrea el workspace.

## Aislamiento

- Proceso con `cwd` en Proposal Workspace.
- Variables de entorno reducidas a PATH/HOME/temporales/locale.
- Sin API keys ni secretos de CoCreate.
- `shell: false`.
- Escucha solo en `127.0.0.1`.
- Iframe con sandbox y `referrerPolicy=no-referrer`.
- Logs limitados, rutas sustituidas y secretos redactados.

## Estados honestos

`stopped`, `starting`, `ready` y `failed` provienen del proceso y del health check real. Web no publica un preview local falso; explica que la capability requiere Desktop.
