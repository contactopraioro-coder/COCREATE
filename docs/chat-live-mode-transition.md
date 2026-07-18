# Chat / Live Mode Transition

## Estado compartido

Chat y Live usan la misma conversación. El límite de modo está dentro de `CoCreateV01Experience`, después del sidebar y antes de la superficie principal.

| Estado | Chat → Live | Live → Chat |
| --- | --- | --- |
| Conversation / Task / Project | conserva | conserva |
| Historial | oculta | restaura |
| Draft del chat | conserva | restaura |
| Scroll | captura | restaura |
| Composer normal | oculta | restaura y enfoca |
| Proposal | abre/restaura | conserva o descarta según decisión |
| Screen stream | solicita explícitamente | siempre detiene |

## Entrada

Si no existe conversación, activar Live crea una tarea vacía sin proyecto y mantiene esa misma conversación. El modo inicia `VisualCollaborationService` con el ID de conversación como contexto. No inicia captura.

## Salida sin aprobación

“Salir de Live” pregunta si se conserva el borrador. Conservar mantiene Proposal Workspace e historial. Descartar destruye la propuesta activa cuando corresponde y elimina el historial conceptual. Ninguna salida ejecuta Apply.

## Aprobación

El orden es bloqueante:

```text
Validate → Approve → Stop capture → Chat → Summary → Apply → Refresh → Result
```

`Apply` nunca se ejecuta mientras el usuario permanece en el layout Live. Un fallo anterior a la salida permanece visible en Live; un fallo posterior se reporta en la conversación restaurada.

## Persistencia

El snapshot conserva `workspaceMode`, `liveInstruction` y estado serializable de Visual Collaboration. El stream, puntero y anotaciones no forman parte del snapshot. En restauración se recupera el layout y se vuelve al chooser para obtener nuevo consentimiento.

## Guardas

- Live no existe en `FeatureRoute` como navegación visible.
- El sidebar no depende de `workspaceMode`.
- `LiveTimeline` y `LiveActivityPanel` no se montan en la experiencia principal.
- El composer y el thread solo se montan en modo Chat.

