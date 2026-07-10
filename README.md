# Caleidoscopio Recorder

Desktop app en Electron + Vite para:

- capturar pantalla en macOS
- guardar la grabacion localmente
- subir el video a Gemini
- devolver prompts listos para pegar en Codex

## Desarrollo

```bash
npm install
npm run dev
```

La interfaz del desktop app vive en `overlay-src/` y el proceso principal de Electron en `electron/`.

## Uso

1. Arranca la app con `npm run dev`.
2. Pulsa `Iniciar captura` y elige una pantalla o ventana.
3. Pulsa `Detener`.
4. Pega tu API key de Google AI Studio.
5. Pulsa `Crear prompts`.

La app guarda los videos en `~/Movies/Caleidoscopio`.

## Configuracion

Puedes definir un modelo por defecto en `.env`:

```bash
GEMINI_MODEL=gemini-3.5-flash
```

## Build

```bash
npm run build
```

## Permisos de macOS

Para capturar pantalla, macOS puede pedir permisos en:

`System Settings -> Privacy & Security -> Screen Recording`
