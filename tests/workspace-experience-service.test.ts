import test from "node:test";
import assert from "node:assert/strict";
import type { CodexStatus } from "../shared/codex-contracts.js";
import { ApprovalRuntimeService, type ApprovalRequest } from "../src/app/services/approval-runtime-service.js";
import { UpstreamCapabilityExposureService } from "../src/app/services/upstream-capability-exposure-service.js";
import { WorkspaceExperienceService, deriveRuntimeNotice } from "../src/app/services/workspace-experience-service.js";
import type { ApprovalGateway } from "../src/infrastructure/approval/approval-gateway.js";

const timestamp = "2026-07-16T20:00:00.000Z";

function appServerStatus(): CodexStatus {
  return {
    available: true,
    binary: "codex",
    version: "0.134.0",
    compatible: true,
    validatedVersion: "0.134.0",
    minimumSupportedVersion: "0.134.0",
    license: "Apache-2.0",
    source: "test",
    mode: "app-server",
    runtimeMode: "app-server",
    updatedAt: timestamp,
    appServer: {
      available: true,
      binaryFound: true,
      binaryPath: "/usr/local/bin/codex",
      codexVersion: "0.134.0",
      validatedVersion: "0.134.0",
      protocolVersion: "v2",
      compatibility: "compatible",
      processState: "ready",
      initialized: true,
      authenticated: true,
      authMode: "chatgpt",
      restartCount: 0,
      lastError: null,
      capabilities: {
        threads: true,
        turns: true,
        streaming: true,
        plans: true,
        commands: true,
        tools: true,
        approvals: true,
        fileChanges: true,
        diffs: true,
        webSearch: true,
        mcp: true,
        usage: true,
        reasoningSummaries: true,
        cancellation: true,
        threadResume: true,
        compaction: true
      },
      webSearch: { supported: true, mode: "live" },
      mcp: { supported: true, configuredServers: 2 },
      activeThreads: 0,
      activeTurns: 0,
      updatedAt: timestamp
    }
  };
}

function createWorkspaceFake(taskMetadata: Record<string, unknown> = {}) {
  let taskCreates = 0;
  let conversationCreates = 0;
  const bootstrap = {
    workspace: { id: "workspace-1", name: "Personal Workspace", status: "active" },
    project: { id: "project-1", name: "CoCreate", status: "active", rootPath: "/Users/private/CoCreate" },
    task: { id: "task-1", projectId: "project-1", title: "Workspace Experience", status: "active", metadata: taskMetadata },
    conversation: { id: "conversation-1", taskId: "task-1", title: "Main" },
    session: { id: "session-1", status: "restored" },
    runtime: { activeExecution: null, codex: { status: "Idle", threadId: null } },
    conversations: [],
    activities: []
  };
  return {
    get taskCreates() { return taskCreates; },
    get conversationCreates() { return conversationCreates; },
    async getBootstrap() { return bootstrap; },
    async listProjects() { return [bootstrap.project, { id: "project-old", name: "Archived", status: "archived", rootPath: null }]; },
    async listTasks() { return [bootstrap.task]; },
    async listConversations() { return [{ id: "conversation-1", taskId: "task-1", title: "Main" }]; },
    async listArtifacts() {
      return [{
        id: "artifact-1",
        taskId: "task-1",
        executionId: "exec-1",
        type: "diff",
        title: "Cambios propuestos",
        status: "active",
        version: 2,
        updatedAt: timestamp,
        metadata: {
          files: ["/Users/private/CoCreate/src/app.ts"],
          additions: 4,
          deletions: 1,
          diffPreview: "+Authorization: Bearer secret_token_123456789012345678901234567890"
        }
      }];
    },
    async listActivity() {
      return [
        { id: "a1", type: "capability.command.completed", summary: "Executed tests", timestamp, actor: { displayName: "Codex" } },
        { id: "a2", type: "capability.command.completed", summary: "Executed tests", timestamp, actor: { displayName: "Codex" } }
      ];
    },
    async createTaskWithConversation() {
      taskCreates += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      conversationCreates += 1;
      return {
        task: { id: "task-created", status: "active" },
        conversation: { id: "conversation-created", taskId: "task-created" }
      };
    },
    async createProject() { return null; },
    async openProject() { return null; },
    async updateProject() { return null; },
    async archiveProject() { return null; },
    async selectProjectDirectory() { return null; },
    async openTask() { return null; },
    async updateTask() { return null; },
    async openConversation() { return null; },
    async updateConversation() { return null; }
  };
}

test("Workspace Experience projects context, bounded Artifacts, collapsed Activity and honest Web capabilities", async () => {
  const workspace = createWorkspaceFake();
  const exposure = new UpstreamCapabilityExposureService();
  const status = appServerStatus();
  exposure.initialize(status);
  const service = new WorkspaceExperienceService(workspace as any, exposure, "web");
  service.setCodexStatus(status);
  const state = await service.refresh();

  assert.equal(state.workspace?.name, "Personal Workspace");
  assert.equal(state.project?.rootPathLabel, "private/CoCreate");
  assert.equal(state.task?.name, "Workspace Experience");
  assert.equal(state.conversation?.title, "Main");
  assert.equal(state.thread.state, "unavailable");
  assert.equal(state.artifacts[0].files[0], "src/app.ts");
  assert.equal(state.artifacts[0].preview?.includes("secret_token"), false);
  assert.equal(state.activities.length, 1);
  assert.equal(state.activities[0].count, 2);
  assert.equal(state.capabilities.every((entry) => entry.availability === "Desktop only"), true);
  assert.equal(state.runtime.notice?.code, "desktop-only");
  service.dispose();
});

test("Workspace Experience prevents duplicate empty Tasks during repeated create actions", async () => {
  const workspace = createWorkspaceFake();
  const exposure = new UpstreamCapabilityExposureService();
  const service = new WorkspaceExperienceService(workspace as any, exposure, "desktop");
  await Promise.all([
    service.createTaskWithConversation({ projectId: "project-1", title: "Atomic Task" }),
    service.createTaskWithConversation({ projectId: "project-1", title: "Atomic Task" })
  ]);
  assert.equal(workspace.taskCreates, 1);
  assert.equal(workspace.conversationCreates, 1);
  service.dispose();
});

test("Workspace Experience keeps upstream state scoped to the selected Task execution", async () => {
  const exposure = new UpstreamCapabilityExposureService();
  const status = appServerStatus();
  exposure.initialize(status);
  const event = (executionId: string, type: string, data: Record<string, unknown> = {}) => ({
    type: "codex.upstream" as const,
    executionId: executionId as any,
    timestamp,
    stage: "running" as const,
    event: {
      type,
      executionId,
      timestamp,
      codexThreadId: `thread-${executionId}`,
      codexTurnId: `turn-${executionId}`,
      codexRuntimeVersion: "0.134.0",
      codexProtocolVersion: "v2",
      data
    }
  });
  exposure.consume(event("exec-a", "turn.started", { status: "inProgress" }) as any);
  exposure.consume(event("exec-a", "plan.updated", {
    plan: [{ id: "a", text: "Plan de Task A", status: "inProgress" }]
  }) as any);
  exposure.consume(event("exec-b", "turn.started", { status: "inProgress" }) as any);
  exposure.consume(event("exec-b", "plan.updated", {
    plan: [{ id: "b", text: "Plan de Task B", status: "inProgress" }]
  }) as any);

  const workspace = createWorkspaceFake({ activeExecutionId: "exec-a", lastExecutionId: "exec-a" });
  const service = new WorkspaceExperienceService(workspace as any, exposure, "desktop");
  service.setCodexStatus(status);
  const state = await service.refresh();
  assert.equal(state.plan?.steps[0]?.text, "Plan de Task A");
  assert.equal(state.turn.id, "turn-exec-a");
  assert.equal(state.activeWork.id, "planning");
  service.dispose();
});

test("Runtime notices distinguish Web, authentication, missing binary and fallback exec", () => {
  const exposure = new UpstreamCapabilityExposureService().getSnapshot();
  assert.equal(deriveRuntimeNotice(appServerStatus(), "web", exposure)?.code, "desktop-only");
  assert.equal(deriveRuntimeNotice({ ...appServerStatus(), available: false, error: "authentication required" }, "desktop", exposure)?.code, "authentication-required");
  assert.equal(deriveRuntimeNotice({ ...appServerStatus(), available: false, error: "binary not found" }, "desktop", exposure)?.code, "binary-missing");
  assert.equal(deriveRuntimeNotice({ ...appServerStatus(), runtimeMode: "exec", fallback: { active: true, reason: "degraded", selectedAt: timestamp } }, "desktop", exposure)?.code, "fallback-exec");
});

class FakeApprovalGateway implements ApprovalGateway {
  listener: ((request: ApprovalRequest) => void) | null = null;
  responses: Array<{ approvalId: string; decision: string }> = [];
  isAvailable() { return true; }
  subscribe(listener: (request: ApprovalRequest) => void) { this.listener = listener; return () => { this.listener = null; }; }
  async respond(approvalId: string, decision: "approve" | "reject") {
    this.responses.push({ approvalId, decision });
    return { ok: true };
  }
  emit(request: ApprovalRequest) { this.listener?.(request); }
}

function approvalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: "approval-1",
    category: "Command",
    action: "npm test",
    risk: "Ejecutará pruebas.",
    reason: null,
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides
  };
}

test("Approval Runtime requires one explicit response and rejects expired requests locally", async () => {
  const gateway = new FakeApprovalGateway();
  const service = new ApprovalRuntimeService(gateway);
  service.initialize();
  gateway.emit(approvalRequest());
  assert.equal(await service.respond("approve"), true);
  assert.equal(await service.respond("reject"), false);
  assert.deepEqual(gateway.responses, [{ approvalId: "approval-1", decision: "approve" }]);

  gateway.emit(approvalRequest({ approvalId: "approval-expired", expiresAt: new Date(Date.now() - 1_000).toISOString() }));
  assert.equal(await service.respond("approve"), false);
  assert.equal(service.getSnapshot().result, "expired");
  assert.equal(gateway.responses.length, 1);

  gateway.emit(approvalRequest({ approvalId: "approval-timeout", expiresAt: new Date(Date.now() + 15).toISOString() }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(service.getSnapshot().pending, null);
  assert.equal(service.getSnapshot().result, "expired");
  assert.equal(gateway.responses.length, 1);
  service.dispose();
});
