import assert from "node:assert/strict";
import test from "node:test";
import { createUpstreamStabilityAdapter } from "../infrastructure/codex-app-server/upstream-stability-adapter.js";

function createManager(overrides = {}) {
  let notificationListener = () => undefined;
  let lifecycleListener = () => undefined;
  const calls = [];
  const responses = {
    "collaborationMode/list": {
      data: [
        { mode: "plan", name: "Plan", model: "gpt-5", reasoning_effort: "medium" },
        { mode: "default", name: "Default" },
        { mode: "unknown", name: "Ignore" }
      ]
    },
    "skills/list": {
      data: [{
        skills: [
          { name: "review", shortDescription: "Review code", scope: "repo", enabled: true, path: "/private/review/SKILL.md", prompt: "never expose" },
          { name: "review", shortDescription: "Duplicate", scope: "repo", enabled: true, path: "/duplicate" }
        ],
        errors: []
      }]
    },
    "plugin/list": {
      marketplaces: [{
        name: "Local",
        plugins: [{ id: "plugin-1", name: "Plugin", installed: true, enabled: true, localVersion: "1.0.0", keywords: ["files"] }]
      }],
      marketplaceLoadErrors: []
    },
    "mcpServerStatus/list": {
      data: [
        { name: "github", tools: { list_prs: {}, get_pr: {} }, authStatus: { status: "authenticated" }, secret: "drop" },
        { name: "github", tools: { duplicate: {} } },
        { name: "local", tools: {} }
      ],
      nextCursor: null
    }
  };
  const manager = {
    getStatus: () => overrides.status ?? ({ available: true, authenticated: true, processState: "ready", codexVersion: "0.134.0", compatibility: "compatible", restartCount: 0 }),
    ensureReady: async () => manager.getStatus(),
    getClient: () => ({
      request: async (method, params) => {
        calls.push({ method, params });
        if (overrides.failMethod === method) throw new Error(`method not found: ${method}`);
        return responses[method];
      }
    }),
    subscribe(listener) { notificationListener = listener; return () => { notificationListener = () => undefined; }; },
    subscribeLifecycle(listener) { lifecycleListener = listener; return () => { lifecycleListener = () => undefined; }; }
  };
  return {
    manager,
    calls,
    notify(value) { notificationListener(value); },
    lifecycle(value) { lifecycleListener(value); }
  };
}

test("Upstream adapter normalizes Plan, Skills, Plugins and MCP without private UI data", async () => {
  const fixture = createManager();
  const adapter = createUpstreamStabilityAdapter({ processManager: fixture.manager, cwd: "/workspace" });
  const plan = await adapter.listPlanModes();
  const skills = await adapter.listSkills();
  const plugins = await adapter.listPlugins();
  const mcp = await adapter.listMcpServers();

  assert.deepEqual(plan.data.map((entry) => entry.mode), ["plan", "default"]);
  assert.equal(skills.data.length, 1);
  assert.equal(skills.data[0].privatePath, "/private/review/SKILL.md");
  assert.equal("prompt" in skills.data[0], false);
  assert.equal(plugins.readOnly, true);
  assert.equal(plugins.data[0].id, "plugin-1");
  assert.equal(mcp.data.length, 2);
  assert.deepEqual(mcp.data[0].tools, ["get_pr", "list_prs"]);
  assert.equal("secret" in mcp.data[0], false);
  assert.deepEqual(fixture.calls.find((call) => call.method === "mcpServerStatus/list")?.params, {
    cursor: null,
    limit: 100,
    detail: "toolsAndAuthOnly"
  });
  adapter.dispose();
});

test("MCP status updates and runtime restart events refresh without duplicate servers", async () => {
  const fixture = createManager();
  const adapter = createUpstreamStabilityAdapter({ processManager: fixture.manager });
  const events = [];
  adapter.subscribe((event) => events.push(event));
  fixture.notify({ method: "mcpServer/startupStatus/updated", params: { name: "github", status: "failed", error: "connection lost" } });
  fixture.notify({ method: "skills/changed", params: {} });
  fixture.lifecycle({ state: "restarting" });

  const mcp = await adapter.listMcpServers();
  assert.equal(mcp.data.find((entry) => entry.name === "github")?.status, "failed");
  assert.match(mcp.data.find((entry) => entry.name === "github")?.error ?? "", /connection lost/);
  assert.deepEqual(events.map((event) => event.type), ["mcp.updated", "skills.updated", "runtime.updated"]);
  adapter.dispose();
});

test("An experimental method failure is scoped and the stable snapshot remains usable", async () => {
  const fixture = createManager({ failMethod: "skills/list" });
  const adapter = createUpstreamStabilityAdapter({ processManager: fixture.manager });
  await assert.rejects(adapter.listSkills(), /method not found/);
  const snapshot = await adapter.snapshot();
  assert.equal(snapshot.runtime.available, true);
  assert.equal(snapshot.descriptors.find((entry) => entry.id === "mcp")?.enabled, true);
  assert.match(snapshot.lastError ?? "", /method not found/);
  adapter.dispose();
});

test("Zero MCP servers and unavailable App Server produce bounded honest results", async () => {
  const empty = createManager();
  empty.manager.getClient = () => ({ request: async () => ({ data: [] }) });
  const emptyAdapter = createUpstreamStabilityAdapter({ processManager: empty.manager });
  assert.deepEqual((await emptyAdapter.listMcpServers()).data, []);
  emptyAdapter.dispose();

  const unavailable = createManager({
    status: { available: false, authenticated: false, processState: "failed", codexVersion: "0.134.0", compatibility: "compatible", restartCount: 2 }
  });
  unavailable.manager.ensureReady = async () => { throw new Error("App Server did not start"); };
  const unavailableAdapter = createUpstreamStabilityAdapter({ processManager: unavailable.manager });
  const snapshot = await unavailableAdapter.snapshot();
  assert.equal(snapshot.runtime.available, false);
  assert.match(snapshot.lastError, /App Server did not start/);
  await assert.rejects(unavailableAdapter.listPlanModes(), /Codex expone collaboration mode/);
  unavailableAdapter.dispose();
});
