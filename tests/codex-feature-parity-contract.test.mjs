import assert from "node:assert/strict";
import test from "node:test";
import { CoCreateCodexClient } from "../infrastructure/codex-app-server/cocreate-codex-client.js";

function manager(request) {
  return {
    ensureReady: async () => undefined,
    getStatus: () => ({}),
    getClient: () => ({ request }),
    subscribe: () => () => undefined,
    setServerRequestHandler: () => undefined
  };
}

test("Codex client discovers models through the official model catalog", async () => {
  const calls = [];
  const client = new CoCreateCodexClient({ processManager: manager(async (method, params) => {
    calls.push({ method, params });
    return { data: [] };
  }) });
  await client.listModels();
  assert.deepEqual(calls, [{ method: "model/list", params: { cursor: null, limit: 100, includeHidden: false } }]);
});

test("Codex client applies model, effort and supported attachments to the next Turn", async () => {
  let captured;
  const client = new CoCreateCodexClient({ processManager: manager(async (method, params) => {
    captured = { method, params };
    return { turn: { id: "turn-1" } };
  }) });
  await client.startTurn("thread-1", "Revisa el contexto", {
    model: "upstream-model",
    effort: "high",
    userInputs: [
      { type: "localImage", path: "/private/image.png" },
      { type: "mention", name: "README.md", path: "/private/README.md" },
      { type: "skill", name: "review", path: "/private/SKILL.md" },
      { type: "unsupported", secret: "drop-me" }
    ],
    collaborationMode: {
      mode: "plan",
      settings: { model: "upstream-model", reasoning_effort: "high", developer_instructions: null }
    }
  });
  assert.equal(captured.method, "turn/start");
  assert.equal(captured.params.model, "upstream-model");
  assert.equal(captured.params.effort, "high");
  assert.deepEqual(captured.params.input.map((item) => item.type), ["text", "localImage", "mention", "skill"]);
  assert.equal(captured.params.collaborationMode.mode, "plan");
});
