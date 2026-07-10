# CoCreate Desktop

Plataforma Electron + Vite para una experiencia de coding colaborativa sobre una capa visual propia.

Incluye:

- shell Electron multiplataforma con estilo limpio tipo Mac
- capa `Codex upstream` preparada para usar el CLI open source `openai/codex`
- herramienta Caleidoscopio para capturar pantalla y audio
- analisis de video con Gemini para convertir contexto en prompts de trabajo
- vista web local para pruebas rapidas

## Desarrollo Desktop

```bash
npm install
npm run dev
```

Esto levanta el renderer de escritorio en `http://localhost:5174/` y abre la ventana Electron.

## Desarrollo Web

```bash
npm run dev:site -- --host 127.0.0.1 --port 4173
```

La version web queda en:

`http://127.0.0.1:4173/`

## Codex Upstream

CoCreate no modifica el codigo fuente de Codex. La app expone una capa de adaptador para detectar y usar el binario `codex` como proceso upstream.

Puedes cambiar el binario con:

```bash
CODEX_BINARY=/ruta/a/codex npm run dev
```

Referencia verificada: `openai/codex` esta licenciado bajo Apache-2.0.

## Configuracion

```bash
GEMINI_MODEL=gemini-3.5-flash
CODEX_BINARY=codex
```

## Build

```bash
npm run build
```

## Deploy Web

La experiencia web desplegable en hosting usa solo el renderer Vite principal.

- Vercel: `npm run build:site` con salida en `dist`
- Render Static Site: `npm ci && npm run build:site` con publish path `dist`

La parte Electron sigue siendo local de escritorio y no se despliega como app nativa en Vercel ni Render.

## Permisos

Para capturar pantalla, macOS puede pedir permisos en:

`System Settings -> Privacy & Security -> Screen Recording`
