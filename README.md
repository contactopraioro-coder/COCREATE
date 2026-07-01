# Caleidoscopio Overlay

Este repo contiene dos cosas:

- la app de Electron para el overlay pegado a Codex
- la landing blanca de descarga para desplegar en Vercel

## Desarrollo del overlay

```bash
npm install
npm run dev
```

## Landing local

```bash
npm run dev:site
```

## Builds

```bash
npm run build
```

## Instalador macOS

```bash
npm run dist:mac
```

Esto genera `.dmg` y `.zip` en `release/`.

## Permisos de macOS

La app usa `Accessibility` para leer la geometria de la ventana de Codex.

Activalo en:

`System Settings -> Privacy & Security -> Accessibility`

## Variables

Configura nombre de app objetivo y offsets en [.env.example](/Users/lahighway/Documents/CALEIDOSCOPIO/.env.example).
