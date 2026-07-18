import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiffPreview } from "../src/app/services/diff-preview-service.js";
import { LiveCodingSessionService } from "../src/app/services/live-coding-session-service.js";
import type { ApprovalRequest, ApprovalState } from "../src/app/services/approval-runtime-service.js";
import type { WorkspaceExperienceState } from "../src/app/services/workspace-experience-service.js";

const timestamp = "2026-07-17T12:00:00.000Z";

function approvalRequest(): ApprovalRequest {
  return {
    approvalId: "approval-file-1",
    category: "File change",
    action: "Aplicar cambios de archivos propuestos por Codex",
    risk: "Codex modificará archivos del Project activo.",
    reason: null,
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "file-1",
    requestedAt: timestamp,
    expiresAt: "2026-07-17T12:05:00.000Z"
  };
}

function approvalState(pending: ApprovalRequest | null = null): ApprovalState {
  return { pending, responding: false, result: null, error: null };
}

function workspaceState(options: { active?: boolean; includePatch?: boolean; patchApplied?: boolean } = {}): WorkspaceExperienceState {
  const active = options.active ?? true;
  return {
    version: 1,
    environment: "desktop",
    workspace: { id: "workspace-1", name: "Personal", status: "active", archived: false },
    project: { id: "project-1", name: "CoCreate", status: "active", archived: false },
    task: { id: "task-1", name: "Live Coding", status: "active", archived: false, activeExecutionId: "exec-1" },
    conversation: { id: "conversation-1", taskId: "task-1", title: "Implementar Live", threadState: "active" },
    projects: [],
    tasks: [],
    conversations: [],
    thread: { id: "thread-1", state: "active" },
    turn: { id: "turn-1", status: active ? "Running" : "Completed" },
    execution: null,
    upstreamExecution: {
      id: "exec-1",
      status: active ? "Running" : "Completed",
      active,
      startedAt: timestamp,
      completedAt: active ? null : "2026-07-17T12:01:00.000Z",
      durationMs: active ? null : 60_000,
      result: null
    },
    activeWork: active
      ? { id: "planning", label: "Planning", status: "Running", active: true }
      : { id: "completed", label: "Completed", status: "Completed", active: false },
    plan: { explanation: "", steps: [{ id: "one", text: "Revisar", status: "running" }], updatedAt: timestamp },
    command: null,
    tool: { label: "Leyendo archivos...", status: "Running", name: "read", updatedAt: timestamp },
    approval: null,
    usage: { provider: "codex", model: "gpt-5", tokens: null, durationMs: null, threadId: "thread-1", turnId: "turn-1" },
    artifacts: [
      {
        id: "diff-1",
        type: "diff",
        title: "Cambios propuestos",
        status: "active",
        version: 1,
        timestamp,
        executionId: "exec-1",
        files: ["src/app.ts"],
        additions: 1,
        deletions: 1,
        preview: "@@ -1,1 +1,1 @@\n-old\n+new",
        disposition: "proposed"
      },
      ...(options.includePatch ? [{
        id: "patch-1",
        type: "patch",
        title: "Patch aplicado",
        status: "active",
        version: 1,
        timestamp,
        executionId: "exec-1",
        files: ["src/app.ts"],
        additions: null,
        deletions: null,
        preview: options.patchApplied === false ? "@@ -1,1 +1,1 @@\n-old\n+new" : null,
        disposition: options.patchApplied === false ? "proposed" as const : "applied" as const
      }] : [])
    ],
    activities: [{ id: "activity-1", type: "capability.turn.started", summary: "Started coding", actor: "Codex", timestamp, count: 1 }],
    capabilities: [],
    runtime: { mode: "app-server", codexStatus: "Available", notice: null },
    restoration: { status: "fresh", message: "Workspace activo." },
    updatedAt: timestamp
  };
}

test("Live Session projects active Workspace context, duration, files, tools and cancellation", () => {
  const service = new LiveCodingSessionService();
  const state = workspaceState();
  service.start(state, timestamp);
  const snapshot = service.getSnapshot(state, approvalState(), Date.parse(timestamp) + 12_000);

  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.project?.name, "CoCreate");
  assert.equal(snapshot.task?.name, "Live Coding");
  assert.equal(snapshot.conversation?.title, "Implementar Live");
  assert.equal(snapshot.durationMs, 12_000);
  assert.equal(snapshot.executionId, "exec-1");
  assert.equal(snapshot.canCancel, true);
  assert.deepEqual(snapshot.modifiedFiles, ["src/app.ts"]);
  assert.equal(snapshot.tools[0].label, "Leyendo archivos...");
  assert.equal(snapshot.timeline.some((item) => item.label === "Analizando proyecto"), true);
});

test("Working Changes only become actionable for a real file-change approval and preserve the explicit decision", () => {
  const service = new LiveCodingSessionService();
  const state = workspaceState();
  const request = approvalRequest();
  service.start(state, timestamp);

  const pending = service.getSnapshot(state, approvalState(request), Date.parse(timestamp));
  assert.equal(pending.status, "waiting-approval");
  assert.equal(pending.workingChanges[0].status, "pending");
  assert.equal(pending.workingChanges[0].actionable, true);
  assert.equal(pending.workingChanges[0].reviewable, true);
  assert.equal(pending.workingChanges[0].approvalId, request.approvalId);

  service.recordDecision(request, "reject", true, "diff-1");
  const discarded = service.getSnapshot({ ...state, approval: null }, approvalState(), Date.parse(timestamp));
  assert.equal(discarded.workingChanges[0].status, "discarded");
  assert.equal(discarded.workingChanges[0].actionable, false);
});

test("A diff only becomes applied after upstream marks the patch as completed", () => {
  const service = new LiveCodingSessionService();
  const proposedState = workspaceState({ active: true, includePatch: true, patchApplied: false });
  service.start(proposedState, timestamp);
  const proposed = service.getSnapshot(proposedState, approvalState(), Date.parse(timestamp) + 30_000);
  assert.equal(proposed.workingChanges.every((change) => change.status !== "applied"), true);

  const state = workspaceState({ active: false, includePatch: true, patchApplied: true });
  service.start(state, timestamp);
  const snapshot = service.getSnapshot(state, approvalState(), Date.parse(timestamp) + 60_000);
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.progress, 100);
  assert.equal(snapshot.workingChanges[0].status, "applied");
  assert.equal(snapshot.canCancel, false);
});

test("A patch preview remains a reviewable Working Change when no turn diff exists", () => {
  const service = new LiveCodingSessionService();
  const state = workspaceState({ includePatch: true, patchApplied: false });
  state.artifacts = state.artifacts.filter((artifact) => artifact.type === "patch");
  service.start(state, timestamp);
  const snapshot = service.getSnapshot(state, approvalState(approvalRequest()), Date.parse(timestamp) + 10_000);
  assert.equal(snapshot.workingChanges.length, 1);
  assert.equal(snapshot.workingChanges[0].status, "pending");
  assert.equal(snapshot.workingChanges[0].reviewable, true);
  assert.match(snapshot.workingChanges[0].preview ?? "", /\+new/);
});

test("A file approval without upstream preview can be discarded but is not reviewable", () => {
  const service = new LiveCodingSessionService();
  const state = workspaceState();
  state.artifacts = [];
  service.start(state, timestamp);
  const snapshot = service.getSnapshot(state, approvalState(approvalRequest()), Date.parse(timestamp));
  assert.equal(snapshot.workingChanges[0].actionable, true);
  assert.equal(snapshot.workingChanges[0].reviewable, false);
  assert.equal(snapshot.workingChanges[0].artifactId, null);
});

test("Voice instructions are added to the Live timeline without storing transcript content", () => {
  const service = new LiveCodingSessionService();
  const state = workspaceState();
  service.start(state, timestamp);
  service.recordVoiceInstruction("2026-07-17T12:00:04.000Z");
  const snapshot = service.getSnapshot(state, approvalState(), Date.parse(timestamp) + 5_000);
  assert.equal(snapshot.timeline.some((item) => item.label === "Instrucción de voz añadida"), true);
  assert.equal(JSON.stringify(snapshot.timeline).includes("transcript"), false);
});

test("Unified diff preview exposes line kinds and Git-style line numbers", () => {
  const lines = parseUnifiedDiffPreview("@@ -4,2 +4,2 @@\n context\n-old\n+new");
  assert.equal(lines[0].kind, "hunk");
  assert.deepEqual(lines[1], { id: "line-1", kind: "context", oldLine: 4, newLine: 4, text: " context" });
  assert.deepEqual(lines[2], { id: "line-2", kind: "deletion", oldLine: 5, newLine: null, text: "-old" });
  assert.deepEqual(lines[3], { id: "line-3", kind: "addition", oldLine: null, newLine: 5, text: "+new" });
});
