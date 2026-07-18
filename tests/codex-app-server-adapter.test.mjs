import test from "node:test";
import assert from "node:assert/strict";
import { createCodexAppServerAdapter } from "../infrastructure/codex-app-server/app-server-adapter.js";

function createHarness(options = {}) {
  let notificationListener = () => undefined;
  let lifecycleListener = () => undefined;
  let serverRequestHandler = null;
  const calls = { create: [], resume: [], turns: [], interrupts: [] };
  const status = {
    available: true,
    binaryPath: "codex",
    codexVersion: "0.134.0",
    validatedVersion: "0.134.0",
    protocolVersion: "v2",
    compatibility: "compatible",
    processState: "ready",
    initialized: true,
    authenticated: true,
    authMode: "chatgpt",
    capabilities: {},
    webSearch: { supported: true, mode: "live" },
    mcp: { supported: true, configuredServers: 1 },
    activeThreads: 0,
    activeTurns: 0,
    restartCount: 0,
    lastError: null,
    updatedAt: new Date().toISOString()
  };
  const processManager = {
    ensureReady: async () => status,
    getStatus: () => status,
    subscribeLifecycle: (listener) => {
      lifecycleListener = listener;
      return () => { lifecycleListener = () => undefined; };
    },
    setActivityCounts: () => undefined,
    stop: async () => undefined
  };
  const client = {
    getStatus: async () => status,
    createThread: async (input) => {
      calls.create.push(input);
      return {
        thread: { id: "thread-new", modelProvider: "openai" },
        model: "gpt-5",
        modelProvider: "openai"
      };
    },
    resumeThread: async (id, input) => {
      calls.resume.push({ id, input });
      return {
        thread: { id, modelProvider: "openai" },
        model: "gpt-5",
        modelProvider: "openai"
      };
    },
    startTurn: async (threadId, prompt, input) => {
      calls.turns.push({ threadId, prompt, input });
      return { turn: { id: "turn-1", status: "inProgress" } };
    },
    interruptTurn: async (threadId, turnId) => {
      calls.interrupts.push({ threadId, turnId });
      return {};
    },
    subscribe: (listener) => {
      notificationListener = listener;
      return () => { notificationListener = () => undefined; };
    },
    setServerRequestHandler: (handler) => { serverRequestHandler = handler; }
  };
  const mappings = [];
  const adapter = createCodexAppServerAdapter({
    processManager,
    client,
    persistThreadMapping: async (mapping) => mappings.push(mapping),
    requestApproval: options.requestApproval ?? (async () => false)
  });
  return {
    adapter,
    calls,
    mappings,
    notify(method, params) { notificationListener({ method, params }); },
    failRuntime() {
      lifecycleListener({
        type: "runtime.failed",
        error: Object.assign(new Error("process exited"), {
          name: "CodexUpstreamError",
          code: "CODEX_APP_SERVER_CLOSED",
          safeMessage: "La conexión con Codex App Server se cerró.",
          retriable: true
        })
      });
    },
    requestFromServer(request) { return serverRequestHandler(request); }
  };
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("App Server adapter resumes the mapped thread and streams one terminal response", async () => {
  const harness = createHarness();
  const events = [];
  const handle = await harness.adapter.execute({
    prompt: "continua",
    origin: "test",
    metadata: { workspaceContext: { conversationId: "conv-1", codexThreadId: "thread-existing", rootPath: "/tmp" } }
  }, (event) => events.push(event));

  assert.equal(harness.calls.resume[0].id, "thread-existing");
  assert.equal(harness.calls.create.length, 0);
  assert.equal(harness.mappings[0].conversationId, "conv-1");
  harness.notify("item/agentMessage/delta", { threadId: "thread-existing", turnId: "turn-1", delta: "hola" });
  harness.notify("turn/completed", {
    threadId: "thread-existing",
    turn: { id: "turn-1", status: "completed", items: [] }
  });
  const terminal = await handle.completed;
  assert.equal(terminal.type, "execution.completed");
  assert.equal(terminal.output, "hola");
  assert.equal(events.filter((event) => event.type === "execution.completed").length, 1);
  const threadEvent = events.find(
    (event) => event.type === "codex.upstream" && event.event.type === "thread.resumed"
  );
  assert.equal(threadEvent.event.data.model, "gpt-5");
  assert.equal(threadEvent.event.data.provider, "openai");
  assert.equal(
    events.some((event) => event.type === "codex.upstream" && event.event.type === "turn.completed"),
    true
  );
  await harness.adapter.dispose();
});

test("App Server adapter maps diffs, tools and approval requests into CoCreate events", async () => {
  const harness = createHarness({ requestApproval: async () => true });
  const events = [];
  const handle = await harness.adapter.execute({ prompt: "edita", origin: "test" }, (event) => events.push(event));
  harness.notify("turn/diff/updated", {
    threadId: "thread-new",
    turnId: "turn-1",
    diff: "+Authorization: Bearer secret_token_123456789012345678901234567890"
  });
  harness.notify("item/commandExecution/outputDelta", {
    threadId: "thread-new",
    turnId: "turn-1",
    itemId: "cmd-1",
    delta: "private stdout"
  });
  harness.notify("item/completed", {
    threadId: "thread-new",
    turnId: "turn-1",
    item: { type: "webSearch", id: "web-1", query: "latest", action: null }
  });
  const approval = await harness.requestFromServer({
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread-new", turnId: "turn-1", itemId: "cmd-1", command: "npm test" }
  });
  assert.deepEqual(approval, { decision: "accept" });
  harness.notify("turn/completed", {
    threadId: "thread-new",
    turn: { id: "turn-1", status: "completed", items: [{ type: "agentMessage", text: "listo" }] }
  });
  await handle.completed;
  await tick();
  const upstreamTypes = events.filter((event) => event.type === "codex.upstream").map((event) => event.event.type);
  assert.equal(upstreamTypes.includes("diff.updated"), true);
  assert.equal(upstreamTypes.includes("webSearch.completed"), true);
  assert.equal(upstreamTypes.includes("approval.requested"), true);
  assert.equal(upstreamTypes.includes("approval.resolved"), true);
  assert.equal(upstreamTypes.includes("turn.completed"), true);
  const diffEvent = events.find((event) => event.type === "codex.upstream" && event.event.type === "diff.updated");
  const outputEvent = events.find((event) => event.type === "codex.upstream" && event.event.type === "command.output");
  const approvalEvent = events.find((event) => event.type === "codex.upstream" && event.event.type === "approval.requested");
  assert.equal(diffEvent.event.data.diff.includes("secret_token"), false);
  assert.deepEqual(outputEvent.event.data, { itemId: "cmd-1" });
  assert.equal(approvalEvent.event.data.command, "npm test");
  await harness.adapter.dispose();
});

test("Live execution is read-only until the user grants project-scoped Working Changes", async () => {
  const approvals = [];
  const harness = createHarness({
    requestApproval: async (request) => {
      approvals.push(request);
      return true;
    }
  });
  const events = [];
  const handle = await harness.adapter.execute({
    prompt: "propón un cambio",
    origin: "test",
    metadata: {
      interactionMode: "live",
      workspaceContext: { conversationId: "conv-live", rootPath: "/tmp/project-live" }
    }
  }, (event) => events.push(event));

  assert.equal(harness.calls.create[0].sandbox, "read-only");
  assert.equal(harness.calls.create[0].approvalPolicy.granular.request_permissions, true);
  assert.equal(harness.calls.turns[0].input.approvalPolicy.granular.sandbox_approval, true);
  assert.equal(harness.calls.turns[0].input.clientMetadata.cocreate_interaction_mode, "live");

  const approved = await harness.requestFromServer({
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-new",
      turnId: "turn-1",
      itemId: "change-1",
      cwd: "/tmp/project-live",
      permissions: {
        fileSystem: {
          entries: [{ access: "write", path: { type: "special", value: { kind: "project_roots" } } }]
        },
        network: { enabled: true }
      }
    }
  });
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].kind, "file-change");
  assert.equal(approved.permissions.fileSystem.entries[0].path.value.kind, "project_roots");
  assert.equal(approved.permissions.network.enabled, false);
  assert.equal(approved.scope, "turn");

  const rejected = await harness.requestFromServer({
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-new",
      turnId: "turn-1",
      itemId: "change-outside",
      cwd: "/tmp/project-live",
      permissions: {
        fileSystem: { entries: [{ access: "write", path: { type: "path", path: "/etc" } }] }
      }
    }
  });
  assert.deepEqual(rejected.permissions, {});
  assert.equal(approvals.length, 1);

  harness.notify("turn/completed", {
    threadId: "thread-new",
    turn: { id: "turn-1", status: "completed", items: [] }
  });
  await handle.completed;
  assert.equal(events.some((event) => event.type === "codex.upstream" && event.event.type === "approval.resolved"), true);
  await harness.adapter.dispose();
});

test("Proposal execution writes only inside its isolated workspace and never replaces the Project thread mapping", async () => {
  const harness = createHarness();
  const handle = await harness.adapter.execute({
    prompt: "implementa la variante",
    origin: "test",
    cwd: "/tmp/cocreate-proposals/proposal-1/project",
    metadata: {
      interactionMode: "proposal",
      workspaceContext: {
        conversationId: "conv-current",
        rootPath: "/tmp/cocreate-proposals/proposal-1/project",
        codexThreadId: null,
        proposalWorkspace: true,
        proposalWorkspaceId: "proposal-1"
      }
    }
  }, () => undefined);

  assert.equal(harness.calls.create[0].cwd, "/tmp/cocreate-proposals/proposal-1/project");
  assert.deepEqual(harness.calls.create[0].runtimeWorkspaceRoots, ["/tmp/cocreate-proposals/proposal-1/project"]);
  assert.equal(harness.calls.create[0].sandbox, "workspace-write");
  assert.equal(harness.calls.turns[0].input.clientMetadata.cocreate_interaction_mode, "proposal");
  assert.equal(harness.mappings.length, 0);

  harness.notify("turn/completed", {
    threadId: "thread-new",
    turn: { id: "turn-1", status: "completed", items: [] }
  });
  await handle.completed;
  await harness.adapter.dispose();
});

test("App Server adapter interrupts cancellation without starting an exec fallback", async () => {
  const harness = createHarness();
  const handle = await harness.adapter.execute({ prompt: "larga", origin: "test" }, () => undefined);
  const result = await handle.cancel("user-requested");
  assert.equal(result.alreadyTerminated, false);
  assert.deepEqual(harness.calls.interrupts, [{ threadId: "thread-new", turnId: "turn-1" }]);
  harness.notify("turn/completed", {
    threadId: "thread-new",
    turn: { id: "turn-1", status: "interrupted", items: [] }
  });
  assert.equal((await handle.completed).type, "execution.cancelled");
  await harness.adapter.dispose();
});

test("App Server adapter resolves active executions when the persistent process exits", async () => {
  const harness = createHarness();
  const handle = await harness.adapter.execute({ prompt: "trabaja", origin: "test" }, () => undefined);
  harness.failRuntime();
  const terminal = await handle.completed;
  assert.equal(terminal.type, "execution.failed");
  assert.equal(terminal.error.code, "PROCESS_EXITED");
  await harness.adapter.dispose();
});
