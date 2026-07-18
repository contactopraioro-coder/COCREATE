import {
  canTransitionTaskStatus,
  createActivityId,
  createArtifactId,
  createConversationId,
  createDomainEvent,
  createProjectId,
  createSessionId,
  createTaskId,
  nowIso
} from "./workspace-domain.js";
import { createCodexAgentActor, createHumanActor, createSystemActor, normalizeLegacyActor } from "./identity-domain.js";
import { createWorkspaceEventBus } from "./workspace-event-bus.js";
import { isValidCitation } from "./trusted-web-contracts.js";
import { mapUpstreamEventToProductEvent } from "./upstream-capability-exposure.js";

function normalizeMessageMetadata(value) {
  if (!value || typeof value !== "object") return undefined;
  const citations = Array.isArray(value.citations) ? value.citations.filter(isValidCitation).slice(0, 8) : [];
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((item) => typeof item === "string").slice(0, 12)
    : [];
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .filter((item) => item && typeof item === "object" && typeof item.description === "string")
        .slice(0, 6)
        .map((item) => ({ description: item.description.slice(0, 500) }))
    : [];
  return {
    confidence: typeof value.confidence === "string" ? value.confidence : "Unavailable",
    grounded: value.grounded === true,
    verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : undefined,
    citations,
    warnings,
    conflicts,
    provider: typeof value.provider === "string" ? value.provider : undefined,
    tool: value.tool === "TrustedWebTool" ? value.tool : undefined
  };
}

function normalizeAssistantPreferences(value) {
  if (!value || typeof value !== "object") return null;
  return {
    planModeEnabled: value.planModeEnabled === true,
    planModeName: typeof value.planModeName === "string" ? value.planModeName.slice(0, 80) : null,
    selectedSkillNames: Array.isArray(value.selectedSkillNames)
      ? Array.from(new Set(value.selectedSkillNames.filter((item) => typeof item === "string").map((item) => item.slice(0, 160)))).slice(0, 8)
      : []
  };
}

function toThreadSummary(conversation, messages) {
  const lastMessage = messages[messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    preview: lastMessage?.body?.slice(0, 72) ?? "Sin mensajes todavía"
  };
}

function buildActivitySummary(type, entity, data = {}) {
  if (typeof data.activitySummary === "string" && data.activitySummary.trim()) {
    return data.activitySummary.slice(0, 500);
  }
  switch (type) {
    case "workspace.created":
      return `Se creó el workspace ${entity?.name ?? "personal"}.`;
    case "project.created":
      return `Se creó el proyecto ${entity?.name ?? "sin nombre"}.`;
    case "project.opened":
      return `Se abrió el proyecto ${entity?.name ?? "sin nombre"}.`;
    case "project.updated":
      return `Se actualizó el proyecto ${entity?.name ?? "sin nombre"}.`;
    case "project.archived":
      return `Se archivó el proyecto ${entity?.name ?? "sin nombre"}.`;
    case "task.created":
      return `Se creó la tarea ${entity?.title ?? "Nueva tarea"}.`;
    case "task.started":
      return `Se inició la tarea ${entity?.title ?? "Nueva tarea"}.`;
    case "task.updated":
      return `Se actualizó la tarea ${entity?.title ?? "Nueva tarea"}.`;
    case "task.completed":
      return `Se completó la tarea ${entity?.title ?? "Nueva tarea"}.`;
    case "task.statusChanged":
      return `La tarea ${entity?.title ?? "Nueva tarea"} cambió a ${entity?.status ?? "otro estado"}.`;
    case "conversation.created":
      return `Se creó la conversación ${entity?.title ?? "Nuevo chat"}.`;
    case "conversation.updated":
      return `Se actualizó la conversación ${entity?.title ?? "Nuevo chat"}.`;
    case "session.started":
      return "Se inició una nueva sesión de trabajo.";
    case "session.restored":
      return "Se restauró la última sesión de trabajo.";
    case "session.interrupted":
      return "La sesión anterior se marcó como interrumpida.";
    case "execution.started":
      return "Se inició una ejecución de Codex.";
    case "execution.completed":
      return "La ejecución de Codex terminó correctamente.";
    case "execution.failed":
      return "La ejecución de Codex terminó con error.";
    case "execution.cancelled":
      return "La ejecución de Codex fue cancelada.";
    case "codex.thread.mapped":
      return "La conversación quedó asociada a un thread de Codex.";
    case "codex.diff.updated":
      return "Codex actualizó el diff de la ejecución.";
    case "codex.command.completed":
      return "Codex completó un comando.";
    case "codex.mcp.completed":
      return "Codex completó una herramienta MCP.";
    case "codex.webSearch.completed":
      return "Codex completó una búsqueda web heredada.";
    case "web.execution.started":
      return "CoCreate inició una verificación web pública.";
    case "web.execution.completed":
      return `CoCreate verificó información en ${entity?.sourcesCount ?? 0} fuentes públicas.`;
    case "web.execution.failed":
      return "La consulta web no pudo completarse.";
    case "web.execution.cancelled":
      return "La consulta web fue cancelada.";
    case "artifact.created":
      return `Se registró el artifact ${entity?.title ?? "Resultado"}.`;
    default:
      return "Se registró una actividad.";
  }
}

export function createWorkspaceRuntime({ store }) {
  const eventBus = createWorkspaceEventBus();

  function resolveActors(context = {}) {
    const identity = context.identity ?? null;
    const profile = context.profile ?? null;
    return {
      human: identity ? createHumanActor(identity, profile) : createSystemActor(),
      system: createSystemActor(),
      codex: createCodexAgentActor()
    };
  }

  function createActivity(event, state) {
    const relatedArtifact = event.entity?.kind === "artifact"
      ? state.artifacts.find((entry) => entry.id === event.entity.id)
      : null;
    const relatedExecution = event.entity?.kind === "execution"
      ? state.executionReferences.find((entry) => entry.executionId === event.entity.id)
      : null;
    const eventProjectId = typeof event.data?.projectId === "string" ? event.data.projectId : null;
    const eventTaskId = typeof event.data?.taskId === "string" ? event.data.taskId : null;
    const activity = {
      id: createActivityId(),
      workspaceId: event.workspaceId ?? relatedArtifact?.workspaceId ?? relatedExecution?.workspaceId ?? state.activeWorkspaceId,
      projectId: eventProjectId ?? relatedArtifact?.projectId ?? relatedExecution?.projectId ?? state.activeProjectId,
      taskId: eventTaskId ?? relatedArtifact?.taskId ?? relatedExecution?.taskId ??
        (event.entity?.kind === "task" ? event.entity.id : state.activeTaskId),
      actor: normalizeLegacyActor(event.actor),
      type: event.type,
      summary: buildActivitySummary(event.type, event.entity, event.data),
      timestamp: event.timestamp,
      relatedEntity: event.entity
        ? {
            id: event.entity.id ?? null,
            kind: event.entity.kind ?? null
          }
        : null,
      metadata: event.data ?? {}
    };
    const last = state.activities[state.activities.length - 1];
    if (last && last.type === activity.type && last.summary === activity.summary && last.timestamp === activity.timestamp) {
      return;
    }
    state.activities.push(activity);
  }

  async function emit(state, event) {
    createActivity(event, state);
    await eventBus.publish(event);
  }

  async function initialize({ legacyAppState, identityContext } = {}) {
    return store.update(async (state) => {
      const actors = resolveActors(identityContext);
      const workspace = store.ensurePersonalWorkspace(state);
      if (!workspace.owner) {
        workspace.owner = {
          type: "identity",
          id: identityContext?.identity?.id ?? "identity_missing_owner"
        };
      }
      const project = store.ensureCompatibilityProject(state, workspace);

      if (store.migrateLegacyAppState(state, legacyAppState)) {
        if (!state.activeTaskId) {
          const firstTask = state.tasks.find((entry) => entry.projectId === project.id);
          if (firstTask) {
            state.activeTaskId = firstTask.id;
            state.activeConversationId = firstTask.activeConversationId ?? null;
            project.activeTaskId = firstTask.id;
          }
        }
      }

      const previousSession = state.sessions.find(
        (entry) => entry.id === state.activeSessionId && (entry.status === "active" || entry.status === "restored")
      );
      const previousOperationalState = previousSession?.operationalState ?? null;
      if (previousSession) {
        previousSession.status = "interrupted";
        previousSession.endedAt = nowIso();
        await emit(
          state,
          createDomainEvent("session.interrupted", {
            workspaceId: state.activeWorkspaceId,
            actor: actors.system,
            entity: {
              id: previousSession.id,
              kind: "session"
            }
          })
        );
      }

      const newSession = {
        id: createSessionId(),
        workspaceId: workspace.id,
        projectId: state.activeProjectId,
        taskId: state.activeTaskId,
        conversationId: state.activeConversationId,
        startedAt: nowIso(),
        endedAt: null,
        status: previousSession ? "restored" : "active",
        restoredFromSessionId: previousSession?.id ?? null,
        operationalState: {
          activeWorkspaceId: state.activeWorkspaceId,
          activeProjectId: state.activeProjectId,
          activeTaskId: state.activeTaskId,
          activeConversationId: state.activeConversationId,
          activeExecutionId: null,
          activeCodexThreadId: previousOperationalState?.activeCodexThreadId ?? null,
          activeCodexTurnId: null,
          activeCapability: null,
          capabilityStatus: previousOperationalState?.activeExecutionId ? "Interrupted" : "Idle",
          lastExecutionId: previousOperationalState?.activeExecutionId ?? previousOperationalState?.lastExecutionId ?? null,
          lastCodexTurnId: previousOperationalState?.activeCodexTurnId ?? previousOperationalState?.lastCodexTurnId ?? null
        }
      };
      if (previousOperationalState?.activeExecutionId) {
        const interruptedExecution = state.executionReferences.find(
          (entry) => entry.executionId === previousOperationalState.activeExecutionId
        );
        if (interruptedExecution && !["completed", "failed", "cancelled", "interrupted"].includes(interruptedExecution.status)) {
          interruptedExecution.status = "interrupted";
          interruptedExecution.updatedAt = nowIso();
        }
        const interruptedTask = state.tasks.find((entry) => entry.id === previousSession?.taskId);
        if (interruptedTask) {
          interruptedTask.metadata = {
            ...interruptedTask.metadata,
            activeExecutionId: null,
            activeCodexTurnId: null,
            capabilityStatus: "Interrupted"
          };
          interruptedTask.updatedAt = nowIso();
        }
      }
      state.sessions.push(newSession);
      state.activeSessionId = newSession.id;
      await emit(
        state,
        createDomainEvent(previousSession ? "session.restored" : "session.started", {
          workspaceId: state.activeWorkspaceId,
          actor: previousSession ? actors.system : actors.human,
          entity: {
            id: newSession.id,
            kind: "session"
          }
        })
      );

      if (state.workspaces.length === 1 && state.activities.every((entry) => entry.type !== "workspace.created")) {
        await emit(
          state,
          createDomainEvent("workspace.created", {
            workspaceId: workspace.id,
            actor: actors.system,
            entity: {
              id: workspace.id,
              kind: "workspace",
              name: workspace.name
            }
          })
        );
      }

      if (workspace.owner?.id && state.activities.every((entry) => entry.type !== "workspace.ownerAssigned")) {
        await emit(
          state,
          createDomainEvent("workspace.ownerAssigned", {
            workspaceId: workspace.id,
            actor: actors.system,
            entity: {
              id: workspace.id,
              kind: "workspace",
              name: workspace.name
            },
            data: {
              owner: workspace.owner
            }
          })
        );
      }

      if (state.projects.length === 1 && state.activities.every((entry) => entry.type !== "project.created")) {
        await emit(
          state,
          createDomainEvent("project.created", {
            workspaceId: workspace.id,
            actor: actors.system,
            entity: {
              id: project.id,
              kind: "project",
              name: project.name
            }
          })
        );
      }
    });
  }

  async function getBootstrap() {
    const state = await store.load();
    const activeProject = state.projects.find((entry) => entry.id === state.activeProjectId) ?? null;
    const activeTask = state.tasks.find((entry) => entry.id === state.activeTaskId) ?? null;
    const activeConversation = state.conversations.find((entry) => entry.id === state.activeConversationId) ?? null;
    const activeSession = state.sessions.find((entry) => entry.id === state.activeSessionId) ?? null;
    const activeExecutionId = activeSession?.operationalState?.activeExecutionId ??
      activeSession?.operationalState?.lastExecutionId ?? null;
    const activeExecution = state.executionReferences.find(
      (entry) => entry.executionId === activeExecutionId
    ) ?? null;
    const conversations = state.conversations
      .filter((entry) => entry.workspaceId === state.activeWorkspaceId)
      .map((entry) => ({
        ...entry,
        messages: state.messagesByConversation[entry.id] ?? [],
        thread: toThreadSummary(entry, state.messagesByConversation[entry.id] ?? [])
      }));

    return {
      workspace: state.workspaces.find((entry) => entry.id === state.activeWorkspaceId) ?? null,
      project: activeProject,
      task: activeTask,
      conversation: activeConversation,
      session: activeSession,
      runtime: {
        activeExecution,
        codex: {
          executionId: activeSession?.operationalState?.activeExecutionId ?? null,
          threadId: activeSession?.operationalState?.activeCodexThreadId ?? null,
          turnId: activeSession?.operationalState?.activeCodexTurnId ??
            activeSession?.operationalState?.lastCodexTurnId ?? null,
          capability: activeSession?.operationalState?.activeCapability ?? null,
          status: activeSession?.operationalState?.capabilityStatus ?? "Idle"
        }
      },
      ownership: {
        workspaceOwner: (state.workspaces.find((entry) => entry.id === state.activeWorkspaceId) ?? null)?.owner ?? null
      },
      conversations,
      activities: [...state.activities].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    };
  }

  async function createProject(input = {}, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const workspace = current.workspaces.find((entry) => entry.id === current.activeWorkspaceId);
      if (!workspace) {
        throw new Error("No existe un workspace activo para crear el proyecto.");
      }

      const project = {
        id: createProjectId(),
        workspaceId: workspace.id,
        name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Nuevo proyecto",
        description: typeof input.description === "string" ? input.description.trim() : "",
        status: "active",
        rootPath: typeof input.rootPath === "string" ? input.rootPath : null,
        repository: typeof input.repository === "string" ? input.repository : null,
        createdBy: actors.human,
        updatedBy: actors.human,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastOpenedAt: nowIso(),
        activeTaskId: null,
        metadata: {}
      };
      current.projects.push(project);
      current.activeProjectId = project.id;
      workspace.activeProjectId = project.id;
      await emit(
        current,
        createDomainEvent("project.created", {
          workspaceId: workspace.id,
          actor: actors.human,
          entity: {
            id: project.id,
            kind: "project",
            name: project.name
          }
        })
      );
    });

    return state.projects.find((entry) => entry.id === state.activeProjectId) ?? null;
  }

  async function listProjects(options = {}) {
    const state = await store.load();
    return state.projects.filter(
      (entry) => entry.workspaceId === state.activeWorkspaceId && (options.includeArchived || entry.status !== "archived")
    );
  }

  async function openProject(projectId, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const project = current.projects.find((entry) => entry.id === projectId);
      if (!project || project.status === "archived") {
        throw new Error("No pude abrir el proyecto solicitado.");
      }

      current.activeProjectId = project.id;
      project.lastOpenedAt = nowIso();
      project.updatedAt = nowIso();
      current.activeTaskId = project.activeTaskId ?? null;
      const activeTask = current.tasks.find((entry) => entry.id === current.activeTaskId) ?? null;
      current.activeConversationId = activeTask?.activeConversationId ?? null;
      await emit(
        current,
        createDomainEvent("project.opened", {
          workspaceId: project.workspaceId,
          actor: actors.human,
          entity: {
            id: project.id,
            kind: "project",
            name: project.name
          }
        })
      );
    });

    return state.projects.find((entry) => entry.id === state.activeProjectId) ?? null;
  }

  async function updateProject(projectId, patch, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const project = current.projects.find((entry) => entry.id === projectId);
      if (!project) {
        throw new Error("No encontré el proyecto para actualizar.");
      }

      if (typeof patch.name === "string" && patch.name.trim()) {
        project.name = patch.name.trim();
      }
      if (typeof patch.description === "string") {
        project.description = patch.description.trim();
      }
      if (typeof patch.rootPath === "string" || patch.rootPath === null) {
        project.rootPath = patch.rootPath;
      }
      if (typeof patch.status === "string" && patch.status) {
        project.status = patch.status;
      }
      project.updatedBy = actors.human;
      project.updatedAt = nowIso();
      await emit(current, createDomainEvent(patch.status === "archived" ? "project.archived" : "project.updated", {
        workspaceId: project.workspaceId,
        actor: actors.human,
        entity: { id: project.id, kind: "project", name: project.name },
        data: { projectId: project.id }
      }));
    });

    return state.projects.find((entry) => entry.id === projectId) ?? null;
  }

  async function archiveProject(projectId, identityContext) {
    const archived = await updateProject(projectId, { status: "archived" }, identityContext);
    await store.update(async (current) => {
      if (current.activeProjectId !== projectId) return;
      const fallback = current.projects.find(
        (entry) => entry.workspaceId === current.activeWorkspaceId && entry.id !== projectId && entry.status !== "archived"
      ) ?? null;
      current.activeProjectId = fallback?.id ?? null;
      current.activeTaskId = fallback?.activeTaskId ?? null;
      const fallbackTask = current.tasks.find((entry) => entry.id === current.activeTaskId) ?? null;
      current.activeConversationId = fallbackTask?.activeConversationId ?? null;
      const workspace = current.workspaces.find((entry) => entry.id === current.activeWorkspaceId);
      if (workspace) workspace.activeProjectId = fallback?.id ?? null;
    });
    return archived;
  }

  async function createTask(input = {}, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const requestedProjectId = input.projectId === null ? null : input.projectId ?? current.activeProjectId;
      const project = requestedProjectId
        ? current.projects.find((entry) => entry.id === requestedProjectId && entry.status !== "archived")
        : null;
      if (requestedProjectId && !project) throw new Error("No encontré el proyecto indicado para crear la tarea.");
      const workspace = current.workspaces.find((entry) => entry.id === (project?.workspaceId ?? current.activeWorkspaceId));
      if (!workspace) throw new Error("No encontré un workspace activo para crear la tarea.");

      const task = {
        id: createTaskId(),
        workspaceId: workspace.id,
        projectId: project?.id ?? null,
        title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Nueva tarea",
        description: typeof input.description === "string" ? input.description.trim() : "",
        status: "draft",
        priority: typeof input.priority === "string" ? input.priority : "normal",
        createdBy: actors.human,
        updatedBy: actors.human,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: null,
        activeConversationId: null,
        executionIds: [],
        artifactIds: [],
        metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
      };
      current.tasks.push(task);
      current.activeTaskId = task.id;
      current.activeProjectId = project?.id ?? null;
      workspace.activeProjectId = project?.id ?? null;
      if (project) project.activeTaskId = task.id;

      await emit(
        current,
        createDomainEvent("task.created", {
          workspaceId: task.workspaceId,
          actor: actors.human,
          entity: {
            id: task.id,
            kind: "task",
            title: task.title
          }
        })
      );
    });

    return state.tasks.find((entry) => entry.id === state.activeTaskId) ?? null;
  }

  async function listTasks(projectId, options = {}) {
    const state = await store.load();
    if (projectId === null) {
      return state.tasks.filter(
        (entry) => entry.workspaceId === state.activeWorkspaceId && (options.includeArchived || entry.status !== "archived")
      );
    }
    const targetProjectId = projectId ?? state.activeProjectId;
    return state.tasks.filter(
      (entry) => entry.projectId === targetProjectId && (options.includeArchived || entry.status !== "archived")
    );
  }

  async function updateTask(taskId, patch, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const task = current.tasks.find((entry) => entry.id === taskId);
      if (!task) throw new Error("No encontré la tarea para actualizar.");
      if (typeof patch.title === "string" && patch.title.trim()) task.title = patch.title.trim();
      if (typeof patch.description === "string") task.description = patch.description.trim();
      if (typeof patch.priority === "string" && patch.priority.trim()) task.priority = patch.priority.trim();
      if (Object.prototype.hasOwnProperty.call(patch, "projectId")) {
        const nextProjectId = typeof patch.projectId === "string" && patch.projectId ? patch.projectId : null;
        const nextProject = nextProjectId
          ? current.projects.find((entry) => entry.id === nextProjectId && entry.status !== "archived")
          : null;
        if (nextProjectId && !nextProject) throw new Error("No encontré el proyecto que quieres vincular.");
        if (nextProject && nextProject.workspaceId !== task.workspaceId) {
          throw new Error("La tarea y el proyecto deben pertenecer al mismo workspace.");
        }
        const previousProject = current.projects.find((entry) => entry.id === task.projectId);
        if (previousProject?.activeTaskId === task.id) previousProject.activeTaskId = null;
        task.projectId = nextProject?.id ?? null;
        for (const conversation of current.conversations.filter((entry) => entry.taskId === task.id)) {
          conversation.projectId = task.projectId;
          conversation.updatedAt = nowIso();
        }
        if (current.activeTaskId === task.id) {
          current.activeProjectId = task.projectId;
          const activeWorkspace = current.workspaces.find((entry) => entry.id === task.workspaceId);
          if (activeWorkspace) activeWorkspace.activeProjectId = task.projectId;
          if (nextProject) nextProject.activeTaskId = task.id;
          const activeSession = current.sessions.find((entry) => entry.id === current.activeSessionId);
          if (activeSession) {
            activeSession.projectId = task.projectId;
            activeSession.operationalState = { ...activeSession.operationalState, activeProjectId: task.projectId };
          }
        }
      }
      if (patch.assistantPreferences && typeof patch.assistantPreferences === "object") {
        task.metadata = {
          ...task.metadata,
          assistantPreferences: normalizeAssistantPreferences(patch.assistantPreferences)
        };
      }
      task.updatedBy = actors.human;
      task.updatedAt = nowIso();
      await emit(current, createDomainEvent("task.updated", {
        workspaceId: task.workspaceId,
        actor: actors.human,
        entity: { id: task.id, kind: "task", title: task.title },
        data: { projectId: task.projectId, taskId: task.id }
      }));
    });
    return state.tasks.find((entry) => entry.id === taskId) ?? null;
  }

  async function openTask(taskId, identityContext) {
    const state = await store.update(async (current) => {
      const task = current.tasks.find((entry) => entry.id === taskId);
      if (!task || task.status === "archived") {
        throw new Error("No pude abrir la tarea solicitada.");
      }

      current.activeTaskId = task.id;
      current.activeProjectId = task.projectId;
      current.activeConversationId = task.activeConversationId ?? null;
      const workspace = current.workspaces.find((entry) => entry.id === task.workspaceId);
      if (workspace) workspace.activeProjectId = task.projectId;
      const project = current.projects.find((entry) => entry.id === task.projectId);
      if (project) {
        project.activeTaskId = task.id;
      }
      const activeSession = current.sessions.find((entry) => entry.id === current.activeSessionId);
      if (activeSession) {
        activeSession.projectId = task.projectId;
        activeSession.taskId = task.id;
        activeSession.conversationId = task.activeConversationId ?? null;
        activeSession.operationalState = {
          ...activeSession.operationalState,
          activeProjectId: task.projectId,
          activeTaskId: task.id,
          activeConversationId: task.activeConversationId ?? null,
          activeExecutionId: task.metadata.activeExecutionId ?? null,
          lastExecutionId: task.metadata.lastExecutionId ?? null,
          activeCodexThreadId: task.metadata.activeCodexThreadId ?? task.metadata.primaryCodexThreadId ?? null,
          activeCodexTurnId: task.metadata.activeCodexTurnId ?? null,
          lastCodexTurnId: task.metadata.lastCodexTurnId ?? null,
          activeCapability: task.metadata.activeCapability ?? null,
          capabilityStatus: task.metadata.capabilityStatus ?? "Idle"
        };
      }
    });

    return state.tasks.find((entry) => entry.id === taskId) ?? null;
  }

  async function changeTaskStatus(taskId, nextStatus, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const task = current.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error("No encontré la tarea indicada.");
      }

      if (task.status === nextStatus) {
        return;
      }

      if (!canTransitionTaskStatus(task.status, nextStatus)) {
        throw new Error(`La transición ${task.status} -> ${nextStatus} no es válida.`);
      }

      task.status = nextStatus;
      task.updatedBy = actors.human;
      task.updatedAt = nowIso();
      if (nextStatus === "done") {
        task.completedAt = nowIso();
      }
      if (nextStatus === "active") {
        task.completedAt = null;
      }
      if (nextStatus === "archived" && current.activeTaskId === task.id) {
        const fallback = current.tasks.find(
          (entry) => entry.projectId === task.projectId && entry.id !== task.id && entry.status !== "archived"
        ) ?? null;
        current.activeTaskId = fallback?.id ?? null;
        current.activeConversationId = fallback?.activeConversationId ?? null;
        const project = current.projects.find((entry) => entry.id === task.projectId);
        if (project) project.activeTaskId = fallback?.id ?? null;
      }

      await emit(
        current,
        createDomainEvent(nextStatus === "done" ? "task.completed" : "task.statusChanged", {
          workspaceId: task.workspaceId,
          actor: actors.human,
          entity: {
            id: task.id,
            kind: "task",
            title: task.title,
            status: task.status
          }
        })
      );
    });

    return state.tasks.find((entry) => entry.id === taskId) ?? null;
  }

  async function startTask(taskId, identityContext) {
    const task = await openTask(taskId, identityContext);
    await changeTaskStatus(taskId, "active", identityContext);
    await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const currentTask = current.tasks.find((entry) => entry.id === task.id);
      if (!currentTask) {
        return;
      }

      await emit(
        current,
        createDomainEvent("task.started", {
          workspaceId: currentTask.workspaceId,
          actor: actors.human,
          entity: {
            id: currentTask.id,
            kind: "task",
            title: currentTask.title
          }
        })
      );
    });
    return task;
  }

  async function createConversation(input = {}, identityContext) {
    const taskId = input.taskId;
    if (typeof taskId !== "string" || !taskId) {
      throw new Error("No existe una tarea activa para crear conversación.");
    }

    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const currentTask = current.tasks.find((entry) => entry.id === taskId);
      if (!currentTask) {
        throw new Error("No encontré la tarea activa para crear conversación.");
      }

      const conversation = {
        id: createConversationId(),
        workspaceId: currentTask.workspaceId,
        projectId: currentTask.projectId,
        taskId: currentTask.id,
        title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Nuevo chat",
        kind: typeof input.kind === "string" && input.kind.trim() ? input.kind.trim() : "assistant",
        createdBy: actors.human,
        updatedBy: actors.human,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastMessageAt: null,
        metadata: {
          ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {})
        }
      };
      current.conversations.push(conversation);
      current.messagesByConversation[conversation.id] = [];
      currentTask.activeConversationId = conversation.id;
      currentTask.updatedAt = nowIso();
      current.activeConversationId = conversation.id;
      current.activeTaskId = currentTask.id;
      current.activeProjectId = currentTask.projectId;
      const workspace = current.workspaces.find((entry) => entry.id === currentTask.workspaceId);
      if (workspace) workspace.activeProjectId = currentTask.projectId;
      const activeSession = current.sessions.find((entry) => entry.id === current.activeSessionId);
      if (activeSession) {
        activeSession.projectId = currentTask.projectId;
        activeSession.taskId = currentTask.id;
        activeSession.conversationId = conversation.id;
        activeSession.operationalState = {
          ...activeSession.operationalState,
          activeProjectId: currentTask.projectId,
          activeTaskId: currentTask.id,
          activeConversationId: conversation.id,
          activeExecutionId: currentTask.metadata.activeExecutionId ?? null,
          lastExecutionId: currentTask.metadata.lastExecutionId ?? null,
          activeCodexThreadId: currentTask.metadata.activeCodexThreadId ?? currentTask.metadata.primaryCodexThreadId ?? null,
          activeCodexTurnId: currentTask.metadata.activeCodexTurnId ?? null,
          lastCodexTurnId: currentTask.metadata.lastCodexTurnId ?? null,
          activeCapability: currentTask.metadata.activeCapability ?? null,
          capabilityStatus: currentTask.metadata.capabilityStatus ?? "Idle"
        };
      }

      await emit(
        current,
        createDomainEvent("conversation.created", {
          workspaceId: conversation.workspaceId,
          actor: actors.human,
          entity: {
            id: conversation.id,
            kind: "conversation",
            title: conversation.title
          }
        })
      );
    });

    return state.conversations.find((entry) => entry.id === state.activeConversationId) ?? null;
  }

  async function createChat(input = {}, identityContext) {
    const task = await createTask({
      projectId: input.projectId,
      title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Nueva tarea",
      description: typeof input.description === "string" ? input.description : ""
    }, identityContext);
    const activeTask = await changeTaskStatus(task.id, "active", identityContext);
    const conversation = await createConversation({
      taskId: task.id,
      title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Nuevo chat",
      kind: input.kind
    }, identityContext);
    return {
      task: activeTask,
      conversation
    };
  }

  async function listConversations(taskId) {
    const state = await store.load();
    if (taskId) {
      return state.conversations.filter((entry) => entry.taskId === taskId);
    }

    return state.conversations.filter(
      (entry) => entry.workspaceId === state.activeWorkspaceId && entry.projectId === state.activeProjectId
    );
  }

  async function updateConversation(conversationId, patch, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const conversation = current.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) throw new Error("No encontré la conversación para actualizar.");
      if (typeof patch.title === "string" && patch.title.trim()) conversation.title = patch.title.trim();
      conversation.updatedBy = actors.human;
      conversation.updatedAt = nowIso();
      await emit(current, createDomainEvent("conversation.updated", {
        workspaceId: conversation.workspaceId,
        actor: actors.human,
        entity: { id: conversation.id, kind: "conversation", title: conversation.title },
        data: { projectId: conversation.projectId, taskId: conversation.taskId }
      }));
    });
    return state.conversations.find((entry) => entry.id === conversationId) ?? null;
  }

  async function openConversation(conversationId, identityContext) {
    const state = await store.update(async (current) => {
      const conversation = current.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) {
        throw new Error("No encontré la conversación solicitada.");
      }

      const task = current.tasks.find((entry) => entry.id === conversation.taskId);
      current.activeConversationId = conversation.id;
      current.activeTaskId = task?.id ?? null;
      current.activeProjectId = conversation.projectId;
      const workspace = current.workspaces.find((entry) => entry.id === conversation.workspaceId);
      if (workspace) workspace.activeProjectId = conversation.projectId;
      if (task) {
        task.activeConversationId = conversation.id;
        task.updatedAt = nowIso();
      }
      const activeSession = current.sessions.find((entry) => entry.id === current.activeSessionId);
      if (activeSession) {
        activeSession.taskId = task?.id ?? null;
        activeSession.projectId = conversation.projectId;
        activeSession.conversationId = conversation.id;
        activeSession.operationalState = {
          ...activeSession.operationalState,
          activeTaskId: task?.id ?? null,
          activeConversationId: conversation.id,
          activeExecutionId: task?.metadata.activeExecutionId ?? null,
          lastExecutionId: task?.metadata.lastExecutionId ?? null,
          activeCodexThreadId: task?.metadata.activeCodexThreadId ?? task?.metadata.primaryCodexThreadId ?? null,
          activeCodexTurnId: task?.metadata.activeCodexTurnId ?? null,
          lastCodexTurnId: task?.metadata.lastCodexTurnId ?? null,
          activeCapability: task?.metadata.activeCapability ?? null,
          capabilityStatus: task?.metadata.capabilityStatus ?? "Idle"
        };
      }
    });

    return state.conversations.find((entry) => entry.id === conversationId) ?? null;
  }

  async function appendMessage(conversationId, messageInput, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const conversation = current.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) {
        throw new Error("No encontré la conversación para registrar el mensaje.");
      }

      const body = typeof messageInput.body === "string" ? messageInput.body.trim() : "";
      if (!body) {
        return;
      }

      const role = messageInput.role === "assistant" || messageInput.role === "system" ? messageInput.role : "user";
      const entry = {
        id: messageInput.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        body,
        createdAt: nowIso(),
        metadata: normalizeMessageMetadata(messageInput.metadata)
      };

      const existing = current.messagesByConversation[conversation.id] ?? [];
      current.messagesByConversation[conversation.id] = [
        ...existing,
        {
          ...entry,
          actor: messageInput.role === "user" ? actors.human : messageInput.role === "assistant" ? actors.codex : actors.system
        }
      ];
      conversation.updatedAt = nowIso();
      conversation.updatedBy = messageInput.role === "user" ? actors.human : messageInput.role === "assistant" ? actors.codex : actors.system;
      conversation.lastMessageAt = entry.createdAt;
      if (role === "user" && conversation.title === "Nuevo chat") {
        conversation.title = body.slice(0, 48);
      }

      await emit(
        current,
        createDomainEvent("conversation.updated", {
          workspaceId: conversation.workspaceId,
          actor: messageInput.role === "user" ? actors.human : messageInput.role === "assistant" ? actors.codex : actors.system,
          entity: {
            id: conversation.id,
            kind: "conversation",
            title: conversation.title
          }
        })
      );
    });

    return {
      conversation: state.conversations.find((entry) => entry.id === conversationId) ?? null,
      messages: state.messagesByConversation[conversationId] ?? []
    };
  }

  async function getCodexExecutionContext() {
    const state = await store.load();
    const project = state.projects.find((entry) => entry.id === state.activeProjectId) ?? null;
    const task = state.tasks.find((entry) => entry.id === state.activeTaskId) ?? null;
    const conversation = state.conversations.find((entry) => entry.id === state.activeConversationId) ?? null;
    return {
      workspaceId: state.activeWorkspaceId,
      projectId: project?.id ?? null,
      taskId: task?.id ?? null,
      conversationId: conversation?.id ?? null,
      rootPath: project?.rootPath ?? null,
      codexThreadId: conversation?.metadata?.codexThreadId ?? task?.metadata?.primaryCodexThreadId ?? null,
      codexRuntimeVersion: conversation?.metadata?.codexRuntimeVersion ?? null,
      codexProtocolVersion: conversation?.metadata?.codexProtocolVersion ?? null
    };
  }

  async function associateCodexThread(mapping, identityContext) {
    if (!mapping?.codexThreadId) {
      throw new Error("No existe un thread de Codex para asociar.");
    }
    await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const conversation = current.conversations.find((entry) => entry.id === mapping.conversationId) ?? null;
      const task = current.tasks.find((entry) => entry.id === (mapping.taskId ?? conversation?.taskId)) ?? null;
      const existingThreadId = conversation?.metadata?.codexThreadId ?? task?.metadata?.primaryCodexThreadId ?? null;
      if (
        existingThreadId === mapping.codexThreadId &&
        (conversation?.metadata?.codexRuntimeVersion ?? task?.metadata?.codexRuntimeVersion) === mapping.codexRuntimeVersion &&
        (conversation?.metadata?.codexProtocolVersion ?? task?.metadata?.codexProtocolVersion) === mapping.codexProtocolVersion
      ) {
        return;
      }
      const metadata = {
        codexThreadId: mapping.codexThreadId,
        codexRuntimeVersion: mapping.codexRuntimeVersion,
        codexProtocolVersion: mapping.codexProtocolVersion,
        codexThreadMappedAt: mapping.mappedAt ?? nowIso()
      };
      if (conversation) {
        conversation.metadata = { ...conversation.metadata, ...metadata };
        conversation.updatedAt = nowIso();
        conversation.updatedBy = actors.codex;
      }
      if (task) {
        task.metadata = {
          ...task.metadata,
          primaryCodexThreadId: mapping.codexThreadId,
          codexRuntimeVersion: mapping.codexRuntimeVersion,
          codexProtocolVersion: mapping.codexProtocolVersion
        };
        task.updatedAt = nowIso();
      }
      await emit(current, createDomainEvent("codex.thread.mapped", {
        workspaceId: mapping.workspaceId ?? current.activeWorkspaceId,
        actor: actors.codex,
        entity: {
          id: mapping.codexThreadId,
          kind: "codex-thread"
        },
        data: {
          projectId: mapping.projectId ?? null,
          taskId: mapping.taskId ?? null,
          conversationId: mapping.conversationId ?? null,
          codexRuntimeVersion: mapping.codexRuntimeVersion,
          codexProtocolVersion: mapping.codexProtocolVersion
        }
      }));
    });
    return mapping;
  }

  async function recordCodexUpstreamEvent(upstreamEvent, identityContext) {
    if (!upstreamEvent?.executionId || !upstreamEvent?.type) return null;
    const productEvent = mapUpstreamEventToProductEvent(upstreamEvent);
    if (!productEvent) return null;
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const reference = current.executionReferences.find((entry) => entry.executionId === upstreamEvent.executionId);
      const task = current.tasks.find((entry) => entry.id === (reference?.taskId ?? current.activeTaskId)) ?? null;
      const activeSession = current.sessions.find((entry) => entry.id === current.activeSessionId) ?? null;
      if (reference) {
        reference.updatedAt = upstreamEvent.timestamp;
        reference.metadata = {
          ...reference.metadata,
          codexThreadId: upstreamEvent.codexThreadId,
          codexTurnId: upstreamEvent.codexTurnId,
          codexRuntimeVersion: upstreamEvent.codexRuntimeVersion,
          codexProtocolVersion: upstreamEvent.codexProtocolVersion,
          lastUpstreamEvent: upstreamEvent.type,
          activeCapability: productEvent.capability,
          capabilityStatus: productEvent.status,
          model: productEvent.data.model ?? reference.metadata.model ?? null,
          provider: productEvent.data.provider ?? reference.metadata.provider ?? null,
          tokenUsage: productEvent.data.tokenUsage ?? reference.metadata.tokenUsage ?? null,
          durationMs: productEvent.data.durationMs ?? reference.metadata.durationMs ?? null,
          plan: productEvent.kind === "plan.updated"
            ? {
                explanation: productEvent.data.explanation,
                steps: productEvent.data.steps,
                updatedAt: productEvent.timestamp
              }
            : reference.metadata.plan ?? null
        };
        if (productEvent.kind === "turn.updated" && productEvent.status === "Running") {
          reference.status = "running";
        }
        if (productEvent.kind === "approval.updated" && productEvent.status === "Waiting") {
          reference.status = "waiting";
        }
      }

      if (task) {
        task.metadata = {
          ...task.metadata,
          activeExecutionId: upstreamEvent.executionId,
          lastExecutionId: upstreamEvent.executionId,
          activeCodexThreadId: upstreamEvent.codexThreadId,
          lastCodexThreadId: upstreamEvent.codexThreadId,
          activeCodexTurnId: productEvent.kind === "turn.updated" && productEvent.status !== "Running"
            ? null
            : upstreamEvent.codexTurnId,
          lastCodexTurnId: upstreamEvent.codexTurnId,
          activeCapability: productEvent.capability,
          capabilityStatus: productEvent.status
        };
        task.updatedAt = upstreamEvent.timestamp;
      }

      if (activeSession && activeSession.taskId === (reference?.taskId ?? task?.id)) {
        activeSession.operationalState = {
          ...activeSession.operationalState,
          activeExecutionId: upstreamEvent.executionId,
          lastExecutionId: upstreamEvent.executionId,
          activeCodexThreadId: upstreamEvent.codexThreadId,
          activeCodexTurnId: productEvent.kind === "turn.updated" && productEvent.status !== "Running"
            ? null
            : upstreamEvent.codexTurnId,
          lastCodexTurnId: upstreamEvent.codexTurnId,
          activeCapability: productEvent.capability,
          capabilityStatus: productEvent.status
        };
      }

      if (productEvent.kind === "diff.updated") {
        let artifact = current.artifacts.find(
          (entry) => entry.executionId === upstreamEvent.executionId && entry.type === "diff"
        );
        let createdArtifact = false;
        if (!artifact) {
          createdArtifact = true;
          artifact = {
            id: createArtifactId(),
            workspaceId: reference?.workspaceId ?? current.activeWorkspaceId,
            projectId: reference?.projectId ?? current.activeProjectId,
            taskId: reference?.taskId ?? task?.id ?? null,
            executionId: upstreamEvent.executionId,
            type: "diff",
            title: "Cambios propuestos por Codex",
            uri: null,
            contentRef: null,
            status: "active",
            version: 1,
            createdAt: upstreamEvent.timestamp,
            updatedAt: upstreamEvent.timestamp,
            metadata: {}
          };
          current.artifacts.push(artifact);
          if (task && !task.artifactIds.includes(artifact.id)) task.artifactIds.push(artifact.id);
        } else {
          artifact.version += 1;
          artifact.updatedAt = upstreamEvent.timestamp;
        }
        artifact.metadata = {
          ...artifact.metadata,
          codexThreadId: upstreamEvent.codexThreadId,
          codexTurnId: upstreamEvent.codexTurnId,
          files: productEvent.data.files,
          additions: productEvent.data.additions,
          deletions: productEvent.data.deletions,
          diffPreview: productEvent.data.preview,
          diffBytes: productEvent.data.size,
          truncated: productEvent.data.truncated,
          timestamp: productEvent.timestamp
        };
        if (createdArtifact) {
          await emit(current, createDomainEvent("artifact.created", {
            workspaceId: artifact.workspaceId,
            actor: actors.codex,
            entity: {
              id: artifact.id,
              kind: "artifact",
              title: artifact.title
            }
          }));
        }
      }

      if (productEvent.kind === "patch.updated") {
        let patchArtifact = current.artifacts.find(
          (entry) => entry.executionId === upstreamEvent.executionId && entry.type === "patch"
        );
        if (!patchArtifact) {
          patchArtifact = {
            id: createArtifactId(),
            workspaceId: reference?.workspaceId ?? current.activeWorkspaceId,
            projectId: reference?.projectId ?? current.activeProjectId,
            taskId: reference?.taskId ?? task?.id ?? null,
            executionId: upstreamEvent.executionId,
            type: "patch",
            title: productEvent.status === "Completed" ? "Patch aplicado por Codex" : "Cambios preparados por Codex",
            uri: null,
            contentRef: null,
            status: "active",
            version: 1,
            createdAt: upstreamEvent.timestamp,
            updatedAt: upstreamEvent.timestamp,
            metadata: {}
          };
          current.artifacts.push(patchArtifact);
          if (task && !task.artifactIds.includes(patchArtifact.id)) task.artifactIds.push(patchArtifact.id);
          await emit(current, createDomainEvent("artifact.created", {
            workspaceId: patchArtifact.workspaceId,
            actor: actors.codex,
            timestamp: upstreamEvent.timestamp,
            entity: { id: patchArtifact.id, kind: "artifact", title: patchArtifact.title }
          }));
        } else {
          patchArtifact.version += 1;
          patchArtifact.updatedAt = upstreamEvent.timestamp;
        }
        patchArtifact.title = productEvent.status === "Completed" ? "Patch aplicado por Codex" : "Cambios preparados por Codex";
        patchArtifact.status = productEvent.status === "Completed" ? "completed" : "active";
        patchArtifact.metadata = {
          ...patchArtifact.metadata,
          files: productEvent.data.files,
          generatedFiles: productEvent.data.generatedFiles,
          changesCount: productEvent.data.changesCount,
          additions: productEvent.data.additions,
          deletions: productEvent.data.deletions,
          diffPreview: productEvent.data.preview,
          diffBytes: productEvent.data.size,
          truncated: productEvent.data.truncated,
          codexThreadId: upstreamEvent.codexThreadId,
          codexTurnId: upstreamEvent.codexTurnId,
          status: productEvent.status,
          timestamp: productEvent.timestamp
        };

        for (const filePath of productEvent.data.generatedFiles ?? []) {
          let generatedArtifact = current.artifacts.find(
            (entry) => entry.executionId === upstreamEvent.executionId && entry.type === "generated-file" && entry.uri === filePath
          );
          if (!generatedArtifact) {
            generatedArtifact = {
              id: createArtifactId(),
              workspaceId: patchArtifact.workspaceId,
              projectId: patchArtifact.projectId,
              taskId: patchArtifact.taskId,
              executionId: upstreamEvent.executionId,
              type: "generated-file",
              title: filePath.split("/").pop() || "Archivo generado",
              uri: filePath,
              contentRef: null,
              status: "active",
              version: 1,
              createdAt: upstreamEvent.timestamp,
              updatedAt: upstreamEvent.timestamp,
              metadata: { source: "codex-app-server", status: productEvent.status, timestamp: productEvent.timestamp }
            };
            current.artifacts.push(generatedArtifact);
            if (task && !task.artifactIds.includes(generatedArtifact.id)) task.artifactIds.push(generatedArtifact.id);
            await emit(current, createDomainEvent("artifact.created", {
              workspaceId: generatedArtifact.workspaceId,
              actor: actors.codex,
              timestamp: upstreamEvent.timestamp,
              entity: { id: generatedArtifact.id, kind: "artifact", title: generatedArtifact.title }
            }));
          } else {
            generatedArtifact.version += 1;
            generatedArtifact.updatedAt = upstreamEvent.timestamp;
          }
          generatedArtifact.status = productEvent.status === "Completed" ? "completed" : "active";
          generatedArtifact.metadata = {
            ...generatedArtifact.metadata,
            status: productEvent.status,
            timestamp: productEvent.timestamp
          };
        }
      }

      if (productEvent.activity) {
        await emit(current, createDomainEvent(productEvent.activity.type, {
          workspaceId: reference?.workspaceId ?? current.activeWorkspaceId,
          actor: actors.codex,
          timestamp: upstreamEvent.timestamp,
          entity: {
            id: upstreamEvent.executionId,
            kind: "execution"
          },
          data: {
            activitySummary: productEvent.activity.summary,
            capability: productEvent.capability,
            capabilityStatus: productEvent.status,
            projectId: reference?.projectId ?? task?.projectId ?? null,
            taskId: reference?.taskId ?? task?.id ?? null,
            codexThreadId: upstreamEvent.codexThreadId,
            codexTurnId: upstreamEvent.codexTurnId,
            itemId: upstreamEvent.data?.itemId ?? null
          }
        }));
      }
    });
    return state.executionReferences.find((entry) => entry.executionId === upstreamEvent.executionId) ?? null;
  }

  async function recordExecutionEvent(executionEvent, payload = {}, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const executionId = executionEvent.executionId;
      const context = payload.metadata?.workspaceContext ?? {};
      const existing = current.executionReferences.find((entry) => entry.executionId === executionId);
      const targetTaskId = existing?.taskId ?? context.taskId ?? current.activeTaskId;
      const targetConversationId = existing?.conversationId ?? context.conversationId ?? current.activeConversationId;
      const targetProjectId = existing?.projectId ?? context.projectId ?? current.activeProjectId;
      const targetWorkspaceId = existing?.workspaceId ?? context.workspaceId ?? current.activeWorkspaceId;
      const task = current.tasks.find((entry) => entry.id === targetTaskId) ?? null;
      const conversation = current.conversations.find((entry) => entry.id === targetConversationId) ?? null;
      const activeSession = current.sessions.find((entry) => entry.id === current.activeSessionId) ?? null;
      const status = executionEvent.type.replace("execution.", "");
      const preview =
        executionEvent.type === "execution.completed"
          ? executionEvent.output.slice(0, 180)
          : executionEvent.type === "execution.cancelled"
            ? (executionEvent.output ?? "").slice(0, 180)
            : executionEvent.type === "execution.failed"
              ? executionEvent.error.safeMessage
              : typeof payload.prompt === "string"
                ? payload.prompt.slice(0, 180)
                : "";

      const reference =
        existing ??
        {
          id: `execution-ref-${executionId}`,
          executionId,
          workspaceId: targetWorkspaceId,
          projectId: targetProjectId,
          taskId: task?.id ?? null,
          conversationId: conversation?.id ?? null,
          status,
          createdAt: executionEvent.timestamp,
          updatedAt: executionEvent.timestamp,
          metadata: {
            promptPreview: typeof payload.prompt === "string" ? payload.prompt.slice(0, 180) : "",
            requestedBy: payload.requestedBy ?? actors.human,
            performedBy: payload.performedBy ?? actors.codex
          }
        };

      const isDuplicateTerminalEvent =
        existing &&
        existing.status === status &&
        existing.updatedAt === executionEvent.timestamp &&
        (executionEvent.type === "execution.completed" ||
          executionEvent.type === "execution.failed" ||
          executionEvent.type === "execution.cancelled");
      if (isDuplicateTerminalEvent) {
        return;
      }

      reference.status = status;
      reference.updatedAt = executionEvent.timestamp;
      reference.metadata = {
        ...reference.metadata,
        outputPreview: preview
      };

      if (!existing) {
        current.executionReferences.push(reference);
      }

      if (task && !task.executionIds.includes(executionId)) {
        task.executionIds.push(executionId);
      }

      const terminal = executionEvent.type === "execution.completed" ||
        executionEvent.type === "execution.failed" ||
        executionEvent.type === "execution.cancelled";
      if (task) {
        const taskHasDifferentActiveExecution = Boolean(
          task.metadata.activeExecutionId && task.metadata.activeExecutionId !== executionId
        );
        if (!terminal || !taskHasDifferentActiveExecution) {
          task.metadata = {
            ...task.metadata,
            activeExecutionId: terminal ? null : executionId,
            lastExecutionId: executionId,
            activeCodexTurnId: terminal ? null : task.metadata.activeCodexTurnId ?? null,
            activeCapability: terminal ? null : task.metadata.activeCapability ?? "coding",
            capabilityStatus: terminal ? status : "Running"
          };
          task.updatedAt = executionEvent.timestamp;
        }
      }
      if (activeSession && activeSession.taskId === task?.id) {
        const activeExecutionMatches = activeSession.operationalState?.activeExecutionId === executionId;
        const hasDifferentActiveExecution = Boolean(
          activeSession.operationalState?.activeExecutionId && !activeExecutionMatches
        );
        if (!terminal || !hasDifferentActiveExecution) {
          activeSession.operationalState = {
            ...activeSession.operationalState,
            activeExecutionId: terminal ? null : executionId,
            lastExecutionId: executionId,
            activeCodexTurnId: terminal ? null : activeSession.operationalState?.activeCodexTurnId ?? null,
            activeCapability: terminal ? null : activeSession.operationalState?.activeCapability ?? "coding",
            capabilityStatus: terminal ? status : "Running"
          };
        }
      }

      await emit(
        current,
        createDomainEvent(executionEvent.type, {
          workspaceId: targetWorkspaceId,
          actor: actors.codex,
          entity: {
            id: executionId,
            kind: "execution"
          },
          data: {
            taskId: task?.id ?? null,
            projectId: targetProjectId,
            conversationId: conversation?.id ?? null,
            requestedBy: reference.metadata.requestedBy,
            performedBy: reference.metadata.performedBy
          }
        })
      );

      if (executionEvent.type === "execution.completed" && executionEvent.output.trim()) {
        const artifact = {
          id: createArtifactId(),
          workspaceId: targetWorkspaceId,
          projectId: targetProjectId,
          taskId: task?.id ?? null,
          executionId,
          type: "report",
          title: conversation ? `Resultado ${conversation.title}` : "Resultado de ejecución",
          uri: null,
          contentRef: null,
          status: "active",
          version: 1,
          createdAt: executionEvent.timestamp,
          updatedAt: executionEvent.timestamp,
          metadata: {
            outputPreview: executionEvent.output.slice(0, 180)
          }
        };
        current.artifacts.push(artifact);
        if (task && !task.artifactIds.includes(artifact.id)) {
          task.artifactIds.push(artifact.id);
        }
        await emit(
          current,
          createDomainEvent("artifact.created", {
            workspaceId: targetWorkspaceId,
            actor: actors.codex,
            entity: {
              id: artifact.id,
              kind: "artifact",
              title: artifact.title
            },
            data: { projectId: targetProjectId, taskId: task?.id ?? null }
          })
        );
      }
    });

    return state.executionReferences.find((entry) => entry.executionId === executionEvent.executionId) ?? null;
  }

  async function recordWebExecution(webEvent, identityContext) {
    const state = await store.update(async (current) => {
      const actors = resolveActors(identityContext);
      const executionId = webEvent.requestId;
      const task = current.tasks.find((entry) => entry.id === current.activeTaskId) ?? null;
      const conversation = current.conversations.find((entry) => entry.id === current.activeConversationId) ?? null;
      const existing = current.executionReferences.find((entry) => entry.executionId === executionId);
      const status = webEvent.type.replace("web.execution.", "");
      const reference = existing ?? {
        id: `execution-ref-${executionId}`,
        executionId,
        workspaceId: current.activeWorkspaceId,
        projectId: current.activeProjectId,
        taskId: task?.id ?? null,
        conversationId: conversation?.id ?? null,
        status,
        createdAt: webEvent.startedAt ?? webEvent.timestamp,
        updatedAt: webEvent.timestamp,
        metadata: {
          requestedBy: actors.human,
          performedBy: actors.system,
          tool: "TrustedWebTool",
          queryPreview: typeof webEvent.queryPreview === "string" ? webEvent.queryPreview.slice(0, 180) : ""
        }
      };
      reference.status = status;
      reference.updatedAt = webEvent.timestamp;
      reference.metadata = {
        ...reference.metadata,
        provider: webEvent.provider ?? reference.metadata.provider ?? "web-tool",
        sourcesCount: Number(webEvent.sourcesCount ?? 0),
        verifiedAt: webEvent.verifiedAt ?? null,
        confidence: webEvent.confidence ?? "Unavailable",
        duration: webEvent.startedAt
          ? Math.max(0, new Date(webEvent.timestamp).getTime() - new Date(webEvent.startedAt).getTime())
          : null,
        error: webEvent.error
          ? { code: webEvent.error.code ?? "WEB_PROVIDER_UNAVAILABLE", safeMessage: webEvent.error.safeMessage ?? "La consulta web falló." }
          : null
      };
      if (!existing) current.executionReferences.push(reference);
      if (task && !task.executionIds.includes(executionId)) task.executionIds.push(executionId);

      await emit(current, createDomainEvent(webEvent.type, {
        workspaceId: current.activeWorkspaceId,
        actor: actors.system,
        timestamp: webEvent.timestamp,
        entity: {
          id: executionId,
          kind: "web-execution",
          sourcesCount: reference.metadata.sourcesCount
        },
        data: {
          requestedBy: reference.metadata.requestedBy,
          performedBy: reference.metadata.performedBy,
          tool: "TrustedWebTool",
          provider: reference.metadata.provider,
          status,
          startedAt: reference.createdAt,
          completedAt: status === "started" ? null : webEvent.timestamp,
          duration: reference.metadata.duration,
          sourcesCount: reference.metadata.sourcesCount,
          verifiedAt: reference.metadata.verifiedAt,
          confidence: reference.metadata.confidence,
          error: reference.metadata.error
        }
      }));
    });
    return state.executionReferences.find((entry) => entry.executionId === webEvent.requestId) ?? null;
  }

  async function listArtifacts(filters = {}) {
    const state = await store.load();
    return state.artifacts.filter((entry) => {
      if (filters.projectId && entry.projectId !== filters.projectId) {
        return false;
      }
      if (filters.taskId && entry.taskId !== filters.taskId) {
        return false;
      }
      if (filters.executionId && entry.executionId !== filters.executionId) {
        return false;
      }
      return true;
    });
  }

  async function listActivity(filters = {}) {
    const state = await store.load();
    return state.activities.filter((entry) => {
      if (filters.projectId && entry.projectId !== filters.projectId) {
        return false;
      }
      if (filters.taskId && entry.taskId !== filters.taskId) {
        return false;
      }
      return true;
    });
  }

  async function dispose() {
    eventBus.clear();
  }

  return {
    initialize,
    getBootstrap,
    createProject,
    listProjects,
    openProject,
    updateProject,
    archiveProject,
    createTask,
    listTasks,
    openTask,
    updateTask,
    startTask,
    changeTaskStatus,
    createConversation,
    createChat,
    listConversations,
    openConversation,
    updateConversation,
    appendMessage,
    getCodexExecutionContext,
    associateCodexThread,
    recordExecutionEvent,
    recordCodexUpstreamEvent,
    recordWebExecution,
    listArtifacts,
    listActivity,
    dispose,
    _eventBus: eventBus
  };
}
