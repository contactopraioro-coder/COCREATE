import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFoundationStore } from "../electron/foundation-store.mjs";

test("Foundation store migrates invalid data to the current schema", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cocreate-foundation-"));
  const filePath = path.join(directory, "foundation.json");
  await writeFile(filePath, JSON.stringify({ broken: true }), "utf8");

  const store = createFoundationStore({ filePath });
  const state = await store.load();

  assert.equal(state.version, 1);
  assert.deepEqual(state.preferences, {
    theme: null,
    activeMode: null,
    sidebarCollapsed: null
  });
});

test("Foundation store records codex status and execution metadata without secrets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cocreate-foundation-"));
  const filePath = path.join(directory, "foundation.json");
  const store = createFoundationStore({ filePath });

  await store.recordCodexStatus({
    available: true,
    binary: "codex",
    version: "codex-cli 0.134.0",
    compatible: true,
    validatedVersion: "0.134.0",
    minimumSupportedVersion: "0.134.0",
    license: "Apache-2.0",
    source: "https://github.com/openai/codex",
    mode: "cli-upstream",
    updatedAt: new Date().toISOString()
  });
  await store.recordExecution({
    executionId: "exec-1",
    status: "execution.completed",
    binary: "codex",
    version: "codex-cli 0.134.0",
    promptPreview: "build auth form",
    outputPreview: "done",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  });

  const rawFile = JSON.parse(await readFile(filePath, "utf8"));

  assert.equal(rawFile.codex.lastKnownStatus.binary, "codex");
  assert.equal(rawFile.recentExecutions.length, 1);
  assert.equal("token" in rawFile.codex.lastKnownStatus, false);
});

test("Foundation store serializes concurrent atomic updates without losing records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cocreate-foundation-concurrent-"));
  const filePath = path.join(directory, "foundation.json");
  const store = createFoundationStore({ filePath });

  await Promise.all(Array.from({ length: 12 }, (_, index) => store.recordExecution({
    executionId: `exec-${index}`,
    status: "execution.completed",
    binary: "codex",
    version: "0.134.0",
    promptPreview: `prompt-${index}`,
    outputPreview: "done",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  })));

  const state = await store.load();
  assert.equal(state.recentExecutions.length, 12);
  assert.equal(new Set(state.recentExecutions.map((entry) => entry.executionId)).size, 12);
});
