import { createCodexUpstreamError } from "../../shared/codex-upstream-contracts.js";

function assertThread(response) {
  if (!response?.thread?.id) {
    throw createCodexUpstreamError(
      "CODEX_APP_SERVER_PROTOCOL_ERROR",
      "Codex App Server did not return a thread identifier."
    );
  }
  return response;
}

export class CoCreateCodexClient {
  constructor(options) {
    if (!options?.processManager) {
      throw new TypeError("CoCreateCodexClient requires a process manager.");
    }
    this.processManager = options.processManager;
  }

  async getStatus() {
    await this.processManager.ensureReady();
    return this.processManager.getStatus();
  }

  async createThread(input = {}) {
    await this.processManager.ensureReady();
    return assertThread(await this.processManager.getClient().request("thread/start", {
      cwd: input.cwd ?? null,
      runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
      approvalPolicy: input.approvalPolicy ?? "on-request",
      approvalsReviewer: "user",
      sandbox: input.sandbox ?? "workspace-write",
      config: input.config ?? null,
      ephemeral: false,
      threadSource: "user"
    }));
  }

  async resumeThread(threadId, input = {}) {
    if (!threadId) {
      throw createCodexUpstreamError("CODEX_THREAD_NOT_FOUND", "Missing Codex thread identifier.");
    }
    await this.processManager.ensureReady();
    return assertThread(await this.processManager.getClient().request("thread/resume", {
      threadId,
      cwd: input.cwd ?? null,
      runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
      approvalPolicy: input.approvalPolicy ?? "on-request",
      approvalsReviewer: "user",
      sandbox: input.sandbox ?? "workspace-write",
      config: input.config ?? null,
      excludeTurns: true
    }));
  }

  async readThread(threadId, includeTurns = true) {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("thread/read", { threadId, includeTurns });
  }

  async listThreads(input = {}) {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("thread/list", {
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
      archived: input.archived ?? false
    });
  }

  async listTurns(threadId, input = {}) {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("thread/turns/list", {
      threadId,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50
    });
  }

  async startTurn(threadId, prompt, input = {}) {
    await this.processManager.ensureReady();
    const additionalInputs = Array.isArray(input.userInputs)
      ? input.userInputs.filter((item) => item && ["image", "localImage", "mention", "skill"].includes(item.type))
      : [];
    const response = await this.processManager.getClient().request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }, ...additionalInputs],
      cwd: input.cwd ?? null,
      runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
      approvalPolicy: input.approvalPolicy ?? "on-request",
      approvalsReviewer: "user",
      responsesapiClientMetadata: input.clientMetadata ?? null,
      model: input.model ?? null,
      effort: input.effort ?? null,
      collaborationMode: input.collaborationMode ?? null
    });
    if (!response?.turn?.id) {
      throw createCodexUpstreamError(
        "CODEX_APP_SERVER_PROTOCOL_ERROR",
        "Codex App Server did not return a turn identifier."
      );
    }
    return response;
  }

  async interruptTurn(threadId, turnId) {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("turn/interrupt", { threadId, turnId });
  }

  async getAccount() {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("account/read", { refreshToken: false });
  }

  async listMcpServers() {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("mcpServerStatus/list", {});
  }

  async listModels(input = {}) {
    await this.processManager.ensureReady();
    return this.processManager.getClient().request("model/list", {
      cursor: input.cursor ?? null,
      limit: input.limit ?? 100,
      includeHidden: false
    });
  }

  subscribe(listener) {
    return this.processManager.subscribe(listener);
  }

  setServerRequestHandler(handler) {
    this.processManager.setServerRequestHandler(handler);
  }
}
