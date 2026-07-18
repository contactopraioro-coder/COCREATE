import { ArchiveRestore, FolderOpen, Plus, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorkspaceExperienceState } from "../../app/services/workspace-experience-service.js";

export type WorkspaceContextActions = {
  selectProject: (id: string) => Promise<unknown>;
  createProject: (name: string) => Promise<unknown>;
  createProjectFromDirectory: () => Promise<unknown>;
  renameProject: (id: string, name: string) => Promise<unknown>;
  archiveProject: (id: string) => Promise<unknown>;
  restoreProject: (id: string) => Promise<unknown>;
  associateDirectory: (id: string) => Promise<unknown>;
  selectTask: (id: string) => Promise<unknown>;
  createTask: (projectId: string | null, title: string) => Promise<unknown>;
  renameTask: (id: string, title: string) => Promise<unknown>;
  changeTaskStatus: (id: string, status: string) => Promise<unknown>;
  restoreTask: (id: string) => Promise<unknown>;
  associateTaskProject: (id: string, projectId: string | null) => Promise<unknown>;
  selectConversation: (id: string) => Promise<unknown>;
  createConversation: (taskId: string) => Promise<unknown>;
};

type Props = {
  state: WorkspaceExperienceState;
  actions: WorkspaceContextActions;
  busy: boolean;
  error: string | null;
};

const taskStatuses = ["active", "blocked", "waiting", "review", "done", "archived"];
const taskStatusLabels: Record<string, string> = {
  active: "En curso",
  blocked: "Bloqueada",
  waiting: "En espera",
  review: "En revisión",
  done: "Terminada",
  archived: "Archivada"
};

export function WorkspaceContextBar({ state, actions, busy, error }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectName, setProjectName] = useState(state.project?.name ?? "");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState(state.task?.name ?? "");

  useEffect(() => setProjectName(state.project?.name ?? ""), [state.project?.id, state.project?.name]);
  useEffect(() => setTaskTitle(state.task?.name ?? ""), [state.task?.id, state.task?.name]);

  const activeProjects = state.projects.filter((project) => !project.archived);
  const archivedProjects = state.projects.filter((project) => project.archived);
  const activeTasks = state.tasks.filter((task) => !task.archived);
  const archivedTasks = state.tasks.filter((task) => task.archived);

  return (
    <section className="workspace-context" aria-label="Conversación actual">
      <div className="workspace-context-copy">
        <h1>{state.conversation?.title ?? state.task?.name ?? "Nueva conversación"}</h1>
        {state.project?.name ? <span>{state.project.name}</span> : null}
      </div>
      <button
        type="button"
        className="context-manage-button"
        aria-label="Administrar proyecto y tarea"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <Settings2 size={15} />
      </button>

      {expanded ? (
        <div className="workspace-context-drawer">
          <section aria-labelledby="project-context-title">
            <div className="context-drawer-heading">
              <strong id="project-context-title">Proyecto</strong>
              <small>{state.project?.hasDirectory ? state.project.rootPathLabel : "Sin carpeta asociada"}</small>
            </div>
            <div className="context-entity-list" aria-label="Proyectos disponibles">
              {activeProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={project.id === state.project?.id ? "active" : ""}
                  disabled={busy}
                  onClick={() => void actions.selectProject(project.id)}
                >
                  <span>{project.name}</span><small>{project.hasDirectory ? project.rootPathLabel : "Sin carpeta"}</small>
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!newProjectName.trim()) return;
                void actions.createProject(newProjectName.trim()).then(() => setNewProjectName(""));
              }}
            >
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Nuevo proyecto"
                aria-label="Nombre del nuevo proyecto"
                maxLength={80}
              />
              <button type="submit" disabled={busy || !newProjectName.trim()} aria-label="Crear proyecto"><Plus size={14} /></button>
            </form>
            {state.environment === "desktop" ? (
              <button type="button" className="context-add-conversation" disabled={busy} onClick={() => void actions.createProjectFromDirectory()}>
                <FolderOpen size={14} /> Agregar carpeta como proyecto
              </button>
            ) : null}
            {state.project ? (
              <div className="context-edit-row">
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="Renombrar proyecto" maxLength={80} />
                <button type="button" disabled={busy || !projectName.trim()} onClick={() => void actions.renameProject(state.project!.id, projectName)}>Guardar</button>
                {state.environment === "desktop" ? (
                  <button type="button" disabled={busy} onClick={() => void actions.associateDirectory(state.project!.id)} title="Asociar directorio">
                    <FolderOpen size={14} />
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={() => void actions.archiveProject(state.project!.id)} title="Archivar proyecto">Archivar</button>
              </div>
            ) : null}
            {archivedProjects.length ? (
              <div className="context-restore-list" aria-label="Proyectos archivados">
                {archivedProjects.map((project) => (
                  <button key={project.id} type="button" disabled={busy} onClick={() => void actions.restoreProject(project.id)}>
                    <ArchiveRestore size={13} /> Restaurar {project.name}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="task-context-title">
            <div className="context-drawer-heading">
              <strong id="task-context-title">Tarea</strong>
              <small>{state.task ? taskStatusLabels[state.task.status] ?? state.task.status : "Selecciona un proyecto"}</small>
            </div>
            <div className="context-entity-list" aria-label="Tareas disponibles">
              {activeTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={task.id === state.task?.id ? "active" : ""}
                  disabled={busy}
                  onClick={() => void actions.selectTask(task.id)}
                >
                  <span>{task.name}</span><small>{task.activeExecutionId ? "Trabajando" : taskStatusLabels[task.status] ?? task.status}</small>
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!newTaskTitle.trim()) return;
                void actions.createTask(state.project?.id ?? null, newTaskTitle.trim()).then(() => setNewTaskTitle(""));
              }}
            >
              <input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                placeholder="Nueva tarea"
                aria-label="Título de la nueva tarea"
                maxLength={100}
              />
              <button type="submit" disabled={busy || !newTaskTitle.trim()} aria-label="Crear tarea"><Plus size={14} /></button>
            </form>
            {state.task ? (
              <div className="context-task-controls">
                <label className="context-project-association">
                  <span>Proyecto vinculado</span>
                  <select
                    value={state.task.projectId ?? ""}
                    disabled={busy}
                    onChange={(event) => void actions.associateTaskProject(state.task!.id, event.target.value || null)}
                  >
                    <option value="">Sin proyecto</option>
                    {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
                <div className="context-edit-row">
                  <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} aria-label="Cambiar título de tarea" maxLength={100} />
                  <button type="button" disabled={busy || !taskTitle.trim()} onClick={() => void actions.renameTask(state.task!.id, taskTitle)}>Guardar</button>
                </div>
                <div className="task-status-actions" aria-label="Cambiar estado de tarea">
                  {taskStatuses.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={state.task?.status === status ? "active" : ""}
                      disabled={busy || state.task?.status === status}
                      onClick={() => void actions.changeTaskStatus(state.task!.id, status)}
                    >
                      {taskStatusLabels[status] ?? status}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {archivedTasks.length ? (
              <div className="context-restore-list" aria-label="Tareas archivadas">
                {archivedTasks.map((task) => (
                  <button key={task.id} type="button" disabled={busy} onClick={() => void actions.restoreTask(task.id)}>
                    <ArchiveRestore size={13} /> Restaurar {task.name}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="conversation-context-title">
            <div className="context-drawer-heading">
              <strong id="conversation-context-title">Conversaciones</strong>
            </div>
            <div className="context-conversation-list">
              {state.conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={conversation.id === state.conversation?.id ? "active" : ""}
                  disabled={busy}
                  onClick={() => void actions.selectConversation(conversation.id)}
                >
                  <span>{conversation.title}</span>
                  <small>{conversation.id === state.conversation?.id ? "Actual" : "Abrir"}</small>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="context-add-conversation"
              disabled={busy || !state.task}
              onClick={() => state.task && void actions.createConversation(state.task.id)}
            >
              <Plus size={14} /> Nueva conversación
            </button>
          </section>
          {error ? <div className="context-error" role="alert">{error}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
