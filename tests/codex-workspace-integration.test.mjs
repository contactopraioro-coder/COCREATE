import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspaceStore } from "../electron/workspace-store.mjs";
import { createWorkspaceRuntime } from "../shared/workspace-runtime.js";

test("Workspace synchronizes the upstream turn with Activity, Execution and metadata-only Artifacts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cocreate-codex-workspace-"));
  const store = createWorkspaceStore({ filePath: path.join(directory, "workspace.json") });
  const runtime = createWorkspaceRuntime({ store });
  await runtime.initialize();
  const bootstrap = await runtime.getBootstrap();
  const chat = await runtime.createChat({ projectId: bootstrap.project.id, title: "Codex upstream" });
  const context = await runtime.getCodexExecutionContext();

  const mapping = {
    ...context,
    codexThreadId: "thread-upstream-1",
    codexRuntimeVersion: "0.134.0",
    codexProtocolVersion: "v2",
    mappedAt: "2026-07-16T12:00:00.000Z"
  };
  await runtime.associateCodexThread(mapping);
  await runtime.associateCodexThread(mapping);
  const mapped = await runtime.getCodexExecutionContext();
  assert.equal(mapped.conversationId, chat.conversation.id);
  assert.equal(mapped.codexThreadId, "thread-upstream-1");

  await runtime.recordExecutionEvent({
    type: "execution.started",
    executionId: "exec-upstream-1",
    timestamp: "2026-07-16T12:01:00.000Z",
    promptPreview: "edita",
    stage: "starting",
    origin: "test"
  }, { prompt: "edita" });
  await runtime.recordCodexUpstreamEvent({
    type: "turn.started",
    timestamp: "2026-07-16T12:01:00.500Z",
    executionId: "exec-upstream-1",
    codexThreadId: "thread-upstream-1",
    codexTurnId: "turn-1",
    codexRuntimeVersion: "0.134.0",
    codexProtocolVersion: "v2",
    data: { status: "inProgress" }
  });
  for (const [timestamp, diff] of [
    ["2026-07-16T12:01:01.000Z", "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+first"],
    ["2026-07-16T12:01:02.000Z", "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-first\n+second"]
  ]) {
    await runtime.recordCodexUpstreamEvent({
      type: "diff.updated",
      timestamp,
      executionId: "exec-upstream-1",
      codexThreadId: "thread-upstream-1",
      codexTurnId: "turn-1",
      codexRuntimeVersion: "0.134.0",
      codexProtocolVersion: "v2",
      data: { diff }
    });
  }
  await runtime.recordCodexUpstreamEvent({
    type: "fileChange.completed",
    timestamp: "2026-07-16T12:01:03.000Z",
    executionId: "exec-upstream-1",
    codexThreadId: "thread-upstream-1",
    codexTurnId: "turn-1",
    codexRuntimeVersion: "0.134.0",
    codexProtocolVersion: "v2",
    data: {
      changes: [
        { path: "src/a.ts", kind: "update" },
        { path: "src/generated.ts", kind: "add" }
      ]
    }
  });

  const activeBootstrap = await runtime.getBootstrap();
  assert.equal(activeBootstrap.runtime.codex.executionId, "exec-upstream-1");
  assert.equal(activeBootstrap.runtime.codex.threadId, "thread-upstream-1");
  assert.equal(activeBootstrap.runtime.codex.turnId, "turn-1");

  await runtime.recordCodexUpstreamEvent({
    type: "turn.completed",
    timestamp: "2026-07-16T12:01:04.000Z",
    executionId: "exec-upstream-1",
    codexThreadId: "thread-upstream-1",
    codexTurnId: "turn-1",
    codexRuntimeVersion: "0.134.0",
    codexProtocolVersion: "v2",
    data: { status: "completed", durationMs: 3500 }
  });
  await runtime.recordExecutionEvent({
    type: "execution.completed",
    executionId: "exec-upstream-1",
    timestamp: "2026-07-16T12:01:04.100Z",
    stage: "completed",
    output: "listo",
    exitCode: 0
  }, { prompt: "edita" });

  const artifacts = await runtime.listArtifacts({ taskId: chat.task.id });
  assert.equal(artifacts.filter((artifact) => artifact.type === "diff").length, 1);
  assert.equal(artifacts.find((artifact) => artifact.type === "diff").version, 2);
  assert.deepEqual(artifacts.find((artifact) => artifact.type === "diff").metadata.files, ["src/a.ts"]);
  assert.equal(artifacts.find((artifact) => artifact.type === "diff").metadata.additions, 1);
  assert.equal(artifacts.filter((artifact) => artifact.type === "patch").length, 1);
  assert.equal(artifacts.filter((artifact) => artifact.type === "generated-file").length, 1);
  assert.equal(artifacts.find((artifact) => artifact.type === "generated-file").contentRef, null);
  const state = await store.load();
  assert.equal(state.activities.filter((entry) => entry.type === "codex.thread.mapped").length, 1);
  assert.equal(state.activities.filter((entry) => entry.type === "capability.turn.started").length, 1);
  assert.equal(state.activities.filter((entry) => entry.type === "capability.diff.created").length, 2);
  assert.equal(state.activities.filter((entry) => entry.type === "capability.patch.applied").length, 1);
  const reference = state.executionReferences.find((entry) => entry.executionId === "exec-upstream-1");
  assert.equal(reference.metadata.codexTurnId, "turn-1");
  assert.equal(reference.metadata.lastUpstreamEvent, "turn.completed");
  assert.equal(state.executionReferences.filter((entry) => entry.executionId === "exec-upstream-1").length, 1);
  const completedBootstrap = await runtime.getBootstrap();
  assert.equal(completedBootstrap.runtime.codex.executionId, null);
  assert.equal(completedBootstrap.runtime.codex.turnId, "turn-1");
});
