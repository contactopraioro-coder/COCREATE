import test from "node:test";
import assert from "node:assert/strict";
import type {
  CancelCodexExecutionRequest,
  CodexAdapter,
  CodexExecutionHandle,
  CodexExecutionObserver,
  CodexStatus,
  StartCodexExecutionRequest
} from "../shared/codex-contracts.js";
import { CodexConversationService } from "../src/app/services/codex-conversation-service.js";
import { CodexExecutionService } from "../src/app/services/codex-execution-service.js";
import { UpstreamCapabilityExposureService } from "../src/app/services/upstream-capability-exposure-service.js";

const timestamp = "2026-07-16T17:00:00.000Z";

class ExposureAdapter implements CodexAdapter {
  async getStatus(): Promise<CodexStatus> {
    return {
      available: false,
      binary: "test",
      version: null,
      compatible: false,
      validatedVersion: "0.134.0",
      minimumSupportedVersion: "0.134.0",
      license: "Apache-2.0",
      source: "test",
      mode: "test",
      updatedAt: timestamp
    };
  }

  async execute(request: StartCodexExecutionRequest, observer: CodexExecutionObserver): Promise<CodexExecutionHandle> {
    const executionId = "exec-exposure";
    await observer({
      type: "execution.started",
      executionId,
      timestamp,
      stage: "starting",
      origin: request.origin,
      promptPreview: request.prompt
    });
    await observer({
      type: "codex.upstream",
      executionId,
      timestamp,
      stage: "running",
      event: {
        type: "turn.started",
        timestamp,
        executionId,
        codexThreadId: "thread-exposure",
        codexTurnId: "turn-exposure",
        codexRuntimeVersion: "0.134.0",
        codexProtocolVersion: "v2",
        data: { status: "inProgress" }
      }
    });
    await observer({
      type: "execution.output",
      executionId,
      timestamp,
      stage: "running",
      stream: "stdout",
      chunk: "respuesta"
    });
    const terminal = {
      type: "execution.completed" as const,
      executionId,
      timestamp,
      stage: "completed" as const,
      output: "respuesta",
      exitCode: 0
    };
    await observer(terminal);
    return {
      executionId,
      completed: Promise.resolve(terminal),
      cancel: async () => ({ ok: true, executionId, alreadyTerminated: false })
    };
  }

  async cancelExecution(request: CancelCodexExecutionRequest) {
    return { ok: true, executionId: request.executionId, alreadyTerminated: false };
  }

  async dispose() {}
}

test("Conversation Service feeds the exposure projection while preserving its public response", async () => {
  const exposure = new UpstreamCapabilityExposureService();
  const snapshots: string[] = [];
  const unsubscribe = exposure.subscribe((snapshot) => snapshots.push(snapshot.execution.status));
  const conversation = new CodexConversationService(
    new CodexExecutionService(new ExposureAdapter()),
    exposure
  );

  const result = await conversation.runPrompt({ prompt: "implementa", origin: "web-renderer" });
  const snapshot = exposure.getSnapshot();

  assert.deepEqual(result, { ok: true, output: "respuesta" });
  assert.equal(snapshot.execution.id, "exec-exposure");
  assert.equal(snapshot.execution.status, "Completed");
  assert.equal(snapshot.execution.active, false);
  assert.equal(snapshot.turn.id, "turn-exposure");
  assert.equal(snapshot.streaming.active, false);
  assert.equal(snapshots.includes("Running"), true);
  unsubscribe();
});
