import type { CodexStatus } from "../../../shared/codex-contracts.js";
import { redactCodexDiagnostic } from "../../../shared/codex-upstream-contracts.js";
import {
  createInitialCapabilityExposure,
  deriveActiveWorkState,
  type CapabilityExposureState
} from "../../../shared/upstream-capability-exposure.js";
import type { UpstreamCapabilityExposureService } from "./upstream-capability-exposure-service.js";
import type { WorkspaceBootstrap, WorkspaceRuntimeService } from "./workspace-runtime-service.js";

export type WorkspaceEntity = {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  rootPathLabel?: string | null;
  hasDirectory?: boolean;
  projectId?: string | null;
  activeExecutionId?: string | null;
  lastExecutionId?: string | null;
  threadId?: string | null;
  assistantPreferences?: {
    planModeEnabled: boolean;
    planModeName: string | null;
    selectedSkillNames: string[];
  } | null;
};

export type WorkspaceConversationItem = {
  id: string;
  taskId: string;
  title: string;
  threadState: "new" | "active" | "restored" | "unavailable" | "stale" | "fallback-exec";
};

export type WorkspaceArtifactItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  version: number;
  timestamp: string;
  executionId: string | null;
  files: string[];
  additions: number | null;
  deletions: number | null;
  preview: string | null;
  disposition: "proposed" | "applied" | "result";
};

export type WorkspaceActivityItem = {
  id: string;
  type: string;
  summary: string;
  actor: string;
  timestamp: string;
  count: number;
};

export type CapabilityAvailability = "Available" | "Unavailable" | "Not configured" | "Desktop only" | "Degraded" | "Unsupported";

export type WorkspaceRuntimeNotice = {
  code: "desktop-only" | "app-server-unavailable" | "binary-missing" | "authentication-required" | "provider-not-configured" | "connection-lost" | "fallback-exec" | "turn-failed";
  title: string;
  message: string;
  tone: "info" | "warning" | "danger";
} | null;

export type WorkspaceExperienceState = {
  version: 1;
  environment: "desktop" | "web";
  workspace: WorkspaceEntity | null;
  project: WorkspaceEntity | null;
  task: WorkspaceEntity | null;
  conversation: WorkspaceConversationItem | null;
  projects: WorkspaceEntity[];
  tasks: WorkspaceEntity[];
  conversations: WorkspaceConversationItem[];
  thread: { id: string | null; state: WorkspaceConversationItem["threadState"] };
  turn: { id: string | null; status: string };
  execution: Record<string, unknown> | null;
  upstreamExecution: CapabilityExposureState["execution"];
  activeWork: ReturnType<typeof deriveActiveWorkState>;
  plan: CapabilityExposureState["plan"];
  command: CapabilityExposureState["command"];
  tool: CapabilityExposureState["tool"];
  approval: CapabilityExposureState["approval"];
  usage: CapabilityExposureState["usage"];
  artifacts: WorkspaceArtifactItem[];
  activities: WorkspaceActivityItem[];
  capabilities: Array<{ id: string; label: string; availability: CapabilityAvailability }>;
  runtime: {
    mode: string;
    codexStatus: CapabilityAvailability;
    notice: WorkspaceRuntimeNotice;
  };
  restoration: {
    status: "fresh" | "restored" | "interrupted";
    message: string;
  };
  updatedAt: string;
};

type Listener = (state: WorkspaceExperienceState) => void;

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safePathLabel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || null;
}

function projectEntity(value: unknown, kind: "workspace" | "project" | "task"): WorkspaceEntity | null {
  const item = record(value);
  if (!stringValue(item.id)) return null;
  const name = kind === "task"
    ? stringValue(item.title, "Tarea sin título")
    : stringValue(item.name, kind === "workspace" ? "Workspace personal" : "Proyecto sin nombre");
  return {
    id: item.id,
    name,
    status: stringValue(item.status, "active"),
    archived: item.status === "archived",
    ...(kind === "project"
      ? { rootPathLabel: safePathLabel(item.rootPath), hasDirectory: typeof item.rootPath === "string" && Boolean(item.rootPath) }
      : {}),
    ...(kind === "task"
      ? {
          activeExecutionId: stringValue(item.metadata?.activeExecutionId) || null,
          projectId: stringValue(item.projectId) || null,
          lastExecutionId: stringValue(item.metadata?.lastExecutionId) || null,
          threadId: stringValue(item.metadata?.activeCodexThreadId) || null,
          assistantPreferences: item.metadata?.assistantPreferences && typeof item.metadata.assistantPreferences === "object"
            ? {
                planModeEnabled: item.metadata.assistantPreferences.planModeEnabled === true,
                planModeName: stringValue(item.metadata.assistantPreferences.planModeName) || null,
                selectedSkillNames: Array.isArray(item.metadata.assistantPreferences.selectedSkillNames)
                  ? item.metadata.assistantPreferences.selectedSkillNames.filter((name: unknown): name is string => typeof name === "string").slice(0, 8)
                  : []
              }
            : null
        }
      : {})
  };
}

function threadState(
  conversationId: string,
  activeConversationId: string | null,
  exposure: CapabilityExposureState,
  status: CodexStatus | null,
  task: WorkspaceEntity | null,
  environment: "desktop" | "web"
): WorkspaceConversationItem["threadState"] {
  if (environment === "web") return "unavailable";
  if (status?.runtimeMode === "exec") return "fallback-exec";
  if (!status?.available || status.runtimeMode !== "app-server") return "unavailable";
  if (conversationId !== activeConversationId) return task?.threadId ? "restored" : "new";
  if (exposure.thread.origin === "restored") return "restored";
  if (exposure.thread.status === "Failed") return "stale";
  if (exposure.thread.id || task?.threadId) return "active";
  return "new";
}

function projectArtifacts(values: Array<Record<string, unknown>>): WorkspaceArtifactItem[] {
  const seen = new Set<string>();
  return values
    .slice()
    .sort((left, right) => Date.parse(String(right.updatedAt ?? right.createdAt ?? "")) - Date.parse(String(left.updatedAt ?? left.createdAt ?? "")))
    .filter((value) => {
      const id = stringValue(value.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 50)
    .map((value) => {
      const metadata = record(value.metadata);
      const type = stringValue(value.type, "result");
      return {
        id: String(value.id),
        type,
        title: stringValue(value.title, "Artifact"),
        status: stringValue(value.status, "active"),
        version: Number.isFinite(value.version) ? Number(value.version) : 1,
        timestamp: stringValue(value.updatedAt ?? value.createdAt, new Date(0).toISOString()),
        executionId: stringValue(value.executionId) || null,
        files: Array.isArray(metadata.files)
          ? metadata.files.filter((file: unknown): file is string => typeof file === "string").map((file: string) => safePathLabel(file) ?? "archivo").slice(0, 30)
          : typeof value.uri === "string" ? [safePathLabel(value.uri) ?? "archivo"] : [],
        additions: Number.isFinite(metadata.additions) ? Number(metadata.additions) : null,
        deletions: Number.isFinite(metadata.deletions) ? Number(metadata.deletions) : null,
        preview: typeof metadata.diffPreview === "string"
          ? redactCodexDiagnostic(metadata.diffPreview, 4_000)
          : typeof metadata.outputPreview === "string"
            ? redactCodexDiagnostic(metadata.outputPreview, 1_000)
            : null,
        disposition: type === "diff"
          ? "proposed"
          : type === "patch" || type === "generated-file"
            ? metadata.status === "Completed" ? "applied" : "proposed"
            : "result"
      };
    });
}

function projectActivity(values: Array<Record<string, unknown>>): WorkspaceActivityItem[] {
  const projected: WorkspaceActivityItem[] = [];
  for (const value of values
    .slice()
    .sort((left, right) => Date.parse(String(left.timestamp ?? "")) - Date.parse(String(right.timestamp ?? "")))
    .slice(-120)) {
    const summary = redactCodexDiagnostic(stringValue(value.summary, "Actividad registrada"), 500);
    const actor = record(value.actor);
    const item = {
      id: stringValue(value.id, `activity-${projected.length}`),
      type: stringValue(value.type, "activity.recorded"),
      summary,
      actor: stringValue(actor.displayName, actor.type === "human" ? "Tú" : "CoCreate"),
      timestamp: stringValue(value.timestamp, new Date(0).toISOString()),
      count: 1
    };
    const previous = projected[projected.length - 1];
    if (previous && previous.type === item.type && previous.summary === item.summary) {
      previous.count += 1;
      previous.timestamp = item.timestamp;
    } else {
      projected.push(item);
    }
  }
  return projected.slice(-80);
}

export function deriveRuntimeNotice(status: CodexStatus | null, environment: "desktop" | "web", exposure: CapabilityExposureState): WorkspaceRuntimeNotice {
  if (environment === "web") {
    return {
      code: "desktop-only",
      title: "Codex App Server está disponible en Desktop",
      message: "CoCreate Web mantiene Workspace y chat, pero no simula shell, filesystem, MCP ni threads locales.",
      tone: "info"
    };
  }
  const diagnostic = `${status?.error ?? ""} ${status?.fallback?.reason ?? ""}`.toLowerCase();
  if (status?.fallback?.active || status?.runtimeMode === "exec") {
    return {
      code: "fallback-exec",
      title: "Fallback exec activo",
      message: "Codex responde, pero algunas capacidades del App Server no están disponibles en esta sesión.",
      tone: "warning"
    };
  }
  if (/auth|login|credential/.test(diagnostic)) {
    return {
      code: "authentication-required",
      title: "Codex necesita autenticación",
      message: "Autentica Codex antes de iniciar una nueva Task.",
      tone: "warning"
    };
  }
  if (/not found|enoent|binary|executable/.test(diagnostic)) {
    return {
      code: "binary-missing",
      title: "No se encontró el binario de Codex",
      message: "Instala o configura Codex para habilitar ejecución local.",
      tone: "danger"
    };
  }
  if (exposure.execution.status === "Failed") {
    return {
      code: "turn-failed",
      title: "El último Turn falló",
      message: exposure.warnings[exposure.warnings.length - 1]?.message ?? "Revisa el estado del runtime y vuelve a intentarlo.",
      tone: "danger"
    };
  }
  if (!status?.available || status.runtimeMode !== "app-server") {
    return {
      code: "app-server-unavailable",
      title: "Codex App Server no está disponible",
      message: "CoCreate no mostrará capabilities upstream hasta recuperar la conexión.",
      tone: "danger"
    };
  }
  return null;
}

function projectCapabilities(
  status: CodexStatus | null,
  environment: "desktop" | "web",
  exposure: CapabilityExposureState
) {
  return exposure.registry.entries.map((entry) => {
    let availability: CapabilityAvailability;
    if (environment === "web") availability = "Desktop only";
    else if (entry.enabled) availability = "Available";
    else if (status?.fallback?.active || status?.runtimeMode === "exec") availability = "Degraded";
    else if (!status?.available) availability = "Unavailable";
    else if (!status.appServer) availability = "Not configured";
    else availability = "Unsupported";
    return { id: entry.id, label: entry.label, availability };
  });
}

function emptyState(environment: "desktop" | "web", exposure: CapabilityExposureState): WorkspaceExperienceState {
  return {
    version: 1,
    environment,
    workspace: null,
    project: null,
    task: null,
    conversation: null,
    projects: [],
    tasks: [],
    conversations: [],
    thread: { id: null, state: environment === "web" ? "unavailable" : "new" },
    turn: { id: null, status: "Idle" },
    execution: null,
    upstreamExecution: exposure.execution,
    activeWork: deriveActiveWorkState(exposure),
    plan: exposure.plan,
    command: exposure.command,
    tool: exposure.tool,
    approval: exposure.approval,
    usage: exposure.usage,
    artifacts: [],
    activities: [],
    capabilities: [],
    runtime: { mode: environment === "web" ? "web" : "unknown", codexStatus: "Unavailable", notice: null },
    restoration: { status: "fresh", message: "Preparando Workspace..." },
    updatedAt: new Date().toISOString()
  };
}

export class WorkspaceExperienceService {
  private state: WorkspaceExperienceState;
  private status: CodexStatus | null = null;
  private listeners = new Set<Listener>();
  private refreshPromise: Promise<WorkspaceExperienceState> | null = null;
  private createTaskPromise: Promise<Record<string, unknown> | null> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribeExposure: () => void;

  constructor(
    private readonly workspace: WorkspaceRuntimeService,
    private readonly exposureService: UpstreamCapabilityExposureService,
    private readonly environment: "desktop" | "web"
  ) {
    this.state = emptyState(environment, exposureService.getSnapshot());
    this.unsubscribeExposure = exposureService.subscribe((latestExposure) => {
      const exposure = this.exposureForTask(latestExposure, this.state.task);
      this.state = {
        ...this.state,
        activeWork: deriveActiveWorkState(exposure),
        plan: exposure.plan,
        command: exposure.command,
        tool: exposure.tool,
        approval: exposure.approval,
        usage: exposure.usage,
        thread: {
          id: exposure.thread.id ?? this.state.thread.id,
          state: threadState(
            this.state.conversation?.id ?? "",
            this.state.conversation?.id ?? null,
            exposure,
            this.status,
            this.state.task,
            this.environment
          )
        },
        turn: { id: exposure.turn.id, status: exposure.turn.status },
        upstreamExecution: exposure.execution,
        capabilities: projectCapabilities(this.status, this.environment, exposure),
        runtime: {
          ...this.state.runtime,
          notice: deriveRuntimeNotice(this.status, this.environment, exposure)
        },
        updatedAt: exposure.updatedAt
      };
      this.emit();
      if (exposure.lastActivity || exposure.diff || !exposure.execution.active) this.scheduleRefresh();
    });
  }

  getSnapshot() {
    return this.state;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setCodexStatus(status: CodexStatus) {
    this.status = status;
    const exposure = this.exposureService.getSnapshot();
    this.state = {
      ...this.state,
      capabilities: projectCapabilities(status, this.environment, exposure),
      runtime: {
        mode: this.environment === "web" ? "web-api" : status.runtimeMode ?? status.mode,
        codexStatus: status.available && status.runtimeMode === "app-server" ? "Available" : status.fallback?.active ? "Degraded" : "Unavailable",
        notice: deriveRuntimeNotice(status, this.environment, exposure)
      }
    };
    this.emit();
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.load().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async load() {
    const bootstrap = await this.workspace.getBootstrap();
    const latestExposure = this.exposureService.getSnapshot();
    if (!bootstrap) {
      this.state = emptyState(this.environment, latestExposure);
      this.emit();
      return this.state;
    }
    const activeProject = projectEntity(bootstrap.project, "project");
    const activeTask = projectEntity(bootstrap.task, "task");
    const exposure = this.exposureForTask(latestExposure, activeTask);
    const activeConversationId = stringValue(record(bootstrap.conversation).id) || null;
    const [projects, tasks, conversations, artifacts, activities] = await Promise.all([
      this.workspace.listProjects(true),
      this.workspace.listTasks(null, true),
      activeTask ? this.workspace.listConversations(activeTask.id) : Promise.resolve([]),
      activeTask ? this.workspace.listArtifacts({ taskId: activeTask.id }) : Promise.resolve([]),
      activeTask ? this.workspace.listActivity({ taskId: activeTask.id }) : Promise.resolve([])
    ]);
    const conversationItems = conversations.map((value) => {
      const item = record(value);
      return {
        id: stringValue(item.id),
        taskId: stringValue(item.taskId),
        title: stringValue(item.title, "Nuevo chat"),
        threadState: threadState(stringValue(item.id), activeConversationId, exposure, this.status, activeTask, this.environment)
      } satisfies WorkspaceConversationItem;
    }).filter((item) => item.id);
    const activeConversation = conversationItems.find((item) => item.id === activeConversationId) ?? null;
    const session = record(bootstrap.session);
    const restorationStatus = session.status === "restored"
      ? record(bootstrap.runtime).codex?.status === "Interrupted" ? "interrupted" : "restored"
      : "fresh";
    this.state = {
      version: 1,
      environment: this.environment,
      workspace: projectEntity(bootstrap.workspace, "workspace"),
      project: activeProject,
      task: activeTask,
      conversation: activeConversation,
      projects: projects.map((value) => projectEntity(value, "project")).filter(Boolean) as WorkspaceEntity[],
      tasks: tasks.map((value) => projectEntity(value, "task")).filter(Boolean) as WorkspaceEntity[],
      conversations: conversationItems,
      thread: {
        id: exposure.thread.id ?? (stringValue(record(bootstrap.runtime).codex?.threadId) || null),
        state: activeConversation?.threadState ?? (this.environment === "web" ? "unavailable" : "new")
      },
      turn: { id: exposure.turn.id, status: exposure.turn.status },
      execution: record(bootstrap.runtime).activeExecution ?? null,
      upstreamExecution: exposure.execution,
      activeWork: deriveActiveWorkState(exposure),
      plan: exposure.plan,
      command: exposure.command,
      tool: exposure.tool,
      approval: exposure.approval,
      usage: exposure.usage,
      artifacts: projectArtifacts(artifacts),
      activities: projectActivity(activities),
      capabilities: projectCapabilities(this.status, this.environment, exposure),
      runtime: {
        mode: this.environment === "web" ? "web-api" : this.status?.runtimeMode ?? this.status?.mode ?? "unknown",
        codexStatus: this.status?.available && this.status.runtimeMode === "app-server"
          ? "Available"
          : this.status?.fallback?.active ? "Degraded" : "Unavailable",
        notice: deriveRuntimeNotice(this.status, this.environment, exposure)
      },
      restoration: {
        status: restorationStatus,
        message: restorationStatus === "interrupted"
          ? "La ejecución anterior se cerró de forma inesperada y fue marcada como interrumpida."
          : restorationStatus === "restored" ? "Contexto operativo restaurado." : "Workspace activo."
      },
      updatedAt: new Date().toISOString()
    };
    this.emit();
    return this.state;
  }

  async createProject(input: { name: string; rootPath?: string | null }) {
    await this.workspace.createProject(input);
    return this.refresh();
  }

  async createProjectFromDirectory() {
    if (this.environment !== "desktop") return this.state;
    const rootPath = await this.workspace.selectProjectDirectory();
    if (!rootPath) return this.state;
    const segments = rootPath.replace(/\\/g, "/").split("/").filter(Boolean);
    await this.workspace.createProject({ name: segments[segments.length - 1] ?? "Proyecto local", rootPath });
    return this.refresh();
  }

  async selectProject(projectId: string) {
    await this.workspace.openProject(projectId);
    return this.refresh();
  }

  async renameProject(projectId: string, name: string) {
    await this.workspace.updateProject(projectId, { name });
    return this.refresh();
  }

  async archiveProject(projectId: string) {
    await this.workspace.archiveProject(projectId);
    return this.refresh();
  }

  async restoreProject(projectId: string) {
    await this.workspace.updateProject(projectId, { status: "active" });
    await this.workspace.openProject(projectId);
    return this.refresh();
  }

  async associateProjectDirectory(projectId: string) {
    if (this.environment !== "desktop") return this.state;
    const rootPath = await this.workspace.selectProjectDirectory();
    if (rootPath) await this.workspace.updateProject(projectId, { rootPath });
    return this.refresh();
  }

  async createTaskWithConversation(input: { projectId: string | null; title: string }) {
    if (this.createTaskPromise) return this.createTaskPromise;
    this.createTaskPromise = (async () => {
      const result = await this.workspace.createTaskWithConversation(input);
      const task = record(record(result).task);
      if (!stringValue(task.id)) return null;
      await this.refresh();
      return task;
    })().finally(() => {
      this.createTaskPromise = null;
    });
    return this.createTaskPromise;
  }

  async selectTask(taskId: string) {
    await this.workspace.openTask(taskId);
    return this.refresh();
  }

  async renameTask(taskId: string, title: string) {
    await this.workspace.updateTask(taskId, { title });
    return this.refresh();
  }

  async associateTaskProject(taskId: string, projectId: string | null) {
    await this.workspace.updateTask(taskId, { projectId });
    return this.refresh();
  }

  async changeTaskStatus(taskId: string, status: string) {
    await this.workspace.changeTaskStatus(taskId, status);
    return this.refresh();
  }

  async restoreTask(taskId: string) {
    await this.workspace.changeTaskStatus(taskId, "active");
    await this.workspace.openTask(taskId);
    return this.refresh();
  }

  async createConversation(taskId: string, title = "Nuevo chat") {
    await this.workspace.createTaskConversation(taskId, title);
    return this.refresh();
  }

  async selectConversation(conversationId: string) {
    await this.workspace.openConversation(conversationId);
    return this.refresh();
  }

  async syncGeneratedTitle(taskId: string, conversationId: string, title: string) {
    await Promise.all([
      this.workspace.updateTask(taskId, { title }),
      this.workspace.updateConversation(conversationId, { title })
    ]);
    return this.refresh();
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh().catch(() => undefined);
    }, 120);
  }

  private exposureForTask(latest: CapabilityExposureState, task: WorkspaceEntity | null) {
    const executionId = task?.activeExecutionId ?? task?.lastExecutionId ?? null;
    if (executionId && latest.execution.id === executionId) return latest;
    const preserved = this.exposureService.getSnapshotForExecution(executionId);
    if (preserved) return preserved;
    if (!latest.execution.id && !executionId) return latest;
    return {
      ...createInitialCapabilityExposure(),
      registry: latest.registry
    };
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  dispose() {
    this.unsubscribeExposure();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.listeners.clear();
  }
}
