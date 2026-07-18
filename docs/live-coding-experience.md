# Live Coding Experience

## Veredicto de alineación

Live Coding es un modo visual de la conversación activa. No es una ruta, una tarjeta, una conversación adicional ni una sección del sidebar.

```text
Sidebar fijo
└── Conversation Workspace
    ├── Chat
    └── Live
```

El contrato público es `ConversationMode = "chat" | "live"`. El cambio de modo conserva `Conversation`, `Task`, `Project`, draft y posición de scroll.

## Flujo de producto

1. El usuario activa Live desde la conversación.
2. El thread y el composer normal se desmontan visualmente.
3. CoCreate solicita elegir pantalla, ventana o pestaña. Preview de proyecto y URL son opciones secundarias.
4. `Current` muestra únicamente la superficie autorizada.
5. Texto, voz, selección, puntero y anotaciones producen iteraciones en `Proposal`.
6. Cada iteración ejecutable vive en un Proposal Workspace aislado; `Current` y el proyecto permanecen intactos.
7. `Aprobar y desarrollar` valida y aprueba, detiene la captura, restaura Chat y solo entonces aplica la propuesta.
8. El chat recibe el resumen, el progreso, las validaciones y el resultado.

## Layout

Desktop usa `Live Header / Current | Proposal / Live Controls`, con divisor redimensionable y modos Current, Proposal, Split y Overlay. Móvil presenta Current y Proposal como vistas exclusivas seleccionables, sin split ilegible ni overflow horizontal.

El header muestra solo el estado de compartición, el nombre corto de la superficie, cambiar pantalla, fullscreen y salir. No expone App Server, runtime, localhost, IDs ni diagnósticos.

## Proposal e iteraciones

`VisualCollaborationService` conserva la selección, el historial conceptual y la comparación. `ProposalRuntimeService` conserva las iteraciones ejecutables, su preview, diff y validación. Las instrucciones de voz y texto usan el mismo flujo; una transcripción puede revisarse antes de enviarse.

Sin proyecto se permiten observación, voz, selección, anotaciones y propuesta conceptual. El desarrollo real exige una tarea vinculada a una carpeta de proyecto en Desktop.

## Salida y restauración

Salir ofrece conservar o descartar el borrador. Ambas opciones detienen todos los tracks. Descartar elimina iteraciones y contexto efímero sin modificar archivos.

Se persisten modo, layout, selección, historial, propuestas e instrucción en edición. Puntero, anotaciones y `MediaStream` nunca se persisten. Tras reiniciar puede restaurarse Live, pero siempre vuelve a solicitar consentimiento para capturar.

## Superficies

- Web usa `getDisplayMedia` y mantiene Proposal conceptual cuando no dispone de filesystem local.
- Desktop usa el selector del sistema, permiso de Screen Recording en macOS y Proposal Runtime sobre una copia temporal.
- Ninguna superficie inicia captura automáticamente ni aplica código antes de aprobación.

## Evidencia automatizada

La suite cubre transición estructural Chat/Live, captura y cleanup, cancelación, permiso denegado, stream finalizado, iteraciones, undo, descarte, aislamiento, aprobación antes de Apply y tarea sin proyecto.

