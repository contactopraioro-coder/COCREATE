import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from "node:fs/promises";
import { Agent, get } from "node:http";
import os from "node:os";
import path from "node:path";
import { createProposalRuntime } from "../electron/proposal-runtime.mjs";

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocreate-proposal-test-"));
  const source = path.join(root, "current");
  const runtimeRoot = path.join(root, "runtime");
  await mkdir(path.join(source, "src"), { recursive: true });
  await mkdir(path.join(source, "node_modules", "fixture"), { recursive: true });
  await writeFile(path.join(source, "index.html"), "<main>Current</main>");
  await writeFile(path.join(source, "src", "app.js"), "export const label = 'Current';\n");
  await writeFile(path.join(source, "src", "theme.css"), ".button { padding: 16px; }\n");
  await writeFile(path.join(source, "node_modules", "fixture", "index.js"), "export {};\n");
  await writeFile(path.join(source, ".env"), "SECRET=never-copy\n");
  await writeFile(path.join(source, "package.json"), JSON.stringify({
    scripts: options.validationScripts ? {
      typecheck: "fixture-typecheck",
      lint: "fixture-lint",
      test: "fixture-test",
      build: "fixture-build"
    } : {}
  }));
  return { root, source, runtimeRoot };
}

async function keepPreviewConnection(url) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  await new Promise((resolve, reject) => {
    get(url, { agent }, (response) => {
      response.resume();
      response.once("end", resolve);
    }).once("error", reject);
  });
  return agent;
}

test("Proposal Workspace is an isolated copy, excludes secrets and reuses dependencies without exposing paths", async () => {
  const current = await fixture();
  const runtime = createProposalRuntime({ baseDir: current.runtimeRoot });
  try {
    const proposal = await runtime.createProposal(7, {
      instruction: "Haz el botón más pequeño",
      source: "text",
      selectionLabel: "Botón Guardar",
      author: "Tester"
    }, current.source);
    assert.equal(proposal.status, "draft");
    assert.equal(proposal.workspace.strategy, "temporary-copy-on-write");
    assert.equal(proposal.workspace.available, true);
    assert.equal(proposal.workspace.dependencyCacheReused, true);
    assert.equal(JSON.stringify(proposal).includes(current.source), false);
    const workspace = await runtime.resolveWorkspace(proposal.id, 7);
    assert.equal(await readFile(path.join(workspace.rootPath, "src", "app.js"), "utf8"), "export const label = 'Current';\n");
    assert.equal(await readFile(path.join(current.source, "src", "app.js"), "utf8"), "export const label = 'Current';\n");
    await assert.rejects(readFile(path.join(workspace.rootPath, ".env"), "utf8"));
    assert.equal((await lstat(path.join(workspace.rootPath, "node_modules"))).isSymbolicLink(), true);
    assert.equal(await readlink(path.join(workspace.rootPath, "node_modules")), path.join(await realpath(current.source), "node_modules"));
    await assert.rejects(runtime.resolveWorkspace(proposal.id, 99), /otra ventana/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Preview Runtime serves only the proposal and supports start, refresh, restart and stop", async () => {
  const current = await fixture();
  const runtime = createProposalRuntime({ baseDir: current.runtimeRoot });
  try {
    const draft = await runtime.createProposal(1, { instruction: "Cambia el contenido", source: "text" }, current.source);
    await runtime.beginProposal(1, draft.id);
    const workspace = await runtime.resolveWorkspace(draft.id, 1);
    await writeFile(path.join(workspace.rootPath, "index.html"), "<main>Proposal funcional</main>");
    const ready = await runtime.completeProposal(1, draft.id);
    assert.equal(ready.status, "ready");
    assert.equal(ready.preview.status, "ready");
    assert.match(await (await fetch(ready.preview.url)).text(), /Proposal funcional/);
    assert.match(await readFile(path.join(current.source, "index.html"), "utf8"), /Current/);

    const refreshed = await runtime.refreshPreview(1, draft.id);
    assert.equal(refreshed.preview.refreshToken, ready.preview.refreshToken + 1);
    const restarted = await runtime.restartPreview(1, draft.id);
    assert.equal(restarted.preview.status, "ready");
    assert.notEqual(restarted.preview.port, ready.preview.port);
    const keepAliveAgent = await keepPreviewConnection(restarted.preview.url);
    let stopTimeout;
    const stopped = await Promise.race([
      runtime.stopPreview(1, draft.id),
      new Promise((_, reject) => { stopTimeout = setTimeout(() => reject(new Error("Preview stop timed out")), 2_000); })
    ]).finally(() => {
      clearTimeout(stopTimeout);
      keepAliveAgent.destroy();
    });
    assert.equal(stopped.preview.status, "stopped");
    assert.equal(stopped.preview.url, null);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Multi-iteration Proposal inherits its parent while Current remains unchanged", async () => {
  const current = await fixture();
  const runtime = createProposalRuntime({ baseDir: current.runtimeRoot });
  try {
    const first = await runtime.createProposal(3, { instruction: "Primera versión", source: "text" }, current.source);
    await runtime.beginProposal(3, first.id);
    const firstWorkspace = await runtime.resolveWorkspace(first.id, 3);
    await writeFile(path.join(firstWorkspace.rootPath, "index.html"), "<main>Proposal 1</main>");
    await runtime.completeProposal(3, first.id);

    const second = await runtime.createProposal(3, { instruction: "Reduce el padding", source: "voice", parentId: first.id }, current.source);
    assert.equal(second.parentId, first.id);
    assert.equal(second.sequence, 2);
    assert.equal(second.source, "voice");
    const secondWorkspace = await runtime.resolveWorkspace(second.id, 3);
    assert.match(await readFile(path.join(secondWorkspace.rootPath, "index.html"), "utf8"), /Proposal 1/);
    assert.match(await readFile(path.join(current.source, "index.html"), "utf8"), /Current/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("An empty Codex iteration fails honestly instead of presenting a fake ready Proposal", async () => {
  const current = await fixture();
  const runtime = createProposalRuntime({ baseDir: current.runtimeRoot });
  try {
    const draft = await runtime.createProposal(10, { instruction: "No cambies nada", source: "text" }, current.source);
    await runtime.beginProposal(10, draft.id);
    const failed = await runtime.completeProposal(10, draft.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.preview.status, "stopped");
    assert.match(failed.errors.at(-1), /sin producir cambios/i);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Proposal Runtime includes permission-only changes in the immutable approved revision", async () => {
  const current = await fixture();
  const runtime = createProposalRuntime({ baseDir: current.runtimeRoot });
  try {
    const draft = await runtime.createProposal(11, { instruction: "Haz ejecutable el archivo", source: "text" }, current.source);
    await runtime.beginProposal(11, draft.id);
    const workspace = await runtime.resolveWorkspace(draft.id, 11);
    await chmod(path.join(workspace.rootPath, "src", "app.js"), 0o755);
    const ready = await runtime.completeProposal(11, draft.id);
    assert.equal(ready.status, "ready");
    assert.deepEqual(ready.diff.files, ["src/app.js"]);
    await runtime.approveProposal(11, draft.id);
    const revision = await runtime.resolveApprovedRevision(draft.id, 11);
    assert.equal(revision.proposalManifest["src/app.js"].mode & 0o777, 0o755);
    assert.equal((await stat(path.join(current.source, "src", "app.js"))).mode & 0o777, 0o644);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Validation, explicit approval and Apply copy only reviewed files then destroy the temporary workspace", async () => {
  const current = await fixture({ validationScripts: true });
  const calls = [];
  const runtime = createProposalRuntime({
    baseDir: current.runtimeRoot,
    commandRunner: async (_command, args) => {
      calls.push(args.join(" "));
      return { ok: true, exitCode: 0, durationMs: 4, output: "ok" };
    }
  });
  try {
    const draft = await runtime.createProposal(4, { instruction: "Actualiza estilos", source: "text" }, current.source);
    await runtime.beginProposal(4, draft.id);
    const workspace = await runtime.resolveWorkspace(draft.id, 4);
    await writeFile(path.join(workspace.rootPath, "src", "theme.css"), ".button { padding: 8px; }\n");
    const ready = await runtime.completeProposal(4, draft.id);
    assert.deepEqual(ready.diff.files, ["src/theme.css"]);
    assert.equal(ready.diff.components.includes("theme"), true);
    const validated = await runtime.validateProposal(4, draft.id);
    assert.equal(validated.validation.status, "passed");
    assert.equal(validated.validation.checks.length, 4);
    assert.deepEqual(calls, ["run typecheck", "run lint", "run test", "run build"]);
    await runtime.approveProposal(4, draft.id);
    const applied = await runtime.applyProposal(4, draft.id);
    assert.equal(applied.status, "applied");
    assert.equal(applied.workspace.available, false);
    assert.equal(await readFile(path.join(current.source, "src", "theme.css"), "utf8"), ".button { padding: 8px; }\n");
    assert.equal(applied.timeline.some((item) => /eliminado después de Apply/.test(item.label)), true);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Apply rolls Current back automatically when a file operation fails", async () => {
  const current = await fixture({ validationScripts: true });
  const originalApp = await readFile(path.join(current.source, "src", "app.js"), "utf8");
  const originalTheme = await readFile(path.join(current.source, "src", "theme.css"), "utf8");
  const runtime = createProposalRuntime({
    baseDir: current.runtimeRoot,
    commandRunner: async () => ({ ok: true, exitCode: 0, durationMs: 1, output: "ok" }),
    beforeApplyFile: ({ index }) => { if (index === 1) throw new Error("fallo inducido"); }
  });
  try {
    const draft = await runtime.createProposal(5, { instruction: "Cambia dos archivos", source: "text" }, current.source);
    await runtime.beginProposal(5, draft.id);
    const workspace = await runtime.resolveWorkspace(draft.id, 5);
    await writeFile(path.join(workspace.rootPath, "src", "app.js"), "export const label = 'Proposal';\n");
    await writeFile(path.join(workspace.rootPath, "src", "theme.css"), ".button { padding: 4px; }\n");
    await runtime.completeProposal(5, draft.id);
    await runtime.validateProposal(5, draft.id);
    await runtime.approveProposal(5, draft.id);
    await assert.rejects(runtime.applyProposal(5, draft.id), /Current fue restaurado/);
    assert.equal(await readFile(path.join(current.source, "src", "app.js"), "utf8"), originalApp);
    assert.equal(await readFile(path.join(current.source, "src", "theme.css"), "utf8"), originalTheme);
    const [failed] = await runtime.list(5);
    assert.equal(failed.status, "failed");
    assert.equal(failed.timeline.some((item) => /restaurado/.test(item.label)), true);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Failed validation blocks Apply and a restored workspace can be destroyed after restart", async () => {
  const current = await fixture({ validationScripts: true });
  const firstRuntime = createProposalRuntime({
    baseDir: current.runtimeRoot,
    commandRunner: async (_command, args) => ({
      ok: !args.includes("lint"),
      exitCode: args.includes("lint") ? 1 : 0,
      durationMs: 1,
      output: args.includes("lint") ? "lint failed SECRET=hidden" : "ok"
    })
  });
  let proposalId;
  try {
    const draft = await firstRuntime.createProposal(6, { instruction: "Propuesta inválida", source: "text" }, current.source);
    proposalId = draft.id;
    await firstRuntime.beginProposal(6, draft.id);
    const workspace = await firstRuntime.resolveWorkspace(draft.id, 6);
    await writeFile(path.join(workspace.rootPath, "src", "app.js"), "invalid();\n");
    await firstRuntime.completeProposal(6, draft.id);
    const validation = await firstRuntime.validateProposal(6, draft.id);
    assert.equal(validation.validation.status, "failed");
    assert.equal(JSON.stringify(validation).includes("hidden"), false);
    await firstRuntime.approveProposal(6, draft.id);
    await assert.rejects(firstRuntime.applyProposal(6, draft.id), /validaciones/);
  } finally {
    await firstRuntime.dispose();
  }

  const restoredRuntime = createProposalRuntime({ baseDir: current.runtimeRoot });
  try {
    const restored = await restoredRuntime.list(8);
    const proposal = restored.find((entry) => entry.id === proposalId);
    assert.equal(proposal.workspace.restored, true);
    assert.equal(proposal.workspace.available, true);
    const destroyed = await restoredRuntime.destroyProposal(8, proposalId);
    assert.equal(destroyed.status, "destroyed");
    assert.equal(destroyed.workspace.available, false);
  } finally {
    await restoredRuntime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});
