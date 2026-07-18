import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createApprovalBroker } from "../electron/approval-broker.mjs";

function createHarness(timeoutMs = 100) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  };
  const webContents = new EventEmitter();
  webContents.id = 77;
  webContents.sent = [];
  webContents.send = (channel, payload) => webContents.sent.push({ channel, payload });
  const window = { webContents, isDestroyed: () => false };
  const BrowserWindow = {
    getFocusedWindow: () => window,
    getAllWindows: () => [window]
  };
  const broker = createApprovalBroker({ ipcMain, BrowserWindow, timeoutMs });
  return { broker, handlers, webContents };
}

test("Approval broker accepts exactly one response from the owning renderer", async () => {
  const { broker, handlers, webContents } = createHarness();
  const decision = broker.requestApproval({ kind: "command", command: "npm install", reason: "dependency" });
  const request = webContents.sent[0].payload;
  assert.equal(request.category, "Dependencies");
  assert.equal(request.action, "npm install");

  const respond = handlers.get("cocreate:approval:respond");
  const accepted = await respond({ sender: webContents }, { approvalId: request.approvalId, decision: "approve" });
  assert.equal(accepted.ok, true);
  assert.equal(await decision, true);

  const duplicate = await respond({ sender: webContents }, { approvalId: request.approvalId, decision: "reject" });
  assert.equal(duplicate.ok, false);
  broker.dispose();
});

test("Approval broker rejects on timeout or renderer close and redacts sensitive commands", async () => {
  const timeoutHarness = createHarness(5);
  const timedOut = timeoutHarness.broker.requestApproval({
    kind: "command",
    command: "curl -H Authorization=Bearer-super-secret-token-123456789012345678901234567890"
  });
  assert.equal(timeoutHarness.webContents.sent[0].payload.action.includes("super-secret"), false);
  assert.equal(await timedOut, false);
  timeoutHarness.broker.dispose();

  const closeHarness = createHarness();
  const closed = closeHarness.broker.requestApproval({ kind: "file-change" });
  closeHarness.webContents.emit("destroyed");
  assert.equal(await closed, false);
  closeHarness.broker.dispose();
});
