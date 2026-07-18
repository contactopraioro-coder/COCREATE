import test from "node:test";
import assert from "node:assert/strict";
import { createCodexRuntimeAdapter } from "../infrastructure/codex-app-server/runtime-selector.js";

function fakeAdapter({ available = true, executeError = null, name }) {
  const calls = { execute: 0, cancel: 0, dispose: 0 };
  return {
    calls,
    getStatus: async () => ({ available, mode: name, error: available ? undefined : `${name} unavailable` }),
    execute: async (request) => {
      calls.execute += 1;
      if (executeError) throw executeError;
      return {
        executionId: request.executionId ?? `${name}-execution`,
        completed: Promise.resolve({ type: "execution.completed", executionId: `${name}-execution`, output: name }),
        cancel: async () => ({ ok: true })
      };
    },
    cancelExecution: async (request) => {
      calls.cancel += 1;
      return { ok: true, executionId: request.executionId, alreadyTerminated: false };
    },
    dispose: async () => { calls.dispose += 1; }
  };
}

test("auto mode falls back to exec only when App Server is unavailable before execution", async () => {
  const appServer = fakeAdapter({ available: false, name: "app-server" });
  const exec = fakeAdapter({ available: true, name: "exec" });
  const adapter = createCodexRuntimeAdapter({ appServerAdapter: appServer, execAdapter: exec, mode: "auto" });
  await adapter.execute({ prompt: "hola", origin: "test" }, () => undefined);
  assert.equal(appServer.calls.execute, 0);
  assert.equal(exec.calls.execute, 1);
  assert.equal((await adapter.getStatus()).fallback.active, true);
  await adapter.dispose();
});

test("auto mode never retries through exec after App Server execution has started", async () => {
  const appServer = fakeAdapter({ available: true, executeError: new Error("turn failed"), name: "app-server" });
  const exec = fakeAdapter({ available: true, name: "exec" });
  const adapter = createCodexRuntimeAdapter({ appServerAdapter: appServer, execAdapter: exec, mode: "auto" });
  await assert.rejects(adapter.execute({ prompt: "hola", origin: "test" }, () => undefined), /turn failed/);
  assert.equal(appServer.calls.execute, 1);
  assert.equal(exec.calls.execute, 0);
  await adapter.dispose();
});
