import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  WORKSPACE_SCHEMA_VERSION,
  createActivityId,
  createArtifactId,
  createConversationId,
  createEventId,
  createProjectId,
  createSessionId,
  createTaskId,
  createWorkspaceId,
  nowIso
} from "../shared/workspace-domain.js";
import { normalizeLegacyActor } from "../shared/identity-domain.js";

function createDefaultWorkspaceState() {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    updatedAt: nowIso(),
    metadata: {
      migrationVersion: 1
    },
    workspaces: [],
    projects: [],
    tasks: [],
    conversations: [],
    sessions: [],
    executionReferences: [],
    artifacts: [],
    activities: [],
    messagesByConversation: {},
    activeWorkspaceId: null,
    activeProjectId: null,
    activeTaskId: null,
    activeConversationId: null,
    activeSessionId: null
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object");
}

async function readJsonFileSafe(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempFile, filePath);
}

function normalizeMessage(entry) {
  if (!isRecord(entry)) {
    return null;
  }

  const role = entry.role === "assistant" || entry.role === "system" ? entry.role : "user";
  const body = typeof entry.body === "string" ? entry.body : "";
  if (!body.trim()) {
    return null;
  }

  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : createId("msg"),
    role,
    body,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : nowIso(),
    metadata: isRecord(entry.metadata) ? entry.metadata : undefined
  };
}

function normalizeEntity(entry, defaults) {
  if (!isRecord(entry)) {
    return null;
  }

  return {
    ...defaults,
    ...entry
  };
}

function normalizeState(rawState) {
  const fallback = createDefaultWorkspaceState();
  if (!isRecord(rawState)) {
    return fallback;
  }
  if (typeof rawState.version === "number" && rawState.version > WORKSPACE_SCHEMA_VERSION) {
    return {
      ...fallback,
      metadata: {
        ...fallback.metadata,
        recoveredFromUnsupportedVersion: rawState.version
      }
    };
  }

  const state = {
    version: WORKSPACE_SCHEMA_VERSION,
    updatedAt: typeof rawState.updatedAt === "string" ? rawState.updatedAt : nowIso(),
    metadata: isRecord(rawState.metadata) ? rawState.metadata : { migrationVersion: 1 },
    workspaces: Array.isArray(rawState.workspaces) ? rawState.workspaces : [],
    projects: Array.isArray(rawState.projects) ? rawState.projects : [],
    tasks: Array.isArray(rawState.tasks) ? rawState.tasks : [],
    conversations: Array.isArray(rawState.conversations) ? rawState.conversations : [],
    sessions: Array.isArray(rawState.sessions) ? rawState.sessions : [],
    executionReferences: Array.isArray(rawState.executionReferences) ? rawState.executionReferences : [],
    artifacts: Array.isArray(rawState.artifacts) ? rawState.artifacts : [],
    activities: Array.isArray(rawState.activities) ? rawState.activities : [],
    messagesByConversation: isRecord(rawState.messagesByConversation) ? rawState.messagesByConversation : {},
    activeWorkspaceId: typeof rawState.activeWorkspaceId === "string" ? rawState.activeWorkspaceId : null,
    activeProjectId: typeof rawState.activeProjectId === "string" ? rawState.activeProjectId : null,
    activeTaskId: typeof rawState.activeTaskId === "string" ? rawState.activeTaskId : null,
    activeConversationId: typeof rawState.activeConversationId === "string" ? rawState.activeConversationId : null,
    activeSessionId: typeof rawState.activeSessionId === "string" ? rawState.activeSessionId : null
  };

  state.workspaces = state.workspaces
    .map((entry) =>
      normalizeEntity(entry, {
        id: createWorkspaceId(),
        name: "Workspace personal",
        type: "personal-local",
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        activeProjectId: null,
        owner: null,
        metadata: {}
      })
    )
    .filter(Boolean);
  state.projects = state.projects
    .map((entry) =>
      normalizeEntity(entry, {
        id: createProjectId(),
        workspaceId: state.activeWorkspaceId,
        name: "Proyecto local",
        description: "",
        status: "active",
        rootPath: null,
        repository: null,
        createdBy: null,
        updatedBy: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastOpenedAt: null,
        activeTaskId: null,
        metadata: {}
      })
    )
    .filter(Boolean);
  state.tasks = state.tasks
    .map((entry) =>
      normalizeEntity(entry, {
        id: createTaskId(),
        workspaceId: state.activeWorkspaceId,
        projectId: state.activeProjectId,
        title: "Nueva tarea",
        description: "",
        status: "draft",
        priority: "normal",
        createdBy: null,
        updatedBy: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: null,
        activeConversationId: null,
        executionIds: [],
        artifactIds: [],
        metadata: {}
      })
    )
    .filter(Boolean);
  state.conversations = state.conversations
    .map((entry) =>
      normalizeEntity(entry, {
        id: createConversationId(),
        workspaceId: state.activeWorkspaceId,
        projectId: state.activeProjectId,
        taskId: state.activeTaskId,
        title: "Nuevo chat",
        kind: "assistant",
        createdBy: null,
        updatedBy: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastMessageAt: null,
        metadata: {}
      })
    )
    .filter(Boolean);
  state.sessions = state.sessions
    .map((entry) =>
      normalizeEntity(entry, {
        id: createSessionId(),
        workspaceId: state.activeWorkspaceId,
        projectId: state.activeProjectId,
        taskId: state.activeTaskId,
        conversationId: state.activeConversationId,
        startedAt: nowIso(),
        endedAt: null,
        status: "active",
        restoredFromSessionId: null,
        operationalState: {}
      })
    )
    .filter(Boolean);
  state.executionReferences = state.executionReferences
    .map((entry) =>
      normalizeEntity(entry, {
        id: createEventId("execution-ref"),
        executionId: "",
        workspaceId: state.activeWorkspaceId,
        projectId: state.activeProjectId,
        taskId: state.activeTaskId,
        conversationId: state.activeConversationId,
        status: "unknown",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        metadata: {}
      })
    )
    .filter(Boolean);
  state.artifacts = state.artifacts
    .map((entry) =>
      normalizeEntity(entry, {
        id: createArtifactId(),
        workspaceId: state.activeWorkspaceId,
        projectId: state.activeProjectId,
        taskId: null,
        executionId: null,
        type: "report",
        title: "Artifact",
        uri: null,
        contentRef: null,
        status: "active",
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        metadata: {}
      })
    )
    .filter(Boolean);
  state.activities = state.activities
    .map((entry) =>
      normalizeEntity(entry, {
        id: createActivityId(),
        workspaceId: state.activeWorkspaceId,
        projectId: null,
        taskId: null,
        actor: normalizeLegacyActor(entry?.actor),
        type: "activity.recorded",
        summary: "Actividad registrada",
        timestamp: nowIso(),
        relatedEntity: null,
        metadata: {}
      })
    )
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  state.messagesByConversation = Object.fromEntries(
    Object.entries(state.messagesByConversation).map(([conversationId, messages]) => [
      conversationId,
      Array.isArray(messages) ? messages.map(normalizeMessage).filter(Boolean) : []
    ])
  );

  return state;
}

function ensurePersonalWorkspace(state) {
  let workspace = state.workspaces.find((entry) => entry.type === "personal-local");
  if (!workspace) {
    workspace = {
      id: createWorkspaceId("personal-local"),
      name: "Workspace personal",
      type: "personal-local",
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      activeProjectId: null,
      owner: null,
      metadata: {
        isDefault: true
      }
    };
    state.workspaces.push(workspace);
  }

  state.activeWorkspaceId = workspace.id;
  return workspace;
}

function ensureCompatibilityProject(state, workspace) {
  let project = state.projects.find((entry) => entry.workspaceId === workspace.id && entry.metadata?.isCompatibilityProject);
  if (!project) {
    project = {
      id: createProjectId("compatibility"),
      workspaceId: workspace.id,
      name: "Proyecto local",
      description: "Proyecto inicial para conversaciones migradas",
      status: "active",
      rootPath: null,
      repository: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastOpenedAt: nowIso(),
      activeTaskId: null,
      metadata: {
        isCompatibilityProject: true
      }
    };
    state.projects.push(project);
  }

  const activeProject = state.projects.find((entry) =>
    entry.id === state.activeProjectId &&
    entry.workspaceId === workspace.id &&
    entry.status !== "archived"
  );
  state.activeProjectId = activeProject?.id ?? project.id;
  workspace.activeProjectId = state.activeProjectId;
  return project;
}

function extractLegacyThreadsFromWorkbenchSnapshot(snapshot) {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.threads) || !isRecord(snapshot.messagesByThread)) {
    return null;
  }

  return {
    threads: snapshot.threads.filter((thread) => isRecord(thread) && typeof thread.id === "string"),
    messagesByThread: snapshot.messagesByThread,
    activeThreadId: typeof snapshot.activeThreadId === "string" ? snapshot.activeThreadId : null
  };
}

function migrateLegacyAppState(state, legacyAppState) {
  if (!isRecord(legacyAppState) || state.metadata?.legacyMigrationCompleted) {
    return false;
  }

  const workspace = ensurePersonalWorkspace(state);
  const project = ensureCompatibilityProject(state, workspace);
  const sessions = Array.isArray(legacyAppState.sessions) ? legacyAppState.sessions : [];

  let migratedAny = false;
  for (const session of sessions) {
    const snapshot = extractLegacyThreadsFromWorkbenchSnapshot(session?.renderer?.workbench);
    if (!snapshot) {
      continue;
    }

    for (const legacyThread of snapshot.threads) {
      const legacyId = legacyThread.id;
      const taskId = createTaskId(legacyId);
      const conversationId = createConversationId(legacyId);
      if (state.conversations.some((entry) => entry.metadata?.legacyThreadId === legacyId)) {
        continue;
      }

      const createdAt = typeof session.createdAt === "number" ? new Date(session.createdAt).toISOString() : nowIso();
      const updatedAt = typeof session.updatedAt === "number" ? new Date(session.updatedAt).toISOString() : nowIso();
      const title = typeof legacyThread.title === "string" && legacyThread.title.trim() ? legacyThread.title : "Nuevo chat";
      const preview = typeof legacyThread.preview === "string" ? legacyThread.preview : "";
      const task = {
        id: taskId,
        workspaceId: workspace.id,
        projectId: project.id,
        title,
        description: preview,
        status: "active",
        priority: "normal",
        createdAt,
        updatedAt,
        completedAt: null,
        activeConversationId: conversationId,
        executionIds: [],
        artifactIds: [],
        metadata: {
          legacyThreadId: legacyId
        }
      };
      const conversation = {
        id: conversationId,
        workspaceId: workspace.id,
        projectId: project.id,
        taskId,
        title,
        kind: "assistant",
        createdAt,
        updatedAt,
        lastMessageAt: updatedAt,
        metadata: {
          legacyThreadId: legacyId
        }
      };

      state.tasks.push(task);
      state.conversations.push(conversation);
      state.messagesByConversation[conversationId] = Array.isArray(snapshot.messagesByThread[legacyId])
        ? snapshot.messagesByThread[legacyId].map(normalizeMessage).filter(Boolean)
        : [];
      migratedAny = true;

      if (snapshot.activeThreadId === legacyId) {
        state.activeTaskId = taskId;
        state.activeConversationId = conversationId;
        project.activeTaskId = taskId;
      }
    }
  }

  state.metadata = {
    ...(state.metadata ?? {}),
    legacyMigrationCompleted: true,
    legacyMigrationCompletedAt: nowIso()
  };

  return migratedAny;
}

export function createWorkspaceStore({ filePath }) {
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function loadNow() {
    const rawState = await readJsonFileSafe(filePath, createDefaultWorkspaceState());
    return normalizeState(rawState);
  }

  async function load() {
    await mutationQueue;
    return loadNow();
  }

  async function saveNow(state) {
    const nextState = normalizeState({
      ...state,
      updatedAt: nowIso()
    });
    await writeJsonAtomic(filePath, nextState);
    return nextState;
  }

  function save(state) {
    return enqueue(() => saveNow(state));
  }

  function update(mutator) {
    return enqueue(async () => {
      const current = await loadNow();
      await mutator(current);
      return saveNow(current);
    });
  }

  return {
    filePath,
    load,
    save,
    update,
    ensurePersonalWorkspace,
    ensureCompatibilityProject,
    migrateLegacyAppState
  };
}
