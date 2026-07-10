# Checklist Operativo

## GitHub

- Confirmar acceso de escritura al repo `contactopraioro-coder/caleidoscopio-overlay`.
- Activar proteccion de rama sobre `main`.
- Exigir el workflow `CI`.
- Configurar pull requests con revisiones antes de merge.

## Vercel

- Confirmar que el proyecto `caleidoscopio-overlay` sigue apuntando a este repo.
- Revisar comando de build.
- Revisar rama de produccion.
- Configurar variables de entorno por ambiente.
- Validar si Vercel publicara solo la capa web o tambien APIs.

## Entorno local

- Instalar dependencias con `npm install`.
- Verificar build con `npm run build`.
- Verificar permisos de macOS para captura de pantalla.
- Verificar disponibilidad del binario `codex`.

## Persistencia

- No depender de `localStorage` para datos criticos.
- No depender de `data/store.json` para produccion.
- Definir base de datos durable.
- Definir object storage para grabaciones y artefactos.

## Sesiones

- Crear identificadores unicos de sesion, proyecto e hilo.
- Persistir mensajes, eventos y ejecuciones.
- Restaurar estado tras reinicio.

## Live editing

- Implementar feature flag para el modo comparativo antes/despues.
- Separar captura del "antes" del preview del "despues".
- Definir frecuencia de chunks inicial: `10s`.
- Ajustar a `5s` solo si la latencia y el costo lo permiten.
