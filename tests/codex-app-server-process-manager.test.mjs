import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createCodexAppServerProcessManager } from "../infrastructure/codex-app-server/process-manager.js";

class FakeAppServerProcess extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.buffer = "";
    this.stdin.on("data", (chunk) => this.handleInput(chunk));
  }

  handleInput(chunk) {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.respond(JSON.parse(line));
      newline = this.buffer.indexOf("\n");
    }
  }

  respond(message) {
    if (!Object.hasOwn(message, "id")) return;
    const result = message.method === "initialize"
      ? { userAgent: "Codex Desktop/0.134.0", platformFamily: "unix", platformOs: "macos" }
      : message.method === "account/read"
        ? { account: { type: "chatgpt" } }
        : message.method === "mcpServerStatus/list"
          ? { data: [{ name: "local" }] }
          : {};
    this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
  }

  kill() {
    if (this.exitCode != null) return false;
    this.exitCode = 0;
    setImmediate(() => this.emit("close", 0, "SIGTERM"));
    return true;
  }

  crash() {
    this.exitCode = 1;
    this.emit("close", 1, null);
  }
}

async function waitFor(predicate, timeoutMs = 500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("process manager starts one authenticated App Server and shuts it down", async () => {
  const children = [];
  const manager = createCodexAppServerProcessManager({
    execFileAsync: async () => ({ stdout: "codex-cli 0.134.0", stderr: "" }),
    spawnFactory: () => {
      const child = new FakeAppServerProcess();
      children.push(child);
      return child;
    }
  });

  const [left, right] = await Promise.all([manager.start(), manager.start()]);
  assert.equal(children.length, 1);
  assert.equal(left.available, true);
  assert.equal(right.authMode, "chatgpt");
  assert.equal(left.mcp.configuredServers, 1);
  await manager.stop();
  assert.equal(manager.getStatus().processState, "stopped");
});

test("process manager rejects a non-pinned Codex version before spawning", async () => {
  let spawned = false;
  const manager = createCodexAppServerProcessManager({
    execFileAsync: async () => ({ stdout: "codex-cli 0.135.0", stderr: "" }),
    spawnFactory: () => {
      spawned = true;
      return new FakeAppServerProcess();
    }
  });
  await assert.rejects(manager.start(), (error) => error.code === "CODEX_APP_SERVER_INCOMPATIBLE");
  assert.equal(spawned, false);
});

test("process manager performs a bounded restart after an unexpected exit", async () => {
  const children = [];
  const manager = createCodexAppServerProcessManager({
    restartBaseDelayMs: 5,
    restartLimit: 1,
    execFileAsync: async () => ({ stdout: "codex-cli 0.134.0", stderr: "" }),
    spawnFactory: () => {
      const child = new FakeAppServerProcess();
      children.push(child);
      return child;
    }
  });
  await manager.start();
  children[0].crash();
  await waitFor(() => children.length === 2 && manager.getStatus().processState === "ready");
  assert.equal(children.length, 2);
  await manager.stop();
});
