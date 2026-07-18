import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import channels from "../shared/upstream-capabilities-ipc-channels.cjs";
import { registerUpstreamCapabilitiesIpc } from "../electron/upstream-capabilities-ipc.mjs";

function createHarness(overrides = {}) {
  const handlers = new Map();
  const removed = new Set();
  const sent = [];
  let subscription = () => undefined;
  let disposed = false;
  const adapter = {
    snapshot: async () => ({ compatible: true }),
    listPlanModes: async () => ({ stability: "experimental", data: [{ id: "plan", name: "Plan", mode: "plan" }] }),
    listSkills: async () => ({
      stability: "experimental",
      data: [{ name: "review", description: "Review", scope: "repo", enabled: true, source: "codex-skill", privatePath: "/private/SKILL.md" }],
      errors: []
    }),
    listPlugins: async () => ({ stability: "experimental", readOnly: true, data: [], errors: [] }),
    listMcpServers: async () => ({ stability: "stable", data: [] }),
    subscribe(listener) { subscription = listener; return () => { subscription = () => undefined; }; },
    dispose() { disposed = true; },
    ...overrides
  };
  const browserWindow = {
    fromWebContents(sender) { return { id: sender.ownerId }; },
    getAllWindows() { return [{ isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } }]; }
  };
  const runtime = registerUpstreamCapabilitiesIpc({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { removed.add(channel); }
    },
    browserWindow,
    adapter
  });
  return { handlers, removed, sent, adapter, runtime, emit: (event) => subscription(event), get disposed() { return disposed; } };
}

test("Upstream IPC keeps skill paths opaque, owner-scoped and one-use", async () => {
  const harness = createHarness();
  const sender = Object.assign(new EventEmitter(), { ownerId: 7 });
  const result = await harness.handlers.get(channels.extensions)({ sender });
  assert.equal(result.ok, true);
  assert.equal(result.skills.data.length, 1);
  assert.equal("privatePath" in result.skills.data[0], false);
  assert.equal("path" in result.skills.data[0], false);
  assert.equal(typeof result.skills.data[0].token, "string");

  assert.deepEqual(harness.runtime.resolveSkillInputs([result.skills.data[0].token], 99), []);
  assert.deepEqual(harness.runtime.resolveSkillInputs([result.skills.data[0].token], 7), [{
    type: "skill",
    name: "review",
    path: "/private/SKILL.md"
  }]);
  assert.deepEqual(harness.runtime.resolveSkillInputs([result.skills.data[0].token], 7), []);
  harness.runtime.dispose();
  assert.equal(harness.disposed, true);
  assert.deepEqual(harness.removed, new Set([channels.snapshot, channels.plans, channels.extensions, channels.refresh]));
});

test("Upstream IPC contains an optional capability failure and broadcasts refresh events", async () => {
  const harness = createHarness({
    listPlugins: async () => { throw new Error("plugin method removed"); }
  });
  const sender = Object.assign(new EventEmitter(), { ownerId: 3 });
  const result = await harness.handlers.get(channels.extensions)({ sender });
  assert.equal(result.ok, true);
  assert.equal(result.skills.data.length, 1);
  assert.deepEqual(result.plugins.data, []);
  assert.match(result.plugins.errors[0].error, /plugin method removed/);

  harness.emit({ type: "runtime.updated", state: "restarting" });
  await harness.handlers.get(channels.refresh)();
  assert.deepEqual(harness.sent.map((entry) => entry[0]), [channels.changed, channels.changed]);
  harness.runtime.dispose();
});
