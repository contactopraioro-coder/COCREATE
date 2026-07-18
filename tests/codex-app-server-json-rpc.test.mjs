import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CodexAppServerJsonRpcClient } from "../infrastructure/codex-app-server/json-rpc-client.js";

function createHarness(options = {}) {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const writes = [];
  writable.on("data", (chunk) => writes.push(chunk.toString()));
  const client = new CodexAppServerJsonRpcClient({ readable, writable, ...options });
  return { client, readable, writes };
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("JSON-RPC client frames requests and resolves chunked JSONL responses", async () => {
  const { client, readable, writes } = createHarness();
  const pending = client.request("thread/read", { threadId: "thread-1" });
  await tick();
  const request = JSON.parse(writes.join("").trim());
  assert.equal(request.method, "thread/read");
  readable.write(`{"id":${request.id},"res`);
  readable.write(`ult":{"thread":{"id":"thread-1"}}}\n`);
  assert.equal((await pending).thread.id, "thread-1");
  client.dispose();
});

test("JSON-RPC client handles notifications and bidirectional server requests", async () => {
  const { client, readable, writes } = createHarness();
  const notifications = [];
  client.subscribe((notification) => notifications.push(notification));
  client.setServerRequestHandler(async (request) => ({ decision: request.params.allow ? "accept" : "decline" }));

  readable.write('{"method":"turn/started","params":{"threadId":"t"}}\n');
  readable.write('{"id":77,"method":"item/fileChange/requestApproval","params":{"allow":true}}\n');
  await tick();

  assert.equal(notifications[0].method, "turn/started");
  assert.deepEqual(JSON.parse(writes.join("").trim()), { id: 77, result: { decision: "accept" } });
  client.dispose();
});

test("JSON-RPC client reports malformed messages without inventing a response", async () => {
  const diagnostics = [];
  const unknown = [];
  const { client, readable } = createHarness({ onDiagnostic: (entry) => diagnostics.push(entry) });
  client.subscribeUnknown((entry) => unknown.push(entry));
  readable.write("not-json\n");
  await tick();
  assert.equal(diagnostics[0].type, "protocol.invalid-json");
  assert.equal(unknown[0].reason, "invalid-json");
  client.dispose();
});

test("JSON-RPC client rejects timed out and pending requests exactly once", async () => {
  const timeoutHarness = createHarness({ requestTimeoutMs: 10 });
  await assert.rejects(timeoutHarness.client.request("model/list", {}), (error) => error.code === "CODEX_APP_SERVER_TIMEOUT");
  timeoutHarness.client.dispose();

  const closedHarness = createHarness();
  const pending = closedHarness.client.request("thread/list", {});
  closedHarness.client.dispose("test");
  await assert.rejects(pending, (error) => error.code === "CODEX_APP_SERVER_CLOSED");
});
