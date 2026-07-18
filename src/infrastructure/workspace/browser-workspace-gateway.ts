import type { WorkspaceGateway, WorkspaceGatewayBootstrap } from "./workspace-gateway.js";
import { canTransitionTaskStatus } from "../../../shared/workspace-domain.js";

const storageKey = "cocreate-browser-workspace-v2";
const legacyStorageKey = "cocreate-browser-workspace-v1";

type BrowserWorkspaceState = WorkspaceGatewayBootstrap & {
  schemaVersion: 2;
  projects: Array<Record<string, any>>;
  tasks: Array<Record<string, any>>;
  artifacts: Array<Record<string, any>>;
};

function createId(prefix: string) {
  const seed = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${seed}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAssistantPreferences(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    planModeEnabled: candidate.planModeEnabled === true,
    planModeName: typeof candidate.planModeName === "string" ? candidate.planModeName.slice(0, 80) : null,
    selectedSkillNames: Array.isArray(candidate.selectedSkillNames)
      ? Array.from(new Set(candidate.selectedSkillNames.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 160)))).slice(0, 8)
      : []
  };
}

function createInitialState(): BrowserWorkspaceState {
  const createdAt = nowIso();
  const workspaceId = createId("workspace-web");
  const project = {
    id: createId("project-web"),
    workspaceId,
    name: "Proyecto Web",
    description: "",
    status: "active",
    rootPath: null,
    activeTaskId: null,
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt
  };
  return {
    schemaVersion: 2,
    workspace: {
      id: workspaceId,
      name: "Workspace personal",
      type: "personal",
      status: "active",
      createdAt,
      updatedAt: createdAt
    },
    project,
    task: null,
    conversation: null,
    session: {
      id: createId("session-web"),
      status: "active",
      startedAt: createdAt,
      updatedAt: createdAt,
      operationalState: {
        activeProjectId: project.id,
        activeTaskId: null,
        activeConversationId: null,
        capabilityStatus: "Idle"
      }
    },
    projects: [project],
    tasks: [],
    artifacts: [],
    conversations: [],
    activities: []
  };
}

function readState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as BrowserWorkspaceState | null;
    if (parsed?.schemaVersion === 2 && parsed.workspace && Array.isArray(parsed.conversations)) {
      return parsed;
    }
  } catch {
    // Invalid local state is replaced with a valid personal workspace.
  }

  const initial = createInitialState();
  try {
    const legacy = JSON.parse(window.localStorage.getItem(legacyStorageKey) ?? "null") as any;
    if (legacy?.schemaVersion === 1 && Array.isArray(legacy.conversations)) {
      const project = initial.projects[0];
      const tasks = new Map<string, Record<string, any>>();
      initial.conversations = legacy.conversations.map((entry: any) => {
        const taskId = typeof entry.taskId === "string" ? entry.taskId : createId("task-web");
        if (!tasks.has(taskId)) {
          tasks.set(taskId, {
            id: taskId,
            workspaceId: (initial.workspace as any)?.id ?? null,
            projectId: project.id,
            title: typeof entry.title === "string" ? entry.title : "Tarea restaurada",
            description: "",
            status: "active",
            priority: "normal",
            activeConversationId: entry.id,
            executionIds: [],
            artifactIds: [],
            metadata: {},
            createdAt: nowIso(),
            updatedAt: nowIso()
          });
        }
        return { ...entry, taskId };
      });
      initial.tasks = Array.from(tasks.values());
      const activeConversationId = typeof legacy.conversation?.id === "string" ? legacy.conversation.id : null;
      const activeSummary = initial.conversations.find((entry) => entry.id === activeConversationId) ?? initial.conversations[0] ?? null;
      const activeTask = activeSummary ? initial.tasks.find((entry) => entry.id === activeSummary.taskId) ?? null : null;
      if (activeTask) project.activeTaskId = activeTask.id;
      initial.task = activeTask;
      initial.conversation = activeSummary
        ? { id: activeSummary.id, taskId: activeSummary.taskId, projectId: project.id, title: activeSummary.title, status: "active" }
        : null;
      initial.activities = Array.isArray(legacy.activities) ? legacy.activities.slice(-500) : [];
    }
  } catch {
    // Legacy browser state remains untouched if it cannot be migrated safely.
  }
  window.localStorage.setItem(storageKey, JSON.stringify(initial));
  return initial;
}

function writeState(state: BrowserWorkspaceState) {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
  return state;
}

function createConversationRecords(id: string, title: string, projectId: string | null, workspaceId: string, taskId?: string) {
  const createdAt = nowIso();
  const task = {
    id: taskId ?? createId("task-web"),
    workspaceId,
    projectId,
    title,
    status: "active",
    createdAt,
    updatedAt: createdAt
  };
  const conversation = {
    id,
    taskId: task.id,
    projectId,
    title,
    status: "active",
    createdAt,
    updatedAt: createdAt
  };
  return {
    task,
    conversation,
    summary: {
      id,
      taskId: task.id,
      title,
      thread: {
        id,
        title,
        preview: "Sin mensajes todavía"
      },
      messages: []
    }
  };
}

function addActivity(
  state: BrowserWorkspaceState,
  input: { type: string; summary: string; projectId?: string | null; taskId?: string | null; entityId?: string | null; entityKind?: string }
) {
  const timestamp = nowIso();
  state.activities.push({
    id: createId("activity-web"),
    workspaceId: (state.workspace as any)?.id ?? null,
    projectId: Object.prototype.hasOwnProperty.call(input, "projectId") ? input.projectId ?? null : (state.project as any)?.id ?? null,
    taskId: input.taskId ?? (state.task as any)?.id ?? null,
    actor: { type: "human", id: "browser-user", displayName: "Tú" },
    type: input.type,
    summary: input.summary.slice(0, 500),
    timestamp,
    relatedEntity: input.entityId ? { id: input.entityId, kind: input.entityKind ?? null } : null,
    metadata: {}
  });
  state.activities = state.activities.slice(-500);
}

export class BrowserWorkspaceGateway implements WorkspaceGateway {
  isAvailable() {
    return true;
  }

  async getBootstrap() {
    return readState();
  }

  async createChat(payload: Record<string, unknown> = {}) {
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Nuevo chat";
    const state = readState();
    const requestedProjectId = payload.projectId === null ? null : payload.projectId ?? (state.project as any)?.id ?? null;
    const project = requestedProjectId
      ? state.projects.find((entry) => entry.id === requestedProjectId && entry.status !== "archived") ?? null
      : null;
    if (requestedProjectId && !project) throw new Error("No encontré el proyecto indicado.");
    const workspaceId = (state.workspace as any)?.id;
    if (!workspaceId) throw new Error("No encontré un workspace activo.");
    const records = createConversationRecords(createId("conversation-web"), title, project?.id ?? null, workspaceId);
    if (project) project.activeTaskId = records.task.id;
    addActivity(state, {
      type: "task.created",
      summary: `Se creó la tarea ${title}.`,
      projectId: project?.id ?? null,
      taskId: records.task.id,
      entityId: records.task.id,
      entityKind: "task"
    });
    writeState({
      ...state,
      project,
      task: records.task,
      conversation: records.conversation,
      tasks: [...state.tasks, records.task],
      conversations: [records.summary, ...state.conversations]
    });
    return {
      task: records.task,
      conversation: records.conversation
    };
  }

  async createProject(payload: Record<string, unknown> = {}) {
    const state = readState();
    const createdAt = nowIso();
    const project = {
      id: createId("project-web"),
      workspaceId: (state.workspace as any)?.id ?? null,
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "Nuevo proyecto",
      description: typeof payload.description === "string" ? payload.description.trim() : "",
      status: "active",
      rootPath: null,
      activeTaskId: null,
      createdAt,
      updatedAt: createdAt,
      lastOpenedAt: createdAt
    };
    addActivity(state, {
      type: "project.created",
      summary: `Se creó el proyecto ${project.name}.`,
      projectId: project.id,
      entityId: project.id,
      entityKind: "project"
    });
    writeState({ ...state, project, task: null, conversation: null, projects: [...state.projects, project] });
    return project;
  }

  async listProjects(options: { includeArchived?: boolean } = {}) {
    return readState().projects.filter((entry) => options.includeArchived || entry.status !== "archived");
  }

  async openProject(projectId: string) {
    const state = readState();
    const project = state.projects.find((entry) => entry.id === projectId && entry.status !== "archived");
    if (!project) return null;
    const task = state.tasks.find((entry) => entry.id === project.activeTaskId && entry.status !== "archived") ?? null;
    const summary = task ? state.conversations.find((entry) => entry.id === task.activeConversationId) ?? null : null;
    const conversation = summary
      ? { id: summary.id, taskId: summary.taskId, projectId, title: summary.title, status: "active" }
      : null;
    project.lastOpenedAt = nowIso();
    addActivity(state, {
      type: "project.opened",
      summary: `Se abrió el proyecto ${project.name}.`,
      projectId,
      entityId: projectId,
      entityKind: "project"
    });
    writeState({ ...state, project, task, conversation });
    return project;
  }

  async updateProject(projectId: string, patch: Record<string, unknown>) {
    const state = readState();
    const project = state.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    if (typeof patch.name === "string" && patch.name.trim()) project.name = patch.name.trim();
    if (typeof patch.description === "string") project.description = patch.description.trim();
    if (patch.status === "active" || patch.status === "archived") project.status = patch.status;
    project.rootPath = null;
    project.updatedAt = nowIso();
    writeState({ ...state, project: (state.project as any)?.id === projectId ? project : state.project });
    return project;
  }

  async archiveProject(projectId: string) {
    const state = readState();
    const project = state.projects.find((entry) => entry.id === projectId);
    if (!project) return null;
    project.status = "archived";
    project.updatedAt = nowIso();
    const fallback = state.projects.find((entry) => entry.id !== projectId && entry.status !== "archived") ?? null;
    writeState({
      ...state,
      project: (state.project as any)?.id === projectId ? fallback : state.project,
      task: (state.project as any)?.id === projectId ? null : state.task,
      conversation: (state.project as any)?.id === projectId ? null : state.conversation
    });
    return project;
  }

  async selectDirectory() {
    return null;
  }

  async createTask(payload: Record<string, unknown> = {}) {
    const state = readState();
    const requestedProjectId = payload.projectId === null ? null : payload.projectId ?? (state.project as any)?.id ?? null;
    const project = requestedProjectId
      ? state.projects.find((entry) => entry.id === requestedProjectId && entry.status !== "archived") ?? null
      : null;
    if (requestedProjectId && !project) return null;
    const createdAt = nowIso();
    const task = {
      id: createId("task-web"),
      projectId: project?.id ?? null,
      workspaceId: (state.workspace as any)?.id ?? null,
      title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Nueva tarea",
      description: typeof payload.description === "string" ? payload.description.trim() : "",
      status: "draft",
      priority: "normal",
      activeConversationId: null,
      executionIds: [],
      artifactIds: [],
      metadata: {},
      createdAt,
      updatedAt: createdAt
    };
    if (project) project.activeTaskId = task.id;
    addActivity(state, {
      type: "task.created",
      summary: `Se creó la tarea ${task.title}.`,
      projectId: project?.id ?? null,
      taskId: task.id,
      entityId: task.id,
      entityKind: "task"
    });
    writeState({ ...state, project, task, conversation: null, tasks: [...state.tasks, task] });
    return task;
  }

  async listTasks(projectId?: string | null, options: { includeArchived?: boolean } = {}) {
    const state = readState();
    if (projectId === null) {
      return state.tasks.filter((entry) => options.includeArchived || entry.status !== "archived");
    }
    const targetProjectId = projectId ?? (state.project as any)?.id;
    return state.tasks.filter(
      (entry) => entry.projectId === targetProjectId && (options.includeArchived || entry.status !== "archived")
    );
  }

  async openTask(taskId: string) {
    const state = readState();
    const task = state.tasks.find((entry) => entry.id === taskId && entry.status !== "archived");
    if (!task) return null;
    const project = state.projects.find((entry) => entry.id === task.projectId) ?? null;
    if (project) project.activeTaskId = task.id;
    const summary = state.conversations.find((entry) => entry.id === task.activeConversationId) ?? null;
    const conversation = summary
      ? { id: summary.id, taskId: task.id, projectId: task.projectId, title: summary.title, status: "active" }
      : null;
    writeState({ ...state, project, task, conversation });
    return task;
  }

  async updateTask(taskId: string, patch: Record<string, unknown>) {
    const state = readState();
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) return null;
    if (typeof patch.title === "string" && patch.title.trim()) task.title = patch.title.trim();
    if (typeof patch.description === "string") task.description = patch.description.trim();
    if (Object.prototype.hasOwnProperty.call(patch, "projectId")) {
      const nextProjectId = typeof patch.projectId === "string" && patch.projectId ? patch.projectId : null;
      const nextProject = nextProjectId
        ? state.projects.find((entry) => entry.id === nextProjectId && entry.status !== "archived") ?? null
        : null;
      if (nextProjectId && !nextProject) throw new Error("No encontré el proyecto que quieres vincular.");
      const previousProject = state.projects.find((entry) => entry.id === task.projectId);
      if (previousProject && previousProject.activeTaskId === task.id) previousProject.activeTaskId = null;
      task.projectId = nextProject?.id ?? null;
      for (const summary of state.conversations.filter((entry) => entry.taskId === task.id)) {
        const conversation = summary as Record<string, any>;
        conversation.projectId = task.projectId;
      }
      if ((state.task as any)?.id === task.id) {
        state.project = nextProject;
        if (nextProject) nextProject.activeTaskId = task.id;
        if (state.conversation) (state.conversation as any).projectId = task.projectId;
      }
    }
    if (patch.assistantPreferences && typeof patch.assistantPreferences === "object") {
      task.metadata = {
        ...(task.metadata ?? {}),
        assistantPreferences: normalizeAssistantPreferences(patch.assistantPreferences)
      };
    }
    task.updatedAt = nowIso();
    writeState({ ...state, task: (state.task as any)?.id === taskId ? task : state.task });
    return task;
  }

  async changeTaskStatus(taskId: string, status: string) {
    const state = readState();
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) return null;
    if (task.status !== status && !canTransitionTaskStatus(task.status, status)) {
      throw new Error(`La transición ${task.status} -> ${status} no es válida.`);
    }
    task.status = status;
    task.updatedAt = nowIso();
    addActivity(state, {
      type: status === "done" ? "task.completed" : "task.statusChanged",
      summary: status === "done" ? `Se completó la tarea ${task.title}.` : `La tarea ${task.title} cambió a ${status}.`,
      projectId: task.projectId,
      taskId: task.id,
      entityId: task.id,
      entityKind: "task"
    });
    const isActive = (state.task as any)?.id === taskId;
    writeState({ ...state, task: isActive && status === "archived" ? null : isActive ? task : state.task });
    return task;
  }

  async createConversation(payload: Record<string, unknown> = {}) {
    const state = readState();
    const task = state.tasks.find((entry) => entry.id === (payload.taskId ?? (state.task as any)?.id));
    if (!task) return null;
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Nuevo chat";
    const records = createConversationRecords(
      createId("conversation-web"),
      title,
      task.projectId ?? null,
      task.workspaceId ?? (state.workspace as any)?.id,
      task.id
    );
    task.activeConversationId = records.conversation.id;
    addActivity(state, {
      type: "conversation.created",
      summary: `Se creó la conversación ${title}.`,
      projectId: task.projectId,
      taskId: task.id,
      entityId: records.conversation.id,
      entityKind: "conversation"
    });
    writeState({
      ...state,
      task,
      conversation: records.conversation,
      conversations: [records.summary, ...state.conversations]
    });
    return records.conversation;
  }

  async listConversations(taskId?: string) {
    const state = readState();
    const targetTaskId = taskId ?? (state.task as any)?.id;
    return state.conversations
      .filter((entry) => !targetTaskId || entry.taskId === targetTaskId)
      .map((entry) => ({ id: entry.id, taskId: entry.taskId, title: entry.title, projectId: state.tasks.find((task) => task.id === entry.taskId)?.projectId ?? null }));
  }

  async openConversation(conversationId: string) {
    const state = readState();
    const summary = state.conversations.find((candidate) => candidate.id === conversationId);
    if (!summary) {
      return null;
    }

    const task = state.tasks.find((entry) => entry.id === summary.taskId) ?? null;
    if (!task) return null;
    const project = state.projects.find((entry) => entry.id === task.projectId) ?? null;
    task.activeConversationId = summary.id;
    const conversation = {
      id: summary.id,
      taskId: summary.taskId,
      projectId: task.projectId,
      title: summary.title,
      status: "active",
      updatedAt: nowIso()
    };
    writeState({ ...state, project, task, conversation });
    return conversation;
  }

  async updateConversation(conversationId: string, patch: Record<string, unknown>) {
    const state = readState();
    const summary = state.conversations.find((entry) => entry.id === conversationId);
    if (!summary) return null;
    if (typeof patch.title === "string" && patch.title.trim()) {
      summary.title = patch.title.trim();
      summary.thread.title = patch.title.trim();
    }
    const conversation = (state.conversation as any)?.id === conversationId
      ? { ...state.conversation, title: summary.title, updatedAt: nowIso() }
      : state.conversation;
    writeState({ ...state, conversation });
    return conversation as Record<string, unknown> | null;
  }

  async appendMessage(
    conversationId: string,
    message: { id?: string; role: "user" | "assistant" | "system"; body: string; metadata?: Record<string, unknown> }
  ) {
    const state = readState();
    let summary = state.conversations.find((candidate) => candidate.id === conversationId);
    let task = state.task;
    let conversation = state.conversation;

    if (!summary) {
      const workspaceId = (state.workspace as any)?.id;
      if (!workspaceId) return null;
      const records = createConversationRecords(conversationId, "Chat de CoCreate", null, workspaceId);
      summary = records.summary;
      task = records.task;
      conversation = records.conversation;
      state.tasks.push(records.task);
    }

    const nextMessage = {
      id: message.id ?? createId("message-web"),
      role: message.role,
      body: message.body,
      createdAt: nowIso(),
      metadata: message.metadata
    };
    const updatedSummary = {
      ...summary,
      thread: {
        ...summary.thread,
        preview: message.body.slice(0, 72)
      },
      messages: [...summary.messages, nextMessage]
    };
    const conversations = [updatedSummary, ...state.conversations.filter((candidate) => candidate.id !== conversationId)];
    writeState({
      ...state,
      task,
      conversation,
      conversations
    });
    return {
      conversation,
      messages: updatedSummary.messages
    };
  }

  async recordWebExecution(event: Record<string, unknown>) {
    const state = readState();
    const timestamp = typeof event.timestamp === "string" ? event.timestamp : nowIso();
    const status = typeof event.type === "string" ? event.type.replace("web.execution.", "") : "unknown";
    const sourcesCount = Number(event.sourcesCount ?? 0);
    const summary = status === "completed"
      ? `CoCreate verificó información en ${sourcesCount} fuentes públicas.`
      : status === "cancelled"
        ? "La consulta web fue cancelada."
        : status === "failed"
          ? "La consulta web no pudo completarse."
          : "CoCreate inició una verificación web pública.";
    const activity = {
      id: createId("activity-web"),
      workspaceId: (state.workspace as any)?.id ?? null,
      projectId: (state.project as any)?.id ?? null,
      taskId: (state.task as any)?.id ?? null,
      actor: { type: "system", id: "cocreate-system", displayName: "CoCreate" },
      type: event.type,
      summary,
      timestamp,
      relatedEntity: { id: event.requestId ?? null, kind: "web-execution" },
      metadata: {
        requestedBy: "local-user",
        performedBy: "cocreate-system",
        tool: "TrustedWebTool",
        provider: event.provider ?? "web-tool",
        status,
        startedAt: event.startedAt ?? timestamp,
        completedAt: status === "started" ? null : timestamp,
        duration: event.duration ?? null,
        sourcesCount,
        verifiedAt: event.verifiedAt ?? null,
        confidence: event.confidence ?? "Unavailable",
        error: event.error ?? null
      }
    };
    writeState({ ...state, activities: [...state.activities, activity] });
    return activity;
  }

  async listArtifacts(filters: Record<string, unknown> = {}) {
    const state = readState();
    return state.artifacts.filter((entry) => {
      if (typeof filters.taskId === "string" && entry.taskId !== filters.taskId) return false;
      if (typeof filters.projectId === "string" && entry.projectId !== filters.projectId) return false;
      return true;
    });
  }

  async listActivity(filters: Record<string, unknown> = {}) {
    const state = readState();
    return state.activities.filter((entry: any) => {
      if (typeof filters.taskId === "string" && entry.taskId !== filters.taskId) return false;
      if (typeof filters.projectId === "string" && entry.projectId !== filters.projectId) return false;
      return true;
    });
  }
}
