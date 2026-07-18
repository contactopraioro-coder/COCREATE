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
import { CodexExecutionService } from "../src/app/services/codex-execution-service.js";
import { CodexStatusService } from "../src/app/services/codex-status-service.js";

class FakeCodexAdapter implements CodexAdapter {
  public lastRequest: StartCodexExecutionRequest | null = null;
  public lastCancelled: CancelCodexExecutionRequest | null = null;

  async getStatus(): Promise<CodexStatus> {
    return {
      available: true,
      binary: "fake-codex",
      version: "1.0.0-test",
      compatible: true,
      validatedVersion: "0.134.0",
      minimumSupportedVersion: "0.134.0",
      license: "Apache-2.0",
      source: "test",
      mode: "fake",
      updatedAt: new Date().toISOString()
    };
  }

  async execute(request: StartCodexExecutionRequest, observer?: CodexExecutionObserver): Promise<CodexExecutionHandle> {
    this.lastRequest = request;
    await observer?.({
      type: "execution.started",
      executionId: "exec-test",
      timestamp: new Date().toISOString(),
      stage: "starting",
      origin: request.origin,
      promptPreview: request.prompt
    });
    await observer?.({
      type: "execution.completed",
      executionId: "exec-test",
      timestamp: new Date().toISOString(),
      stage: "completed",
      output: "done",
      exitCode: 0
    });

    return {
      executionId: "exec-test",
      completed: Promise.resolve({
        type: "execution.completed",
        executionId: "exec-test",
        timestamp: new Date().toISOString(),
        stage: "completed",
        output: "done",
        exitCode: 0
      }),
      cancel: async () => ({
        ok: true,
        executionId: "exec-test",
        alreadyTerminated: false
      })
    };
  }

  async cancelExecution(request: CancelCodexExecutionRequest) {
    this.lastCancelled = request;
    return {
      ok: true,
      executionId: request.executionId,
      alreadyTerminated: false
    };
  }

  async dispose() {
    return;
  }
}

test("CodexExecutionService delegates prompt execution through the adapter", async () => {
  const adapter = new FakeCodexAdapter();
  const service = new CodexExecutionService(adapter);
  const events: string[] = [];

  const handle = await service.executePrompt(
    {
      prompt: "hola",
      origin: "test"
    },
    (event: { type: string }) => {
      events.push(event.type);
    }
  );

  const terminal = await handle.completed;

  assert.equal(adapter.lastRequest?.prompt, "hola");
  assert.deepEqual(events, ["execution.started", "execution.completed"]);
  assert.equal(terminal.type, "execution.completed");
});

test("CodexExecutionService forwards cancellation requests", async () => {
  const adapter = new FakeCodexAdapter();
  const service = new CodexExecutionService(adapter);

  await service.cancelExecution("exec-test", "user-requested");

  assert.deepEqual(adapter.lastCancelled, {
    executionId: "exec-test",
    reason: "user-requested"
  });
});

test("CodexStatusService resolves adapter status", async () => {
  const adapter = new FakeCodexAdapter();
  const service = new CodexStatusService(adapter);

  const status = await service.refreshStatus();

  assert.equal(status.available, true);
  assert.equal(status.binary, "fake-codex");
});
