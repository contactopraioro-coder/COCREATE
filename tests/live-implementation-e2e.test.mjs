import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createImplementationRuntime } from "../electron/implementation-runtime.mjs";
import { createProposalRuntime } from "../electron/proposal-runtime.mjs";

test("real Proposal approval implements into Current, reports validation honestly and supports safe rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocreate-live-implementation-e2e-"));
  const sourceRoot = path.join(root, "current");
  const proposalStore = path.join(root, "proposal-runtime");
  const implementationStore = path.join(root, "implementation-runtime");
  await mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await writeFile(path.join(sourceRoot, "index.html"), "<main class=\"hero\">Current</main>\n");
  await writeFile(path.join(sourceRoot, "src", "theme.css"), ".hero { color: black; }\n");
  await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({ scripts: {} }));

  const proposalRuntime = createProposalRuntime({ baseDir: proposalStore });
  const implementationRuntime = createImplementationRuntime({
    baseDir: implementationStore,
    proposalRuntime
  });
  try {
    const draft = await proposalRuntime.createProposal(21, {
      instruction: "Convierte el hero aprobado en una experiencia más clara",
      source: "text",
      selectionLabel: "Hero"
    }, sourceRoot);
    await proposalRuntime.beginProposal(21, draft.id);
    const proposalWorkspace = await proposalRuntime.resolveWorkspace(draft.id, 21);
    await writeFile(path.join(proposalWorkspace.rootPath, "index.html"), "<main class=\"hero\">Approved</main>\n");
    await writeFile(path.join(proposalWorkspace.rootPath, "src", "theme.css"), ".hero { color: green; }\n");
    await chmod(path.join(proposalWorkspace.rootPath, "src", "theme.css"), 0o755);
    await writeFile(path.join(proposalWorkspace.rootPath, "src", "interaction.js"), "export const ready = true;\n");
    const ready = await proposalRuntime.completeProposal(21, draft.id);
    assert.equal(ready.status, "ready");
    await proposalRuntime.approveProposal(21, draft.id);

    const operation = await implementationRuntime.createOperation(21, {
      conversationId: "conversation-e2e",
      projectId: "project-e2e",
      proposalId: draft.id
    });
    assert.equal(operation.status, "queued");
    assert.equal(operation.changeSet.length, 3);
    const completed = await implementationRuntime.runPipeline(21, operation.id);
    assert.equal(completed.status, "completed_with_warnings");
    assert.equal(completed.validationSummary.status, "unavailable");
    assert.equal(completed.refresh.status, "completed");
    assert.equal(completed.diffSummary.additions > 0, true);
    assert.match(completed.diffSummary.preview, /index\.html|theme\.css/);
    assert.equal(completed.diffSummary.files.length, 3);
    assert.match(await readFile(path.join(sourceRoot, "index.html"), "utf8"), /Approved/);
    assert.match(await readFile(path.join(sourceRoot, "src", "theme.css"), "utf8"), /green/);
    assert.equal((await stat(path.join(sourceRoot, "src", "theme.css"))).mode & 0o777, 0o755);
    assert.match(await readFile(path.join(sourceRoot, "src", "interaction.js"), "utf8"), /ready/);

    const proposalRecords = await proposalRuntime.list(21);
    assert.equal(proposalRecords.find((entry) => entry.id === draft.id)?.status, "applied");
    assert.equal(proposalRecords.find((entry) => entry.id === draft.id)?.workspace.available, false);

    const rolledBack = await implementationRuntime.rollback(21, operation.id);
    assert.equal(rolledBack.status, "rolled_back");
    assert.match(await readFile(path.join(sourceRoot, "index.html"), "utf8"), /Current/);
    assert.match(await readFile(path.join(sourceRoot, "src", "theme.css"), "utf8"), /black/);
    assert.equal((await stat(path.join(sourceRoot, "src", "theme.css"))).mode & 0o777, 0o644);
    await assert.rejects(readFile(path.join(sourceRoot, "src", "interaction.js"), "utf8"));
  } finally {
    await implementationRuntime.dispose();
    await proposalRuntime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("real Proposal conflict pauses before Apply and continues only with an explicit choice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocreate-live-conflict-e2e-"));
  const sourceRoot = path.join(root, "current");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, "index.html"), "<main>Baseline</main>\n");
  const proposalRuntime = createProposalRuntime({ baseDir: path.join(root, "proposal-runtime") });
  const implementationRuntime = createImplementationRuntime({
    baseDir: path.join(root, "implementation-runtime"),
    proposalRuntime
  });
  try {
    const draft = await proposalRuntime.createProposal(22, { instruction: "Actualiza el contenido", source: "text" }, sourceRoot);
    await proposalRuntime.beginProposal(22, draft.id);
    const workspace = await proposalRuntime.resolveWorkspace(draft.id, 22);
    await writeFile(path.join(workspace.rootPath, "index.html"), "<main>Proposal</main>\n");
    await proposalRuntime.completeProposal(22, draft.id);
    await proposalRuntime.approveProposal(22, draft.id);
    const operation = await implementationRuntime.createOperation(22, {
      conversationId: "conversation-conflict",
      projectId: "project-conflict",
      proposalId: draft.id
    });
    await writeFile(path.join(sourceRoot, "index.html"), "<main>External work</main>\n");

    const paused = await implementationRuntime.runPipeline(22, operation.id);
    assert.equal(paused.status, "conflict");
    assert.match(await readFile(path.join(sourceRoot, "index.html"), "utf8"), /External work/);
    const conflict = paused.conflicts.find((entry) => entry.path === "index.html");
    assert.ok(conflict);
    await implementationRuntime.resolveConflict(22, operation.id, conflict.id, "proposal");
    const completed = await implementationRuntime.runPipeline(22, operation.id);
    assert.equal(completed.status, "completed_with_warnings");
    assert.match(await readFile(path.join(sourceRoot, "index.html"), "utf8"), /Proposal/);
  } finally {
    await implementationRuntime.dispose();
    await proposalRuntime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
