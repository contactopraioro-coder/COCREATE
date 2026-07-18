import type { WorkspaceGateway } from "../../infrastructure/workspace/workspace-gateway.js";

export type WorkspaceChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type WorkspaceThreadSummary = {
  id: string;
  title: string;
  preview: string;
};

export type WorkspaceConversationBootstrap = {
  id: string;
  taskId: string;
  title: string;
  thread: WorkspaceThreadSummary;
  messages: WorkspaceChatMessage[];
};

export type WorkspaceBootstrap = {
  workspace: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  task: Record<string, unknown> | null;
  conversation: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
  identity?: {
    identity: Record<string, unknown> | null;
    profile: Record<string, unknown> | null;
    device: Record<string, unknown> | null;
    preparedLink: Record<string, unknown> | null;
  };
  ownership?: {
    workspaceOwner: Record<string, unknown> | null;
  };
  runtime?: {
    activeExecution: Record<string, unknown> | null;
    codex: {
      executionId: string | null;
      threadId: string | null;
      turnId: string | null;
      capability: string | null;
      status: string;
    };
  };
  conversations: WorkspaceConversationBootstrap[];
  activities: Array<Record<string, unknown>>;
};

export class WorkspaceRuntimeService {
  constructor(private readonly gateway: WorkspaceGateway) {}

  isAvailable() {
    return this.gateway.isAvailable();
  }

  async getBootstrap(): Promise<WorkspaceBootstrap | null> {
    return this.gateway.getBootstrap();
  }

  async createConversation(title = "Nuevo chat") {
    return this.gateway.createChat({
      title
    });
  }

  async createTaskWithConversation(input: { projectId: string | null; title: string; description?: string }) {
    return this.gateway.createChat(input);
  }

  async createProject(input: { name: string; description?: string; rootPath?: string | null }) {
    return this.gateway.createProject(input);
  }

  async listProjects(includeArchived = true) {
    return this.gateway.listProjects({ includeArchived });
  }

  async openProject(projectId: string) {
    return this.gateway.openProject(projectId);
  }

  async updateProject(projectId: string, patch: Record<string, unknown>) {
    return this.gateway.updateProject(projectId, patch);
  }

  async archiveProject(projectId: string) {
    return this.gateway.archiveProject(projectId);
  }

  async selectProjectDirectory() {
    return this.gateway.selectDirectory();
  }

  async createTask(input: { projectId: string | null; title: string; description?: string }) {
    return this.gateway.createTask(input);
  }

  async listTasks(projectId?: string | null, includeArchived = true) {
    return this.gateway.listTasks(projectId, { includeArchived });
  }

  async openTask(taskId: string) {
    return this.gateway.openTask(taskId);
  }

  async updateTask(taskId: string, patch: Record<string, unknown>) {
    return this.gateway.updateTask(taskId, patch);
  }

  async changeTaskStatus(taskId: string, status: string) {
    return this.gateway.changeTaskStatus(taskId, status);
  }

  async createTaskConversation(taskId: string, title = "Nuevo chat") {
    return this.gateway.createConversation({ taskId, title });
  }

  async listConversations(taskId?: string) {
    return this.gateway.listConversations(taskId);
  }

  async openConversation(conversationId: string) {
    return this.gateway.openConversation(conversationId);
  }

  async updateConversation(conversationId: string, patch: Record<string, unknown>) {
    return this.gateway.updateConversation(conversationId, patch);
  }

  async listArtifacts(filters: Record<string, unknown> = {}) {
    return this.gateway.listArtifacts(filters);
  }

  async listActivity(filters: Record<string, unknown> = {}) {
    return this.gateway.listActivity(filters);
  }

  async appendMessage(conversationId: string, message: WorkspaceChatMessage) {
    return this.gateway.appendMessage(conversationId, message);
  }

  async recordWebExecution(event: Record<string, unknown>) {
    return this.gateway.recordWebExecution(event);
  }
}
