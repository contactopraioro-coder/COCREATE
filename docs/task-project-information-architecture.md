# Task / Project Information Architecture

## Modelo

Un `Project` es una asociación persistente del Workspace con una carpeta o repositorio. Una `Task` es el trabajo conversacional y puede existir sin proyecto.

```text
Workspace
├── Projects (0..n)
└── Tasks (0..n)
    └── Conversations (1..n)
```

`Task.projectId` y `Conversation.projectId` son anulables. Asociar o mover una Task actualiza sus conversaciones sin perder mensajes, artifacts, ejecuciones ni título.

## Nueva tarea

El botón crea atómicamente una Task sin proyecto y su Conversation inicial, abre Chat y enfoca el composer. No abre una ruta, no muestra formulario, no crea Project y no exige título de resultado. El título inicial puede generarse después desde la conversación.

## Sidebar

El sidebar separa navegación de producto, `PROYECTOS` y `TAREAS`. El botón `+` de Proyectos registra un proyecto; en Desktop también permite seleccionar una carpeta local. Las tareas muestran de forma secundaria su proyecto o “Sin proyecto”.

## Asociación posterior

La tarea puede vincularse desde el administrador discreto de contexto o desde Live antes de desarrollar. El diálogo permite:

- elegir proyecto existente;
- crear y vincular un proyecto;
- elegir una carpeta como proyecto en Desktop;
- cambiar o quitar la asociación desde el contexto de la conversación.

Web permite proyectos lógicos, pero no finge filesystem. El desarrollo sobre archivos locales requiere Desktop y carpeta asociada.

## Runtime compartido

Los gateways Web y Desktop conservan el mismo contrato anulable. `listTasks(null)` lista todas las tareas del Workspace, lo que evita esconder conversaciones sin proyecto. `getBootstrap()` devuelve todas las conversaciones del Workspace y mantiene el contexto activo separado.

## Compatibilidad

Las tareas existentes conservan su `projectId`. No hay migración destructiva. La ruta heredada `#/new-task` se normaliza a Chat para impedir que reaparezca el formulario anterior.

