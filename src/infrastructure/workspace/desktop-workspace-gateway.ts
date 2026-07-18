import type { WorkspaceGateway } from "./workspace-gateway";

export class DesktopWorkspaceGateway implements WorkspaceGateway {
  isAvailable() {
    return Boolean(window.overlayBridge?.getWorkspaceBootstrap);
  }

  async getBootstrap() {
    if (!window.overlayBridge?.getWorkspaceBootstrap) {
      return null;
    }

    return window.overlayBridge.getWorkspaceBootstrap();
  }

  async createChat(payload: Record<string, unknown> = {}) {
    if (!window.overlayBridge?.createWorkspaceChat) {
      return null;
    }

    return window.overlayBridge.createWorkspaceChat(payload);
  }

  async createProject(payload: Record<string, unknown> = {}) {
    return window.overlayBridge?.createWorkspaceProject?.(payload) ?? null;
  }

  async listProjects(options: { includeArchived?: boolean } = {}) {
    return window.overlayBridge?.listWorkspaceProjects?.(options) ?? [];
  }

  async openProject(projectId: string) {
    return window.overlayBridge?.openWorkspaceProject?.({ projectId }) ?? null;
  }

  async updateProject(projectId: string, patch: Record<string, unknown>) {
    return window.overlayBridge?.updateWorkspaceProject?.({ projectId, patch }) ?? null;
  }

  async archiveProject(projectId: string) {
    return window.overlayBridge?.archiveWorkspaceProject?.({ projectId }) ?? null;
  }

  async selectDirectory() {
    return window.overlayBridge?.selectWorkspaceDirectory?.() ?? null;
  }

  async createTask(payload: Record<string, unknown> = {}) {
    return window.overlayBridge?.createWorkspaceTask?.(payload) ?? null;
  }

  async listTasks(projectId?: string | null, options: { includeArchived?: boolean } = {}) {
    return window.overlayBridge?.listWorkspaceTasks?.({ projectId, ...options }) ?? [];
  }

  async openTask(taskId: string) {
    return window.overlayBridge?.openWorkspaceTask?.({ taskId }) ?? null;
  }

  async updateTask(taskId: string, patch: Record<string, unknown>) {
    return window.overlayBridge?.updateWorkspaceTask?.({ taskId, patch }) ?? null;
  }

  async changeTaskStatus(taskId: string, status: string) {
    return window.overlayBridge?.changeWorkspaceTaskStatus?.({ taskId, status }) ?? null;
  }

  async createConversation(payload: Record<string, unknown> = {}) {
    return window.overlayBridge?.createWorkspaceConversation?.(payload) ?? null;
  }

  async listConversations(taskId?: string) {
    return window.overlayBridge?.listWorkspaceConversations?.({ taskId }) ?? [];
  }

  async openConversation(conversationId: string) {
    if (!window.overlayBridge?.openWorkspaceConversation) {
      return null;
    }

    return window.overlayBridge.openWorkspaceConversation({
      conversationId
    });
  }

  async updateConversation(conversationId: string, patch: Record<string, unknown>) {
    return window.overlayBridge?.updateWorkspaceConversation?.({ conversationId, patch }) ?? null;
  }

  async appendMessage(conversationId: string, message: { id?: string; role: "user" | "assistant" | "system"; body: string; metadata?: Record<string, unknown> }) {
    if (!window.overlayBridge?.appendWorkspaceMessage) {
      return null;
    }

    return window.overlayBridge.appendWorkspaceMessage({
      conversationId,
      message
    });
  }

  async recordWebExecution(event: Record<string, unknown>) {
    if (!window.overlayBridge?.recordWorkspaceWebExecution) return null;
    return window.overlayBridge.recordWorkspaceWebExecution(event);
  }

  async listArtifacts(filters: Record<string, unknown> = {}) {
    return window.overlayBridge?.listWorkspaceArtifacts?.(filters) ?? [];
  }

  async listActivity(filters: Record<string, unknown> = {}) {
    return window.overlayBridge?.listWorkspaceActivity?.(filters) ?? [];
  }
}
