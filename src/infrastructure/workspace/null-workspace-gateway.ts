import type { WorkspaceGateway } from "./workspace-gateway";

export class NullWorkspaceGateway implements WorkspaceGateway {
  isAvailable() {
    return false;
  }

  async getBootstrap() {
    return null;
  }

  async createChat() {
    return null;
  }

  async createProject() { return null; }
  async listProjects() { return []; }
  async openProject() { return null; }
  async updateProject() { return null; }
  async archiveProject() { return null; }
  async selectDirectory() { return null; }
  async createTask() { return null; }
  async listTasks() { return []; }
  async openTask() { return null; }
  async updateTask() { return null; }
  async changeTaskStatus() { return null; }
  async createConversation() { return null; }
  async listConversations() { return []; }

  async openConversation() {
    return null;
  }

  async updateConversation() { return null; }

  async appendMessage() {
    return null;
  }

  async recordWebExecution() {
    return null;
  }

  async listArtifacts() { return []; }
  async listActivity() { return []; }
}
