import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createImplementationRuntime } from "../electron/implementation-runtime.mjs";

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function manifest(root, files) {
  const output = {};
  for (const relative of files) {
    const filePath = path.join(root, relative);
    const info = await stat(filePath).catch(() => null);
    if (info?.isFile()) output[relative] = { hash: await hashFile(filePath), size: info.size, mode: info.mode };
  }
  return output;
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocreate-implementation-test-"));
  const source = path.join(root, "current");
  const proposal = path.join(root, "proposal");
  const runtimeRoot = path.join(root, "runtime");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "src", "app.js"), "export const value = 'current';\n");
  await writeFile(path.join(source, "src", "delete.txt"), "delete me\n");
  await writeFile(path.join(source, "src", "old-name.txt"), "rename payload\n");
  await writeFile(path.join(source, "src", "run.sh"), "#!/bin/sh\necho current\n", { mode: 0o644 });
  if (options.package !== false) {
    await writeFile(path.join(source, "package.json"), JSON.stringify({
      scripts: options.scripts === false ? {} : {
        typecheck: "fixture-typecheck",
        lint: "fixture-lint",
        test: "fixture-test",
        build: "fixture-build"
      }
    }, null, 2));
  }
  if (options.languageFile) await writeFile(path.join(source, options.languageFile), options.languageContents ?? "\n");
  await cp(source, proposal, { recursive: true });
  const allFiles = [
    "src/app.js",
    "src/delete.txt",
    "src/old-name.txt",
    "src/run.sh",
    ...(options.package === false ? [] : ["package.json"]),
    ...(options.languageFile ? [options.languageFile] : [])
  ];
  const baselineManifest = await manifest(source, allFiles);
  let finalized = 0;
  const proposalRuntime = {
    resolveApprovedRevision: async () => {
      const proposalFiles = [...allFiles, ...(options.additionalFiles ?? [])];
      const proposalManifest = await manifest(proposal, proposalFiles);
      return {
        proposal: {
          id: "proposal-approved",
          instruction: "Implementa la revisión visual aprobada",
          selectionLabel: "Hero principal",
          source: "text",
          updatedAt: new Date().toISOString()
        },
        approvedRevisionId: options.revisionId ?? "approved-revision-001",
        sourceRoot: source,
        workspaceRoot: proposal,
        baselineManifest,
        proposalManifest,
        diff: { files: proposalFiles }
      };
    },
    finalizeImplementation: async () => { finalized += 1; }
  };
  return { root, source, proposal, runtimeRoot, proposalRuntime, getFinalized: () => finalized };
}

const operationInput = (projectId = "project-a") => ({
  conversationId: "conversation-a",
  projectId,
  proposalId: "proposal-approved"
});

test("approved revision freezes and applies added, modified, deleted, renamed, binary and permission changes incrementally", async () => {
  const current = await fixture({ additionalFiles: ["src/new.bin", "src/new-name.txt"] });
  const calls = [];
  const runtime = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    commandRunner: async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { ok: true, exitCode: 0, durationMs: 2, output: "ok", timedOut: false, cancelled: false };
    }
  });
  try {
    await writeFile(path.join(current.proposal, "src", "app.js"), "export const value = 'proposal';\n");
    await unlink(path.join(current.proposal, "src", "delete.txt"));
    await writeFile(path.join(current.proposal, "src", "new-name.txt"), await readFile(path.join(current.proposal, "src", "old-name.txt")));
    await unlink(path.join(current.proposal, "src", "old-name.txt"));
    await writeFile(path.join(current.proposal, "src", "new.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(current.proposal, "src", "run.sh"), "#!/bin/sh\necho proposal\n");
    await chmod(path.join(current.proposal, "src", "run.sh"), 0o755);

    const created = await runtime.createOperation(1, operationInput());
    assert.equal(created.status, "queued");
    assert.equal(created.approvedRevisionId, "approved-revision-001");
    assert.deepEqual(new Set(created.changeSet.map((entry) => entry.kind)), new Set(["modified", "deleted", "renamed", "added"]));
    assert.equal(created.changeSet.find((entry) => entry.path === "src/new.bin")?.binary, true);
    assert.equal(JSON.stringify(created).includes(current.source), false);

    const completed = await runtime.runPipeline(1, created.id);
    assert.equal(completed.status, "completed");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /proposal/);
    await assert.rejects(readFile(path.join(current.source, "src", "delete.txt")));
    await assert.rejects(readFile(path.join(current.source, "src", "old-name.txt")));
    assert.match(await readFile(path.join(current.source, "src", "new-name.txt"), "utf8"), /rename payload/);
    assert.deepEqual(await readFile(path.join(current.source, "src", "new.bin")), Buffer.from([0, 1, 2, 3]));
    assert.equal((await stat(path.join(current.source, "src", "run.sh"))).mode & 0o777, 0o755);
    assert.deepEqual(calls, ["npm run typecheck", "npm run lint", "npm run test", "npm run build"]);
    assert.equal(completed.checkpoint.available, true);
    assert.equal(completed.rollback.available, true);
    assert.equal(current.getFinalized(), 1);

    const rolledBack = await runtime.rollback(1, created.id);
    assert.equal(rolledBack.status, "rolled_back");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /current/);
    assert.match(await readFile(path.join(current.source, "src", "delete.txt"), "utf8"), /delete me/);
    assert.match(await readFile(path.join(current.source, "src", "old-name.txt"), "utf8"), /rename payload/);
    await assert.rejects(readFile(path.join(current.source, "src", "new-name.txt")));
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("conflicts pause before Apply and preserve Current or use Proposal only after an explicit decision", async () => {
  const current = await fixture();
  const runtime = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    commandRunner: async () => ({ ok: true, exitCode: 0, durationMs: 1, output: "ok", timedOut: false, cancelled: false })
  });
  try {
    await writeFile(path.join(current.proposal, "src", "app.js"), "export const value = 'proposal';\n");
    const created = await runtime.createOperation(2, operationInput());
    await writeFile(path.join(current.source, "src", "app.js"), "export const value = 'external';\n");
    const paused = await runtime.runPipeline(2, created.id);
    assert.equal(paused.status, "conflict");
    assert.equal(paused.checkpoint.available, false);
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /external/);
    const conflict = paused.conflicts.find((entry) => entry.path === "src/app.js");
    assert.equal(conflict.severity, "requires_review");

    await runtime.resolveConflict(2, created.id, conflict.id, "current");
    const completed = await runtime.runPipeline(2, created.id);
    assert.equal(completed.status, "completed");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /external/);
    assert.equal(completed.changeSet.find((entry) => entry.path === "src/app.js")?.skipped, true);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("dependency and repository-operation conflicts are blocking and never overwrite silently", async () => {
  const current = await fixture();
  const runtime = createImplementationRuntime({ baseDir: current.runtimeRoot, proposalRuntime: current.proposalRuntime });
  try {
    await writeFile(path.join(current.proposal, "package.json"), JSON.stringify({ scripts: {}, dependencies: { react: "latest" } }));
    const created = await runtime.createOperation(3, operationInput());
    await writeFile(path.join(current.source, "package.json"), JSON.stringify({ scripts: {}, dependencies: { react: "18" } }));
    await mkdir(path.join(current.source, ".git"), { recursive: true });
    await writeFile(path.join(current.source, ".git", "MERGE_HEAD"), "abc");
    const paused = await runtime.runPipeline(3, created.id);
    assert.equal(paused.status, "conflict");
    assert.equal(paused.conflicts.some((entry) => entry.path === "package.json" && entry.severity === "blocking"), true);
    assert.equal(paused.conflicts.some((entry) => entry.kind === "repository_state" && entry.severity === "blocking"), true);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("staged Git changes in the approved scope pause Apply even when Current matches Baseline", async () => {
  const current = await fixture();
  const runtime = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    gitStatusRunner: async () => ({ ok: true, exitCode: 0, durationMs: 1, output: "M  src/app.js\0", timedOut: false, cancelled: false })
  });
  try {
    await mkdir(path.join(current.source, ".git"), { recursive: true });
    await writeFile(path.join(current.proposal, "src", "app.js"), "proposal\n");
    const created = await runtime.createOperation(14, operationInput());
    const paused = await runtime.runPipeline(14, created.id);
    assert.equal(paused.status, "conflict");
    assert.equal(paused.repository.staged, 1);
    assert.equal(paused.conflicts.some((conflict) => conflict.path === "src/app.js" && conflict.currentState === "staged"), true);
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /current/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("a blocking Git operation can be rechecked and continues only after the repository is safe", async () => {
  const current = await fixture();
  const runtime = createImplementationRuntime({ baseDir: current.runtimeRoot, proposalRuntime: current.proposalRuntime });
  const marker = path.join(current.source, ".git", "MERGE_HEAD");
  try {
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, "merge-in-progress");
    await writeFile(path.join(current.proposal, "src", "app.js"), "proposal\n");
    const created = await runtime.createOperation(15, operationInput());
    const paused = await runtime.runPipeline(15, created.id);
    assert.equal(paused.status, "conflict");
    assert.equal(paused.conflicts.some((conflict) => conflict.kind === "repository_state"), true);

    await rm(marker);
    const completed = await runtime.runPipeline(15, created.id);
    assert.equal(completed.status, "completed_with_warnings");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /proposal/);
    assert.equal(completed.events.some((event) => event.type === "implementation.conflict.recheck"), true);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

for (const failureIndex of [0, 1]) {
  test(`Apply failure at file ${failureIndex + 1} verifies automatic rollback`, async () => {
    const current = await fixture();
    const originalApp = await readFile(path.join(current.source, "src", "app.js"), "utf8");
    const originalRun = await readFile(path.join(current.source, "src", "run.sh"), "utf8");
    const runtime = createImplementationRuntime({
      baseDir: current.runtimeRoot,
      proposalRuntime: current.proposalRuntime,
      beforeApplyFile: ({ entry }) => {
        const ordered = ["src/app.js", "src/run.sh"];
        if (entry.path === ordered[failureIndex]) throw new Error("fallo inducido");
      }
    });
    try {
      await writeFile(path.join(current.proposal, "src", "app.js"), "proposal app\n");
      await writeFile(path.join(current.proposal, "src", "run.sh"), "proposal run\n");
      const created = await runtime.createOperation(4, operationInput());
      const failed = await runtime.runPipeline(4, created.id);
      assert.equal(failed.status, "failed");
      assert.equal(failed.failure.rollbackStatus, "completed");
      assert.equal(await readFile(path.join(current.source, "src", "app.js"), "utf8"), originalApp);
      assert.equal(await readFile(path.join(current.source, "src", "run.sh"), "utf8"), originalRun);
    } finally {
      await runtime.dispose();
      await rm(current.root, { recursive: true, force: true });
    }
  });
}

test("validation failures keep applied code visible as completed with warnings and unavailable checks never pass", async () => {
  const current = await fixture();
  const runtime = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    commandRunner: async (_command, args) => ({
      ok: !args.includes("lint"),
      exitCode: args.includes("lint") ? 1 : 0,
      durationMs: 3,
      output: args.includes("lint") ? "lint failed TOKEN=hidden" : "ok",
      timedOut: false,
      cancelled: false
    })
  });
  try {
    await writeFile(path.join(current.proposal, "src", "app.js"), "proposal\n");
    const created = await runtime.createOperation(5, operationInput());
    const completed = await runtime.runPipeline(5, created.id);
    assert.equal(completed.status, "completed_with_warnings");
    assert.equal(completed.validationSummary.status, "failed");
    assert.equal(completed.validationSummary.checks.find((entry) => entry.id === "lint")?.status, "failed");
    assert.equal(JSON.stringify(completed).includes("hidden"), false);
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /proposal/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }

  const noScripts = await fixture({ scripts: false, revisionId: "approved-revision-no-scripts" });
  const noScriptsRuntime = createImplementationRuntime({ baseDir: noScripts.runtimeRoot, proposalRuntime: noScripts.proposalRuntime });
  try {
    await writeFile(path.join(noScripts.proposal, "src", "app.js"), "proposal\n");
    const created = await noScriptsRuntime.createOperation(5, operationInput());
    const completed = await noScriptsRuntime.runPipeline(5, created.id);
    assert.equal(completed.status, "completed_with_warnings");
    assert.equal(completed.validationSummary.status, "unavailable");
    assert.equal(completed.validationSummary.checks.every((entry) => entry.status === "unavailable"), true);
  } finally {
    await noScriptsRuntime.dispose();
    await rm(noScripts.root, { recursive: true, force: true });
  }
});

test("validation detection supports Python, Rust and Go projects without assuming Node", async () => {
  const projects = [
    { languageFile: "pyproject.toml", command: "python3", check: "python-compile" },
    { languageFile: "Cargo.toml", command: "cargo", check: "cargo-check" },
    { languageFile: "go.mod", languageContents: "module example.com/cocreate\n", command: "go", check: "go-test" }
  ];
  for (const project of projects) {
    const current = await fixture({ package: false, ...project, revisionId: `revision-${project.command}` });
    const calls = [];
    const runtime = createImplementationRuntime({
      baseDir: current.runtimeRoot,
      proposalRuntime: current.proposalRuntime,
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, exitCode: 0, durationMs: 1, output: "ok", timedOut: false, cancelled: false };
      }
    });
    try {
      await writeFile(path.join(current.proposal, "src", "app.js"), `${project.command} proposal\n`);
      const created = await runtime.createOperation(12, operationInput(`project-${project.command}`));
      const completed = await runtime.runPipeline(12, created.id);
      assert.equal(completed.status, "completed");
      assert.equal(completed.validationSummary.checks.some((check) => check.id === project.check && check.status === "passed"), true);
      assert.equal(calls[0]?.command, project.command);
    } finally {
      await runtime.dispose();
      await rm(current.root, { recursive: true, force: true });
    }
  }
});

test("manual rollback refuses to destroy changes created after the implementation", async () => {
  const current = await fixture();
  const runtime = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    commandRunner: async () => ({ ok: true, exitCode: 0, durationMs: 1, output: "ok", timedOut: false, cancelled: false })
  });
  try {
    await writeFile(path.join(current.proposal, "src", "app.js"), "proposal\n");
    const created = await runtime.createOperation(6, operationInput());
    await runtime.runPipeline(6, created.id);
    await writeFile(path.join(current.source, "src", "app.js"), "later work\n");
    const refused = await runtime.rollback(6, created.id);
    assert.equal(refused.rollback.status, "conflict");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /later work/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("validation timeout is reported as a warning and validation cancellation stops at a safe boundary", async () => {
  const timed = await fixture();
  const timedRuntime = createImplementationRuntime({
    baseDir: timed.runtimeRoot,
    proposalRuntime: timed.proposalRuntime,
    commandRunner: async (_command, args) => ({
      ok: !args.includes("build"),
      exitCode: args.includes("build") ? null : 0,
      durationMs: 10,
      output: args.includes("build") ? "timeout" : "ok",
      timedOut: args.includes("build"),
      cancelled: false
    })
  });
  try {
    await writeFile(path.join(timed.proposal, "src", "app.js"), "proposal\n");
    const created = await timedRuntime.createOperation(10, operationInput());
    const completed = await timedRuntime.runPipeline(10, created.id);
    assert.equal(completed.status, "completed_with_warnings");
    assert.match(completed.validationSummary.checks.find((entry) => entry.id === "build")?.summary ?? "", /tiempo/);
  } finally {
    await timedRuntime.dispose();
    await rm(timed.root, { recursive: true, force: true });
  }

  const cancelledFixture = await fixture();
  let releaseValidation;
  const validationStarted = new Promise((resolve) => { releaseValidation = resolve; });
  const cancelledRuntime = createImplementationRuntime({
    baseDir: cancelledFixture.runtimeRoot,
    proposalRuntime: cancelledFixture.proposalRuntime,
    commandRunner: async (_command, _args, options) => {
      releaseValidation();
      await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
      return { ok: false, exitCode: null, durationMs: 1, output: "cancelled", timedOut: false, cancelled: true };
    }
  });
  try {
    await writeFile(path.join(cancelledFixture.proposal, "src", "app.js"), "proposal\n");
    const created = await cancelledRuntime.createOperation(11, operationInput());
    const pipeline = cancelledRuntime.runPipeline(11, created.id);
    await validationStarted;
    await cancelledRuntime.cancel(11, created.id);
    const cancelled = await pipeline;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.validationSummary.status, "cancelled");
    assert.equal(cancelled.rollback.available, true);
    assert.match(await readFile(path.join(cancelledFixture.source, "src", "app.js"), "utf8"), /proposal/);
  } finally {
    await cancelledRuntime.dispose();
    await rm(cancelledFixture.root, { recursive: true, force: true });
  }
});

test("operations recover after restart without duplicate apply and creation is idempotent", async () => {
  const current = await fixture();
  await writeFile(path.join(current.proposal, "src", "app.js"), "proposal once\n");
  const first = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    commandRunner: async () => ({ ok: true, exitCode: 0, durationMs: 1, output: "ok", timedOut: false, cancelled: false })
  });
  const created = await first.createOperation(7, operationInput());
  const duplicate = await first.createOperation(7, operationInput());
  assert.equal(duplicate.id, created.id);
  await first.dispose();

  const restored = createImplementationRuntime({
    baseDir: current.runtimeRoot,
    proposalRuntime: current.proposalRuntime,
    commandRunner: async () => ({ ok: true, exitCode: 0, durationMs: 1, output: "ok", timedOut: false, cancelled: false })
  });
  try {
    await restored.initialize();
    const [pending] = await restored.list(7);
    assert.equal(pending.recoveryRequired, true);
    const completed = await restored.recover(7, pending.id);
    assert.equal(completed.status, "completed");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /proposal once/);
    const repeated = await restored.runPipeline(7, pending.id);
    assert.equal(repeated.status, "completed");
  } finally {
    await restored.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("same-project concurrency is blocked while different projects and pre-Apply cancellation remain safe", async () => {
  const current = await fixture();
  await writeFile(path.join(current.proposal, "src", "app.js"), "proposal\n");
  const runtime = createImplementationRuntime({ baseDir: current.runtimeRoot, proposalRuntime: current.proposalRuntime });
  try {
    const first = await runtime.createOperation(8, operationInput("project-a"));
    await assert.rejects(runtime.createOperation(8, { ...operationInput("project-a"), conversationId: "conversation-b" }), /implementación activa/);
    current.proposalRuntime.resolveApprovedRevision = async () => ({
      ...(await fixtureRevision(current)),
      approvedRevisionId: "different-project-revision"
    });
    const second = await runtime.createOperation(8, { ...operationInput("project-b"), conversationId: "conversation-b" });
    assert.notEqual(second.id, first.id);
    const cancelled = await runtime.cancel(8, first.id);
    assert.equal(cancelled.status, "cancelled");
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /current/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

async function fixtureRevision(current) {
  const files = ["src/app.js", "src/delete.txt", "src/old-name.txt", "src/run.sh", "package.json"];
  return {
    proposal: { id: "proposal-approved", instruction: "Revisión", selectionLabel: null, source: "text", updatedAt: new Date().toISOString() },
    approvedRevisionId: "revision",
    sourceRoot: current.source,
    workspaceRoot: current.proposal,
    baselineManifest: await manifest(current.source, files),
    proposalManifest: await manifest(current.proposal, files),
    diff: { files }
  };
}

test("path traversal in an approved revision is rejected before any operation is persisted", async () => {
  const current = await fixture();
  current.proposalRuntime.resolveApprovedRevision = async () => {
    const revision = await fixtureRevision(current);
    revision.proposalManifest["../escape.txt"] = { hash: "unsafe", size: 1, mode: 0o644 };
    return revision;
  };
  const runtime = createImplementationRuntime({ baseDir: current.runtimeRoot, proposalRuntime: current.proposalRuntime });
  try {
    await assert.rejects(runtime.createOperation(9, operationInput()), /ruta no permitida/i);
    assert.deepEqual(await runtime.list(9), []);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});

test("freeze rejects an approved file that changes after its manifest was produced", async () => {
  const current = await fixture();
  const originalResolver = current.proposalRuntime.resolveApprovedRevision;
  current.proposalRuntime.resolveApprovedRevision = async () => {
    const revision = await originalResolver();
    await writeFile(path.join(current.proposal, "src", "app.js"), "changed during freeze\n");
    return revision;
  };
  const runtime = createImplementationRuntime({ baseDir: current.runtimeRoot, proposalRuntime: current.proposalRuntime });
  try {
    await writeFile(path.join(current.proposal, "src", "app.js"), "approved content\n");
    await assert.rejects(runtime.createOperation(13, operationInput()), /cambió durante el freeze/);
    assert.deepEqual(await runtime.list(13), []);
    assert.match(await readFile(path.join(current.source, "src", "app.js"), "utf8"), /current/);
  } finally {
    await runtime.dispose();
    await rm(current.root, { recursive: true, force: true });
  }
});
