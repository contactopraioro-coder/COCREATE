import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { CodexExecutionEvent } from "../shared/codex-contracts.js";
import { createNodeCodexAdapter } from "../shared/codex-runner.js";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killShouldFail = false;
  stdin = {
    write: (_value: string) => undefined,
    end: () => undefined
  };
  killed = false;

  kill() {
    if (this.killShouldFail) {
      return false;
    }
    this.killed = true;
    setImmediate(() => {
      this.emit("close", 143);
    });
    return true;
  }
}

test("NodeCodexAdapter emits output and completion in order", async () => {
  const fakeChild = new FakeChild();
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    execFileAsync: async () => ({
      stdout: "codex 1.0.0",
      stderr: ""
    }),
    spawnFactory: () => {
      setImmediate(() => {
        fakeChild.stdout.emit("data", "hola");
        fakeChild.stderr.emit("data", "procesando");
        fakeChild.emit("close", 0);
      });
      return fakeChild as never;
    }
  });

  const events: string[] = [];
  const handle = await adapter.execute(
    {
      prompt: "hola",
      origin: "test"
    },
    (event: CodexExecutionEvent) => {
      events.push(event.type);
    }
  );

  const terminal = await handle.completed;

  assert.deepEqual(events, [
    "execution.started",
    "execution.progress",
    "execution.output",
    "execution.progress",
    "execution.progress",
    "execution.completed"
  ]);
  assert.equal(terminal.type, "execution.completed");
});

test("NodeCodexAdapter cancels an active execution and emits cancellation", async () => {
  const fakeChild = new FakeChild();
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    spawnFactory: () => fakeChild as never
  });

  const events: string[] = [];
  const handle = await adapter.execute(
    {
      prompt: "hola",
      origin: "test"
    },
    (event: CodexExecutionEvent) => {
      events.push(event.type);
    }
  );

  await handle.cancel("user-requested");
  const terminal = await handle.completed;

  assert.equal(fakeChild.killed, true);
  assert.equal(terminal.type, "execution.cancelled");
  assert.deepEqual(events.slice(0, 2), ["execution.started", "execution.progress"]);
  assert.equal(events[events.length - 1], "execution.cancelled");
});

test("NodeCodexAdapter handles stderr progress and timeout as a single terminal failure", async () => {
  const fakeChild = new FakeChild();
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    timeoutMs: 10,
    spawnFactory: () => {
      setImmediate(() => {
        fakeChild.stderr.emit("data", "warning parcial");
      });
      return fakeChild as never;
    }
  });

  const events: CodexExecutionEvent[] = [];
  const handle = await adapter.execute(
    {
      prompt: "hola",
      origin: "test"
    },
    (event: CodexExecutionEvent) => {
      events.push(event);
    }
  );

  const terminal = await handle.completed;

  assert.equal(terminal.type, "execution.failed");
  assert.equal(terminal.error.code, "TIMEOUT");
  assert.equal(events.filter((event) => event.type === "execution.failed").length, 1);
});

test("NodeCodexAdapter rejects duplicate execution ids", async () => {
  const fakeChild = new FakeChild();
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    spawnFactory: () => fakeChild as never
  });

  const firstHandle = await adapter.execute(
    {
      executionId: "dup-1",
      prompt: "hola",
      origin: "test"
    },
    () => undefined
  );

  await assert.rejects(
    () =>
      adapter.execute(
        {
          executionId: "dup-1",
          prompt: "repetido",
          origin: "test"
        },
        () => undefined
      ),
    (error) => (error as { message?: string } | null)?.message === "Duplicate execution id: dup-1"
  );

  await firstHandle.cancel("cleanup");
  await firstHandle.completed;
});

test("NodeCodexAdapter supports concurrent executions with isolated terminal events", async () => {
  const firstChild = new FakeChild();
  const secondChild = new FakeChild();
  let callCount = 0;
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    spawnFactory: () => {
      callCount += 1;
      if (callCount === 1) {
        setImmediate(() => {
          firstChild.stdout.emit("data", "uno");
          firstChild.emit("close", 0);
        });
        return firstChild as never;
      }
      setImmediate(() => {
        secondChild.stdout.emit("data", "dos");
        secondChild.emit("close", 0);
      });
      return secondChild as never;
    }
  });

  const first = await adapter.execute({ prompt: "uno", origin: "test" }, () => undefined);
  const second = await adapter.execute({ prompt: "dos", origin: "test" }, () => undefined);

  const [firstTerminal, secondTerminal] = await Promise.all([first.completed, second.completed]);

  assert.equal(firstTerminal.type, "execution.completed");
  assert.equal(secondTerminal.type, "execution.completed");
  assert.notEqual(first.executionId, second.executionId);
});

test("NodeCodexAdapter surfaces child start failures", async () => {
  const fakeChild = new FakeChild();
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    spawnFactory: () => {
      setImmediate(() => {
        fakeChild.emit("error", new Error("spawn failed"));
      });
      return fakeChild as never;
    }
  });

  const handle = await adapter.execute({ prompt: "hola", origin: "test" }, () => undefined);
  const terminal = await handle.completed;

  assert.equal(terminal.type, "execution.failed");
  assert.equal(terminal.error.message, "spawn failed");
});

test("NodeCodexAdapter keeps cancellation idempotent when called repeatedly", async () => {
  const fakeChild = new FakeChild();
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    spawnFactory: () => fakeChild as never
  });

  const handle = await adapter.execute({ prompt: "hola", origin: "test" }, () => undefined);
  const firstCancel = await handle.cancel("first");
  const secondCancel = await handle.cancel("second");
  const terminal = await handle.completed;

  assert.equal(firstCancel.alreadyTerminated, false);
  assert.equal(secondCancel.alreadyTerminated, false);
  assert.equal(terminal.type, "execution.cancelled");
});

test("NodeCodexAdapter reports signal delivery failures during cancellation", async () => {
  const fakeChild = new FakeChild();
  fakeChild.killShouldFail = true;
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    cwd: process.cwd(),
    spawnFactory: () => fakeChild as never
  });

  const handle = await adapter.execute({ prompt: "hola", origin: "test" }, () => undefined);

  await assert.rejects(
    () => handle.cancel("cannot-kill"),
    (error) => (error as { message?: string } | null)?.message?.includes("No pude enviar SIGTERM")
  );

  const terminal = await handle.completed;
  assert.equal(terminal.type, "execution.failed");
});

test("NodeCodexAdapter resolves status without starting an execution", async () => {
  const adapter = createNodeCodexAdapter({
    binary: "codex",
    execFileAsync: async () => ({
      stdout: "codex 2.0.0",
      stderr: ""
    })
  });

  const status = await adapter.getStatus();

  assert.equal(status.available, true);
  assert.equal(status.version, "codex 2.0.0");
});
