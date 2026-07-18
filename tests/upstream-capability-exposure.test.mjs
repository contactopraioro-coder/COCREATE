import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_PRODUCT_EVENT_MAPPING,
  createCapabilityRegistry,
  createInitialCapabilityExposure,
  deriveActiveWorkState,
  mapUpstreamEventToProductEvent,
  reduceCapabilityExposure,
  summarizeCommand,
  summarizeUnifiedDiff
} from "../shared/upstream-capability-exposure.js";

const timestamp = "2026-07-16T16:00:00.000Z";

function upstream(type, data = {}) {
  return {
    type,
    timestamp,
    executionId: "exec-1",
    codexThreadId: "thread-1",
    codexTurnId: "turn-1",
    codexRuntimeVersion: "0.134.0",
    codexProtocolVersion: "v2",
    data
  };
}

function wrapped(type, data = {}) {
  return {
    type: "codex.upstream",
    executionId: "exec-1",
    timestamp,
    stage: "running",
    event: upstream(type, data)
  };
}

function appServerStatus(capabilities) {
  return {
    available: true,
    binary: "codex",
    version: "0.134.0",
    compatible: true,
    validatedVersion: "0.134.0",
    minimumSupportedVersion: "0.134.0",
    license: "Apache-2.0",
    source: "upstream",
    mode: "app-server",
    runtimeMode: "app-server",
    updatedAt: timestamp,
    appServer: {
      available: true,
      codexVersion: "0.134.0",
      protocolVersion: "v2",
      capabilities,
      mcp: { configuredServers: 5 },
      updatedAt: timestamp
    }
  };
}

test("Capability Registry derives enablement and MCP count from App Server status", () => {
  const registry = createCapabilityRegistry(appServerStatus({
    streaming: true,
    approvals: false,
    diffs: true,
    webSearch: true,
    mcp: true,
    plans: true,
    commands: true,
    usage: true
  }));

  assert.equal(registry.available, true);
  assert.equal(registry.enabledCount, 7);
  assert.equal(registry.mcpServersConnected, 5);
  assert.equal(registry.entries.find((entry) => entry.id === "approvals").enabled, false);
  assert.equal(JSON.stringify(registry).includes("apiKey"), false);

  const unavailable = createCapabilityRegistry({ ...appServerStatus({ streaming: true }), available: false });
  assert.equal(unavailable.entries.every((entry) => !entry.enabled), true);
});

test("central Event Mapping exposes product event kinds for inherited capabilities", () => {
  assert.equal(CODEX_PRODUCT_EVENT_MAPPING["turn.started"], "turn.updated");
  assert.equal(CODEX_PRODUCT_EVENT_MAPPING["plan.updated"], "plan.updated");
  assert.equal(CODEX_PRODUCT_EVENT_MAPPING["approval.requested"], "approval.updated");
  assert.equal(CODEX_PRODUCT_EVENT_MAPPING["diff.updated"], "diff.updated");
  assert.equal(CODEX_PRODUCT_EVENT_MAPPING["webSearch.completed"], "web.updated");
});

test("Thread, Turn and Streaming project upstream state without duplicate executions", () => {
  let state = createInitialCapabilityExposure(appServerStatus({ streaming: true }));
  state = reduceCapabilityExposure(state, {
    type: "execution.started",
    executionId: "exec-1",
    timestamp,
    stage: "starting",
    origin: "test",
    promptPreview: "build"
  });
  state = reduceCapabilityExposure(state, wrapped("thread.resumed", { model: "gpt-5", provider: "openai" }));
  state = reduceCapabilityExposure(state, wrapped("turn.started", { status: "inProgress" }));
  state = reduceCapabilityExposure(state, {
    type: "execution.output",
    executionId: "exec-1",
    timestamp,
    stage: "running",
    stream: "stdout",
    chunk: "hola"
  });

  assert.equal(state.execution.id, "exec-1");
  assert.equal(state.execution.status, "Running");
  assert.equal(state.thread.origin, "restored");
  assert.equal(state.turn.status, "Running");
  assert.equal(state.streaming.active, true);
  assert.equal(state.usage.model, "gpt-5");

  state = reduceCapabilityExposure(state, wrapped("turn.completed", { status: "completed", durationMs: 1200 }));
  state = reduceCapabilityExposure(state, {
    type: "execution.completed",
    executionId: "exec-1",
    timestamp: "2026-07-16T16:00:01.200Z",
    stage: "completed",
    output: "hola",
    exitCode: 0
  });
  assert.equal(state.execution.status, "Completed");
  assert.equal(state.execution.active, false);
  assert.equal(state.turn.status, "Completed");
  assert.equal(state.streaming.active, false);
  assert.equal(state.usage.durationMs, 1200);
});

test("Plan only presents steps supplied by App Server", () => {
  const product = mapUpstreamEventToProductEvent(upstream("plan.updated", {
    explanation: "Orden real",
    plan: [
      { id: "one", step: "Leer archivos", status: "completed" },
      { id: "two", step: "Aplicar patch", status: "inProgress" },
      { id: "missing", status: "pending" }
    ]
  }));

  assert.deepEqual(product.data.steps, [
    { id: "one", text: "Leer archivos", status: "completed" },
    { id: "two", text: "Aplicar patch", status: "running" }
  ]);
});

test("Commands and tools expose summaries without stdout", () => {
  assert.equal(summarizeCommand("npm test"), "Ejecutando pruebas...");
  const product = mapUpstreamEventToProductEvent(upstream("command.output", {
    itemId: "cmd-1",
    chunk: "SECRET OUTPUT"
  }));
  assert.equal(product.kind, "command.streaming");
  assert.equal("chunk" in product.data, false);
});

test("Diff projection keeps bounded metadata and redacts secret-like values", () => {
  const secret = "sk_123456789012345678901234567890123456";
  const summary = summarizeUnifiedDiff([
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "-old",
    "+new",
    `+Authorization: Bearer ${secret}`
  ].join("\n"));

  assert.deepEqual(summary.files, ["src/a.ts"]);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 1);
  assert.equal(summary.preview.includes(secret), false);
  assert.equal(summary.preview.includes("<redacted>"), true);
});

test("Approvals wait for an explicit decision and then resume the turn", () => {
  let state = createInitialCapabilityExposure(appServerStatus({ approvals: true }));
  state = reduceCapabilityExposure(state, wrapped("turn.started"));
  state = reduceCapabilityExposure(state, wrapped("approval.requested", {
    command: "npm install",
    reason: "Required dependency"
  }));
  assert.equal(state.approval.active, true);
  assert.equal(state.execution.status, "Waiting");
  assert.equal(state.turn.status, "Waiting");

  state = reduceCapabilityExposure(state, wrapped("approval.resolved", { decision: "accept" }));
  assert.equal(state.approval.active, false);
  assert.equal(state.execution.status, "Running");
  assert.equal(state.turn.status, "Running");
});

test("Web Search, usage and warnings always reach a terminal readable state", () => {
  let state = createInitialCapabilityExposure(appServerStatus({ webSearch: true, usage: true }));
  state = reduceCapabilityExposure(state, wrapped("webSearch.started", { query: "latest" }));
  assert.equal(state.webSearch.status, "Running");
  state = reduceCapabilityExposure(state, wrapped("webSearch.completed", { query: "latest" }));
  state = reduceCapabilityExposure(state, wrapped("usage.updated", { tokenUsage: { totalTokens: 42 } }));
  state = reduceCapabilityExposure(state, wrapped("runtime.warning", { message: "Sandbox restringido." }));

  assert.deepEqual(state.webSearch, { status: "Completed", label: "Verified from Web" });
  assert.deepEqual(state.usage.tokens, { totalTokens: 42 });
  assert.equal(state.warnings[0].message, "Sandbox restringido.");
});

test("Active Work derives planning, approval, testing and terminal states only from mapped upstream state", () => {
  let state = createInitialCapabilityExposure(appServerStatus({ approvals: true, plans: true, commands: true }));
  assert.equal(deriveActiveWorkState(state).id, "idle");

  state = reduceCapabilityExposure(state, {
    type: "execution.started",
    executionId: "exec-1",
    timestamp,
    stage: "starting",
    origin: "test",
    promptPreview: "build"
  });
  assert.equal(deriveActiveWorkState(state).id, "preparing");

  state = reduceCapabilityExposure(state, wrapped("turn.started"));
  state = reduceCapabilityExposure(state, wrapped("plan.updated", { plan: [{ step: "Inspect", status: "inProgress" }] }));
  assert.equal(deriveActiveWorkState(state).id, "planning");

  state = reduceCapabilityExposure(state, wrapped("command.started", { command: "npm test" }));
  assert.equal(deriveActiveWorkState(state).id, "testing");

  state = reduceCapabilityExposure(state, wrapped("approval.requested", { command: "npm install" }));
  assert.equal(deriveActiveWorkState(state).id, "waiting-approval");

  state = reduceCapabilityExposure(state, {
    type: "execution.failed",
    executionId: "exec-1",
    timestamp,
    stage: "failed",
    error: { code: "UNKNOWN", message: "failed", safeMessage: "failed", retriable: false }
  });
  assert.equal(deriveActiveWorkState(state).id, "failed");
});
