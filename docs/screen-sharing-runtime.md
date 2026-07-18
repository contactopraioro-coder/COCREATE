# Screen Sharing Runtime

## Arquitectura

```text
LiveShareChooser
→ ScreenSharingService
→ ScreenSharingGateway
→ Browser getDisplayMedia / Electron system picker
```

La UI no accede directamente a Electron ni conserva streams. El servicio de aplicación mantiene el ciclo de vida; el gateway contiene la integración de plataforma.

## Contrato

`ScreenSharingSnapshot` contiene únicamente estado seguro: soporte, permiso, preferencia, etiqueta corta, tipo de superficie, dimensiones, inicio, error y timestamp. El `MediaStream` permanece privado en memoria y se obtiene mediante `getStream()` solo para conectarlo al elemento `<video>`.

Estados soportados:

- `idle`
- `requesting`
- `sharing`
- `paused`
- `ended`
- `cancelled`
- `permission-denied`
- `unsupported`
- `error`

## Consentimiento

Cada inicio o cambio llama al selector nativo. La preferencia pantalla, ventana o pestaña es una pista; el usuario conserva la decisión final del selector. No hay captura al entrar en Live ni al restaurar una sesión.

`audio: false` es obligatorio. No se solicita audio del sistema.

## Ciclo de vida

- Una selección válida reemplaza la superficie anterior y detiene sus tracks.
- Cancelar “Cambiar pantalla” conserva el stream anterior.
- Pausar deshabilita tracks de video sin crear una grabación.
- Detener, salir, aprobar, desmontar o recibir `track.ended` limpia la referencia y los tracks.
- Las solicitudes concurrentes usan una secuencia; una respuesta obsoleta se detiene y se descarta.

## Desktop y macOS

Electron habilita `setDisplayMediaRequestHandler` con el system picker. Un IPC mínimo consulta `systemPreferences.getMediaAccessStatus("screen")` y abre la sección de Screen Recording cuando el permiso fue denegado. El renderer no recibe listas de fuentes, thumbnails, rutas ni secretos.

## Seguridad

- No se serializa el stream ni frames de captura.
- No se usa `MediaRecorder`.
- No se solicitan cookies, DOM cross-origin, audio del sistema ni headers.
- El indicador de compartición permanece visible.
- La selección visual usa regiones normalizadas y nombres humanos, no selectores CSS ni HTML.
- Errores de permiso, cancelación, incompatibilidad y lectura tienen mensajes específicos.

