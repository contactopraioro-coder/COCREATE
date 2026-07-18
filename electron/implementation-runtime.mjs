import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { redactCodexDiagnostic } from "../shared/codex-upstream-contracts.js";

export const IMPLEMENTATION_IPC_CHANNELS = Object.freeze({
  availability: "cocreate:implementation:availability",
  list: "cocreate:implementation:list",
  create: "cocreate:implementation:create",
  start: "cocreate:implementation:start",
  resolveConflict: "cocreate:implementation:resolve-conflict",
  cancel: "cocreate:implementation:cancel",
  rollback: "cocreate:implementation:rollback",
  recover: "cocreate:implementation:recover",
  event: "cocreate:implementation:event"
});

const STORE_VERSION = 1;
const OPERATION_VERSION = 1;
const MAX_FILES = 20_000;
const MAX_OUTPUT_BYTES = 16_000;
const VALIDATION_TIMEOUT_MS = 4 * 60_000;
const ACTIVE_STATUSES = new Set(["queued", "preparing", "analyzing", "conflict", "applying", "validating", "refreshing"]);
const TERMINAL_STATUSES = new Set(["completed", "completed_with_warnings", "failed", "cancelled", "rolled_back"]);
const IGNORED_DIRECTORIES = new Set([".git", ".next", ".nuxt", ".turbo", ".cache", "build", "coverage", "dist", "node_modules", "release"]);
const SENSITIVE_NAMES = new Set([".npmrc", ".pypirc", "credentials", "credentials.json", "id_rsa", "id_ed25519", "service-account.json"]);
const HIGH_RISK_FILES = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pyproject\.toml|requirements[^/]*\.txt|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|composer\.json|Gemfile|vite\.config\.|next\.config\.|tsconfig\.json|Dockerfile|docker-compose\.)/i;

function timestamp() {
  return new Date().toISOString();
}

function safeText(value, fallback = "", limit = 500) {
  const output = redactCodexDiagnostic(String(value ?? ""), limit)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return output || fallback;
}

function safeIdentifier(value) {
  const identifier = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(identifier) ? identifier : "";
}

function sanitizedOutput(value, roots = []) {
  let output = redactCodexDiagnostic(String(value ?? ""), 32_000);
  for (const root of roots.filter(Boolean)) output = output.split(root).join("[workspace]");
  return output
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .slice(-MAX_OUTPUT_BYTES);
}

function isSensitiveRelativePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const base = (parts.at(-1) ?? "").toLowerCase();
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (SENSITIVE_NAMES.has(base) || /\.(pem|key|p12|pfx)$/i.test(base)) return true;
  return false;
}

function safeRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value).replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  if (isSensitiveRelativePath(normalized)) return null;
  return normalized;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function manifestFor(root) {
  const manifest = {};
  let fileCount = 0;
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isSensitiveRelativePath(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const filePath = path.join(root, relative);
      const info = await stat(filePath);
      manifest[relative] = { hash: await hashFile(filePath), size: info.size, mode: info.mode };
      fileCount += 1;
      if (fileCount > MAX_FILES) throw new Error(`El Project supera el límite seguro de ${MAX_FILES} archivos.`);
    }
  }
  await visit(root);
  return manifest;
}

async function isBinaryFile(filePath) {
  try {
    const buffer = await readFile(filePath);
    return buffer.subarray(0, 8_192).includes(0);
  } catch {
    return false;
  }
}

function riskFor(relative) {
  if (HIGH_RISK_FILES.test(relative)) return "high";
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip)$/i.test(relative)) return "binary";
  return "normal";
}

function sameManifestEntry(left, right) {
  if (!left && !right) return true;
  return Boolean(left && right && left.hash === right.hash && left.mode === right.mode);
}

function phaseLabel(status) {
  return ({
    queued: "Preparando implementación",
    preparing: "Preparando implementación",
    analyzing: "Analizando cambios",
    conflict: "Esperando resolución de conflictos",
    applying: "Aplicando cambios",
    validating: "Ejecutando validaciones",
    refreshing: "Actualizando la aplicación",
    completed: "Implementación completada",
    completed_with_warnings: "Implementación completada con advertencias",
    failed: "La implementación falló",
    cancelled: "Implementación cancelada",
    rolled_back: "Cambios revertidos"
  })[status] ?? "Implementación actualizada";
}

function publicOperation(record) {
  return {
    version: record.version,
    id: record.id,
    conversationId: record.conversationId,
    projectId: record.projectId,
    proposalId: record.proposalId,
    approvedRevisionId: record.approvedRevisionId,
    approvedRevision: { ...record.approvedRevision },
    status: record.status,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    changedFiles: [...record.changedFiles],
    diffSummary: {
      additions: record.diffSummary.additions,
      deletions: record.diffSummary.deletions,
      preview: record.diffSummary.preview,
      truncated: record.diffSummary.truncated,
      files: record.diffSummary.files.map((file) => ({ ...file }))
    },
    changeSet: record.changeSet.map((entry) => ({
      id: entry.id,
      path: entry.path,
      newPath: entry.newPath,
      kind: entry.kind,
      binary: entry.binary,
      size: entry.size,
      risk: entry.risk,
      applied: entry.applied,
      skipped: entry.skipped
    })),
    conflicts: record.conflicts.map((conflict) => ({ ...conflict })),
    validationSummary: {
      status: record.validationSummary.status,
      checks: record.validationSummary.checks.map((check) => ({ ...check }))
    },
    failure: record.failure ? { ...record.failure } : null,
    events: record.events.map((event) => ({ ...event })),
    progress: { ...record.progress },
    checkpoint: { ...record.checkpoint },
    rollback: { ...record.rollback },
    refresh: { ...record.refresh },
    repository: { ...record.repository },
    recoveryRequired: record.recoveryRequired === true,
    cancelRequested: record.cancelRequested === true,
    restored: record.restored === true
  };
}

function createChangeSet(revision) {
  const baseline = revision.baselineManifest;
  const proposal = revision.proposalManifest;
  const all = new Set([...Object.keys(baseline), ...Object.keys(proposal)]);
  const raw = [];
  for (const relative of [...all].sort()) {
    const before = baseline[relative];
    const after = proposal[relative];
    if (sameManifestEntry(before, after)) continue;
    const kind = !before ? "added" : !after ? "deleted" : "modified";
    raw.push({
      id: `change-${createHash("sha256").update(`${kind}:${relative}`).digest("hex").slice(0, 16)}`,
      path: relative,
      newPath: null,
      kind,
      baselineHash: before?.hash ?? null,
      proposalHash: after?.hash ?? null,
      size: after?.size ?? before?.size ?? 0,
      mode: after?.mode ?? before?.mode ?? 0o644,
      binary: false,
      risk: riskFor(relative),
      applied: false,
      skipped: false
    });
  }
  const additions = raw.filter((entry) => entry.kind === "added");
  const consumed = new Set();
  for (const deleted of raw.filter((entry) => entry.kind === "deleted")) {
    const renamed = additions.find((entry) => !consumed.has(entry.id) && entry.proposalHash === deleted.baselineHash);
    if (!renamed) continue;
    consumed.add(renamed.id);
    deleted.kind = "renamed";
    deleted.newPath = renamed.path;
    deleted.proposalHash = renamed.proposalHash;
    deleted.size = renamed.size;
    deleted.mode = renamed.mode;
    deleted.risk = renamed.risk === "high" || deleted.risk === "high" ? "high" : renamed.risk;
  }
  return raw.filter((entry) => !consumed.has(entry.id));
}

async function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const canSignalGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: canSignalGroup
    });
    let output = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let forceKill = null;
    const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-MAX_OUTPUT_BYTES); };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const signal = (name) => {
      try {
        if (canSignalGroup && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        // The process may have exited between the state check and the signal.
      }
    };
    const terminate = () => {
      signal("SIGTERM");
      forceKill = setTimeout(() => signal("SIGKILL"), 2_000);
      forceKill.unref?.();
    };
    const stop = () => {
      cancelled = true;
      terminate();
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? VALIDATION_TIMEOUT_MS);
    const finish = (exitCode, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", stop);
      resolve({
        ok: !error && exitCode === 0 && !timedOut && !cancelled,
        exitCode,
        durationMs: Date.now() - started,
        output: error ? `${output}\n${error.message}` : output,
        timedOut,
        cancelled,
        unavailable: error?.code === "ENOENT"
      });
    };
    child.once("error", (error) => finish(null, error));
    child.once("exit", (code) => finish(code));
  });
}

function safeProcessEnv() {
  const allowed = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "SHELL", "LANG", "LC_ALL", "TERM"];
  return {
    ...Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : [])),
    BROWSER: "none",
    CI: "1",
    NODE_ENV: "test"
  };
}

export function createImplementationRuntime(options = {}) {
  const baseDir = options.baseDir;
  const proposalRuntime = options.proposalRuntime;
  if (!baseDir) throw new TypeError("createImplementationRuntime requires baseDir.");
  if (!proposalRuntime?.resolveApprovedRevision) throw new TypeError("Implementation Runtime requires Proposal Runtime.");
  const storePath = path.join(baseDir, "implementation-runtime.json");
  const revisionsDir = path.join(baseDir, "revisions");
  const checkpointsDir = path.join(baseDir, "checkpoints");
  const operations = new Map();
  const listeners = new Set();
  const controllers = new Map();
  const projectLocks = new Map();
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const gitStatusRunner = options.gitStatusRunner ?? defaultCommandRunner;
  let initialized = false;
  let writeQueue = Promise.resolve();

  async function persist() {
    const payload = {
      version: STORE_VERSION,
      updatedAt: timestamp(),
      operations: [...operations.values()].map((record) => ({ ...record, ownerId: null, restored: false }))
    };
    writeQueue = writeQueue.then(async () => {
      await mkdir(baseDir, { recursive: true });
      const temporary = `${storePath}.tmp`;
      await writeFile(temporary, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, storePath);
    });
    await writeQueue;
  }

  function publish(record) {
    const snapshot = publicOperation(record);
    for (const listener of listeners) listener(record.ownerId, snapshot);
  }

  function event(record, type, label, detail = null, metadata = {}) {
    const now = timestamp();
    const item = {
      id: `implementation-event-${randomUUID()}`,
      type,
      label: safeText(label, phaseLabel(record.status), 180),
      detail: detail ? safeText(detail, "", 400) : null,
      timestamp: now,
      ...metadata
    };
    record.events.push(item);
    record.events = record.events.slice(-250);
    record.updatedAt = now;
    record.durationMs = record.startedAt ? Math.max(0, Date.parse(now) - Date.parse(record.startedAt)) : 0;
    publish(record);
    return item;
  }

  async function transition(record, status, type, label, detail = null, metadata = {}) {
    record.status = status;
    record.progress.phase = status;
    record.progress.label = label ?? phaseLabel(status);
    if (!record.startedAt && status !== "queued") record.startedAt = timestamp();
    if (TERMINAL_STATUSES.has(status)) record.completedAt = timestamp();
    event(record, type, label ?? phaseLabel(status), detail, metadata);
    await persist();
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    await mkdir(revisionsDir, { recursive: true });
    await mkdir(checkpointsDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      for (const candidate of Array.isArray(parsed?.operations) ? parsed.operations : []) {
        if (!candidate || candidate.version !== OPERATION_VERSION || typeof candidate.id !== "string") continue;
        const revisionRoot = typeof candidate.revisionRoot === "string" ? candidate.revisionRoot : "";
        const checkpointRoot = typeof candidate.checkpointRoot === "string" ? candidate.checkpointRoot : "";
        if (!isWithin(revisionsDir, revisionRoot) || !isWithin(checkpointsDir, checkpointRoot)) continue;
        const record = {
          ...candidate,
          ownerId: null,
          restored: true,
          recoveryRequired: ACTIVE_STATUSES.has(candidate.status),
          cancelRequested: false,
          failure: candidate.failure ?? null,
          conflicts: Array.isArray(candidate.conflicts) ? candidate.conflicts : [],
          events: Array.isArray(candidate.events) ? candidate.events.slice(-250) : [],
          diffSummary: {
            additions: candidate.diffSummary?.additions ?? 0,
            deletions: candidate.diffSummary?.deletions ?? 0,
            preview: candidate.diffSummary?.preview ?? "",
            truncated: candidate.diffSummary?.truncated === true,
            files: Array.isArray(candidate.diffSummary?.files) ? candidate.diffSummary.files : []
          },
          validationSummary: candidate.validationSummary?.checks ? candidate.validationSummary : { status: "idle", checks: [] },
          rollback: candidate.rollback ?? { available: false, status: "unavailable", verified: false, message: null },
          refresh: candidate.refresh ?? { status: "idle", target: null, message: null },
          repository: candidate.repository ?? { detected: false, statusAvailable: false, dirty: false, staged: 0, untracked: 0, operation: null }
        };
        operations.set(record.id, record);
        if (ACTIVE_STATUSES.has(record.status)) projectLocks.set(record.projectId, record.id);
      }
    } catch {
      // A missing or corrupt store starts empty; no filesystem changes are inferred.
    }
    await persist();
  }

  function owned(id, ownerId) {
    const record = operations.get(id);
    if (!record) throw new Error("La operación de implementación no existe.");
    if (record.ownerId === null) record.ownerId = ownerId;
    if (record.ownerId !== ownerId) throw new Error("La operación pertenece a otra ventana.");
    return record;
  }

  async function assertSafeDestination(root, relative) {
    const safe = safeRelativePath(relative);
    if (!safe) throw new Error(`Ruta de implementación no permitida: ${relative}`);
    const destination = path.join(root, safe);
    if (!isWithin(root, destination)) throw new Error(`Ruta fuera del Project: ${relative}`);
    let cursor = path.dirname(destination);
    while (cursor !== root && isWithin(root, cursor)) {
      if (await pathExists(cursor) && (await lstat(cursor)).isSymbolicLink()) throw new Error(`La ruta contiene un symlink: ${relative}`);
      cursor = path.dirname(cursor);
    }
    return { safe, destination };
  }

  async function copyApprovedFiles(record, revision) {
    await mkdir(record.revisionRoot, { recursive: true });
    for (const entry of record.changeSet) {
      const relative = entry.kind === "renamed" ? entry.newPath : entry.path;
      if (!relative || entry.kind === "deleted") continue;
      const safe = safeRelativePath(relative);
      if (!safe) throw new Error(`La revisión aprobada contiene una ruta no permitida: ${relative}`);
      const source = path.join(revision.workspaceRoot, safe);
      const destination = path.join(record.revisionRoot, safe);
      if (!isWithin(revision.workspaceRoot, source) || !await pathExists(source)) throw new Error(`Falta el archivo aprobado: ${relative}`);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`El archivo aprobado no es seguro: ${relative}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      await chmod(destination, entry.mode & 0o777);
      if (await hashFile(destination) !== entry.proposalHash) {
        throw new Error(`El archivo aprobado cambió durante el freeze: ${relative}`);
      }
      entry.binary = await isBinaryFile(source);
    }
    await writeFile(path.join(record.revisionRoot, "revision.json"), JSON.stringify({
      version: 1,
      approvedRevisionId: record.approvedRevisionId,
      proposalId: record.proposalId,
      files: record.changeSet.map(({ path: filePath, newPath, kind, proposalHash }) => ({ path: filePath, newPath, kind, proposalHash }))
    }, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  async function createOperation(ownerId, input) {
    await initialize();
    const conversationId = safeIdentifier(input?.conversationId);
    const projectId = safeIdentifier(input?.projectId);
    const proposalId = safeIdentifier(input?.proposalId);
    if (!conversationId || !projectId || !proposalId) throw new Error("Conversation, Project y Proposal son obligatorios para implementar.");
    const existing = [...operations.values()].find((entry) => entry.proposalId === proposalId && entry.conversationId === conversationId);
    if (existing) {
      if (existing.ownerId === null) existing.ownerId = ownerId;
      if (existing.ownerId !== ownerId) throw new Error("La implementación pertenece a otra ventana.");
      return publicOperation(existing);
    }
    const activeId = projectLocks.get(projectId);
    if (activeId && ACTIVE_STATUSES.has(operations.get(activeId)?.status)) throw new Error("Ya existe una implementación activa para este Project.");
    const revision = await proposalRuntime.resolveApprovedRevision(proposalId, ownerId);
    const duplicate = [...operations.values()].find((entry) => entry.approvedRevisionId === revision.approvedRevisionId && entry.conversationId === conversationId);
    if (duplicate) {
      if (duplicate.ownerId === null) duplicate.ownerId = ownerId;
      if (duplicate.ownerId !== ownerId) throw new Error("La revisión aprobada pertenece a otra ventana.");
      return publicOperation(duplicate);
    }
    const id = `implementation-${randomUUID()}`;
    const createdAt = timestamp();
    const changeSet = createChangeSet(revision);
    const record = {
      version: OPERATION_VERSION,
      id,
      ownerId,
      conversationId,
      projectId,
      proposalId,
      approvedRevisionId: revision.approvedRevisionId,
      approvedRevision: {
        instruction: safeText(revision.proposal.instruction, "Proposal aprobada", 4_000),
        selectionLabel: revision.proposal.selectionLabel ? safeText(revision.proposal.selectionLabel, "", 120) : null,
        source: revision.proposal.source,
        approvedAt: revision.proposal.updatedAt
      },
      status: "queued",
      sourceRoot: revision.sourceRoot,
      revisionRoot: path.join(revisionsDir, id),
      checkpointRoot: path.join(checkpointsDir, id),
      baselineManifest: revision.baselineManifest,
      proposalManifest: revision.proposalManifest,
      analyzedCurrentManifest: null,
      checkpointManifest: null,
      postApplyManifest: null,
      createdAt,
      startedAt: null,
      updatedAt: createdAt,
      completedAt: null,
      durationMs: 0,
      changedFiles: changeSet.flatMap((entry) => entry.newPath ? [entry.path, entry.newPath] : [entry.path]),
      diffSummary: {
        additions: Number.isFinite(revision.diff?.additions) ? revision.diff.additions : 0,
        deletions: Number.isFinite(revision.diff?.deletions) ? revision.diff.deletions : 0,
        preview: sanitizedOutput(revision.diff?.preview ?? "", [revision.sourceRoot, revision.workspaceRoot]),
        truncated: String(revision.diff?.preview ?? "").length > MAX_OUTPUT_BYTES,
        files: Array.isArray(revision.diff?.filePreviews) ? revision.diff.filePreviews.slice(0, 200).map((file) => {
          const change = changeSet.find((entry) => entry.path === file.path || entry.newPath === file.path);
          return {
            path: file.path,
            kind: change?.kind ?? "modified",
            additions: Number.isFinite(file.additions) ? file.additions : 0,
            deletions: Number.isFinite(file.deletions) ? file.deletions : 0,
            preview: sanitizedOutput(file.preview ?? "", [revision.sourceRoot, revision.workspaceRoot])
          };
        }) : []
      },
      changeSet,
      conflicts: [],
      validationSummary: { status: "idle", checks: [] },
      failure: null,
      events: [],
      progress: { phase: "queued", label: "Preparando implementación", completed: 0, total: changeSet.length },
      checkpoint: { available: false, verified: false, createdAt: null },
      rollback: { available: false, status: "unavailable", verified: false, message: null },
      refresh: { status: "idle", target: null, message: null },
      repository: { detected: false, statusAvailable: false, dirty: false, staged: 0, untracked: 0, operation: null },
      cancelRequested: false,
      recoveryRequired: false,
      restored: false
    };
    operations.set(id, record);
    projectLocks.set(projectId, id);
    try {
      await copyApprovedFiles(record, revision);
      event(record, "implementation.revision.frozen", "Versión aprobada congelada", null, { approvedRevisionId: record.approvedRevisionId });
      event(record, "implementation.started", "Implementación preparada");
      await persist();
      return publicOperation(record);
    } catch (cause) {
      operations.delete(id);
      projectLocks.delete(projectId);
      await rm(record.revisionRoot, { recursive: true, force: true }).catch(() => undefined);
      throw cause;
    }
  }

  async function repositoryState(root) {
    const gitDir = path.join(root, ".git");
    if (!await pathExists(gitDir)) return { repository: false, operation: null, statusAvailable: false, entries: [] };
    const markers = [
      ["MERGE_HEAD", "merge"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["rebase-merge", "rebase"],
      ["rebase-apply", "rebase"]
    ];
    for (const [marker, operation] of markers) {
      if (await pathExists(path.join(gitDir, marker))) return { repository: true, operation, statusAvailable: true, entries: [] };
    }
    const result = await gitStatusRunner("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: root,
      env: safeProcessEnv(),
      timeoutMs: 10_000
    });
    if (!result.ok) return { repository: true, operation: null, statusAvailable: false, entries: [] };
    const entries = String(result.output ?? "").split("\0").flatMap((line) => {
      if (!/^[ MADRCU?!]{2} /.test(line)) return [];
      const relative = safeRelativePath(line.slice(3));
      if (!relative) return [];
      const code = line.slice(0, 2);
      return [{ path: relative, code, staged: code[0] !== " " && code[0] !== "?", untracked: code === "??" }];
    });
    return { repository: true, operation: null, statusAvailable: true, entries };
  }

  function conflictFor(record, entry, currentManifest) {
    const current = currentManifest[entry.path] ?? null;
    const baseline = record.baselineManifest[entry.path] ?? null;
    const proposal = entry.kind === "renamed"
      ? record.proposalManifest[entry.newPath] ?? null
      : record.proposalManifest[entry.path] ?? null;
    if (["added", "modified"].includes(entry.kind) && sameManifestEntry(current, proposal)) {
      entry.skipped = true;
      return null;
    }
    if (entry.kind === "renamed") {
      const currentTarget = currentManifest[entry.newPath] ?? null;
      if (current?.hash === baseline?.hash && !currentTarget) return null;
      if (!current && sameManifestEntry(currentTarget, proposal)) {
        entry.skipped = true;
        return null;
      }
    } else if (sameManifestEntry(current, baseline)) {
      return null;
    }
    return {
      id: `conflict-${randomUUID()}`,
      changeId: entry.id,
      path: entry.path,
      newPath: entry.newPath,
      severity: entry.risk === "high" ? "blocking" : "requires_review",
      kind: entry.kind,
      currentState: current ? "modified" : "missing",
      proposalState: proposal ? entry.kind : "deleted",
      risk: entry.risk === "high" ? "Este archivo controla dependencias o configuración." : "Ambos lados cambiaron desde que nació la Proposal.",
      recommendation: entry.risk === "high" ? "Revisa el archivo antes de elegir una versión." : "Conserva Current si el cambio externo debe prevalecer.",
      resolution: null
    };
  }

  async function analyze(record) {
    await transition(record, "analyzing", "implementation.analysis.started", "Analizando cambios");
    const currentManifest = await manifestFor(record.sourceRoot);
    record.analyzedCurrentManifest = currentManifest;
    for (const entry of record.changeSet) {
      if (!entry.applied) entry.skipped = false;
    }
    record.conflicts = record.changeSet.flatMap((entry) => {
      const conflict = conflictFor(record, entry, currentManifest);
      return conflict ? [conflict] : [];
    });
    const git = await repositoryState(record.sourceRoot);
    record.repository = {
      detected: git.repository,
      statusAvailable: git.statusAvailable,
      dirty: git.entries.length > 0,
      staged: git.entries.filter((entry) => entry.staged).length,
      untracked: git.entries.filter((entry) => entry.untracked).length,
      operation: git.operation
    };
    if (git.operation) {
      record.conflicts.push({
        id: `conflict-${randomUUID()}`,
        changeId: null,
        path: "Estado del repositorio",
        newPath: null,
        severity: "blocking",
        kind: "repository_state",
        currentState: git.operation,
        proposalState: "pending",
        risk: `Hay una operación Git en curso (${git.operation}).`,
        recommendation: "Termina o cancela esa operación fuera de CoCreate antes de continuar.",
        resolution: null
      });
    }
    const relevantPaths = new Set(record.changeSet.flatMap((entry) => entry.newPath ? [entry.path, entry.newPath] : [entry.path]));
    for (const entry of git.entries.filter((candidate) => relevantPaths.has(candidate.path))) {
      if (record.conflicts.some((conflict) => conflict.path === entry.path)) continue;
      const change = record.changeSet.find((candidate) => candidate.path === entry.path || candidate.newPath === entry.path);
      const highRisk = change?.risk === "high";
      record.conflicts.push({
        id: `conflict-${randomUUID()}`,
        changeId: change?.id ?? null,
        path: entry.path,
        newPath: change?.newPath ?? null,
        severity: highRisk ? "blocking" : "requires_review",
        kind: "git_worktree",
        currentState: entry.untracked ? "untracked" : entry.staged ? "staged" : "modified",
        proposalState: change?.kind ?? "modified",
        risk: entry.untracked ? "Current contiene un archivo sin seguimiento en este mismo path." : entry.staged ? "Este archivo ya contiene cambios preparados en Git." : "Este archivo tiene cambios locales relevantes.",
        recommendation: "Revisa si el trabajo local debe conservarse antes de aplicar Proposal.",
        resolution: null
      });
    }
    event(record, "implementation.analysis.completed", `Analizados ${record.changeSet.length} archivos`, null, { fileCount: record.changeSet.length });
    if (record.conflicts.some((conflict) => !conflict.resolution)) {
      await transition(record, "conflict", "implementation.conflict.detected", "Encontré cambios que se cruzan con la propuesta", null, { conflictCount: record.conflicts.length });
      return false;
    }
    await persist();
    return true;
  }

  async function createCheckpoint(record) {
    if (record.checkpoint.available) return;
    const filesRoot = path.join(record.checkpointRoot, "files");
    await mkdir(filesRoot, { recursive: true });
    const paths = new Set(record.changeSet.flatMap((entry) => entry.newPath ? [entry.path, entry.newPath] : [entry.path]));
    const entries = [];
    for (const relative of paths) {
      const { safe, destination } = await assertSafeDestination(record.sourceRoot, relative);
      const existed = await pathExists(destination);
      const backupPath = path.join(filesRoot, safe);
      let mode = null;
      if (existed) {
        const info = await lstat(destination);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Current contiene una ruta no segura: ${safe}`);
        mode = info.mode;
        await mkdir(path.dirname(backupPath), { recursive: true });
        await copyFile(destination, backupPath);
      }
      entries.push({ relative: safe, existed, backupPath, mode, hash: existed ? await hashFile(destination) : null });
    }
    record.checkpointEntries = entries;
    record.checkpointManifest = Object.fromEntries(entries.map((entry) => [entry.relative, entry.hash]));
    record.checkpoint = { available: true, verified: true, createdAt: timestamp() };
    record.rollback = { available: true, status: "available", verified: true, message: null };
    event(record, "implementation.checkpoint.created", "Checkpoint recuperable creado");
    await persist();
  }

  async function restoreCheckpoint(record) {
    if (!record.checkpoint.available || !Array.isArray(record.checkpointEntries)) {
      return { status: "failed", verified: false, message: "No existe un checkpoint recuperable." };
    }
    let failures = 0;
    for (const entry of [...record.checkpointEntries].reverse()) {
      try {
        const { destination } = await assertSafeDestination(record.sourceRoot, entry.relative);
        if (entry.existed) {
          await mkdir(path.dirname(destination), { recursive: true });
          const temporary = `${destination}.cocreate-rollback-${randomUUID()}.tmp`;
          await copyFile(entry.backupPath, temporary);
          await rename(temporary, destination);
          if (entry.mode) await chmod(destination, entry.mode);
        } else {
          await rm(destination, { force: true });
        }
      } catch {
        failures += 1;
      }
    }
    let verified = failures === 0;
    for (const entry of record.checkpointEntries) {
      const destination = path.join(record.sourceRoot, entry.relative);
      const exists = await pathExists(destination);
      const actualHash = exists ? await hashFile(destination).catch(() => null) : null;
      const actualMode = exists ? (await stat(destination).catch(() => null))?.mode ?? null : null;
      if (actualHash !== entry.hash || (entry.existed && actualMode !== entry.mode)) verified = false;
    }
    return {
      status: verified ? "completed" : failures ? "partial" : "failed",
      verified,
      message: verified ? "El workspace regresó al checkpoint." : failures ? "Algunos archivos no pudieron restaurarse." : "No pude verificar la restauración."
    };
  }

  async function applyChange(record, entry) {
    const targetRelative = entry.kind === "renamed" ? entry.newPath : entry.path;
    if (!targetRelative) throw new Error(`El cambio ${entry.path} no tiene destino.`);
    const target = await assertSafeDestination(record.sourceRoot, targetRelative);
    const source = path.join(record.revisionRoot, target.safe);
    if (entry.kind !== "deleted") {
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`La revisión contiene una ruta no segura: ${target.safe}`);
      await mkdir(path.dirname(target.destination), { recursive: true });
      const temporary = `${target.destination}.cocreate-${randomUUID()}.tmp`;
      await copyFile(source, temporary);
      await chmod(temporary, entry.mode || 0o644);
      await rename(temporary, target.destination);
    } else {
      await rm(target.destination, { force: true });
    }
    if (entry.kind === "renamed" && entry.path !== entry.newPath) {
      const original = await assertSafeDestination(record.sourceRoot, entry.path);
      await rm(original.destination, { force: true });
    }
  }

  async function verifyNoExternalChange(record, entry) {
    const conflict = record.conflicts.find((candidate) => candidate.changeId === entry.id);
    if (conflict?.resolution === "proposal") return;
    const relative = entry.path;
    const expected = record.analyzedCurrentManifest?.[relative] ?? null;
    const destination = path.join(record.sourceRoot, relative);
    const actual = await pathExists(destination)
      ? { hash: await hashFile(destination), mode: (await stat(destination)).mode }
      : null;
    if (!sameManifestEntry(actual, expected)) throw new Error(`Current cambió durante Apply: ${relative}`);
  }

  async function apply(record) {
    await createCheckpoint(record);
    await transition(record, "applying", "implementation.apply.started", "Aplicando cambios");
    try {
      for (const entry of record.changeSet) {
        const resolution = record.conflicts.find((conflict) => conflict.changeId === entry.id)?.resolution;
        if (entry.skipped || resolution === "current") {
          entry.skipped = true;
          continue;
        }
        if (record.cancelRequested) throw Object.assign(new Error("Cancelación solicitada."), { code: "IMPLEMENTATION_CANCELLED" });
        await verifyNoExternalChange(record, entry);
        await options.beforeApplyFile?.({ operationId: record.id, entry: { ...entry } });
        await applyChange(record, entry);
        entry.applied = true;
        record.progress.completed = record.changeSet.filter((candidate) => candidate.applied || candidate.skipped).length;
        event(record, "implementation.file.applied", `Aplicado ${entry.newPath ?? entry.path}`, null, { path: entry.newPath ?? entry.path });
        await persist();
      }
      const current = await manifestFor(record.sourceRoot);
      record.postApplyManifest = Object.fromEntries(record.changedFiles.map((relative) => [relative, current[relative] ?? null]));
      record.rollback = {
        available: record.checkpoint.available,
        status: record.checkpoint.available ? "available" : "unavailable",
        verified: false,
        message: null
      };
      await persist();
      return true;
    } catch (cause) {
      const rollback = await restoreCheckpoint(record);
      record.rollback = { available: !rollback.verified && record.checkpoint.available, status: rollback.status, verified: rollback.verified, message: rollback.message };
      const cancelled = cause?.code === "IMPLEMENTATION_CANCELLED";
      record.failure = {
        code: cancelled ? "IMPLEMENTATION_CANCELLED" : "IMPLEMENTATION_APPLY_FAILED",
        message: safeText(cause instanceof Error ? cause.message : cause, "No pude aplicar los cambios."),
        phase: "applying",
        rollbackStatus: rollback.status,
        retriable: rollback.verified
      };
      await transition(
        record,
        cancelled ? "cancelled" : "failed",
        cancelled ? "implementation.cancelled" : "implementation.failed",
        cancelled ? "Implementación cancelada" : rollback.verified ? "Apply falló; los cambios fueron revertidos" : "Apply falló y el rollback necesita revisión",
        record.failure.message
      );
      return false;
    }
  }

  async function validationDefinitions(root) {
    if (await pathExists(path.join(root, "package.json"))) {
      const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8").catch(() => "{}"));
      const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
      const manager = await pathExists(path.join(root, "pnpm-lock.yaml")) ? "pnpm"
        : await pathExists(path.join(root, "yarn.lock")) ? "yarn"
          : await pathExists(path.join(root, "bun.lockb")) || await pathExists(path.join(root, "bun.lock")) ? "bun"
            : "npm";
      return [
        ["typecheck", "Typecheck"],
        ["lint", "Lint"],
        ["test", "Tests"],
        ["build", "Build"]
      ].map(([script, label]) => ({
        id: script,
        label,
        available: typeof scripts[script] === "string",
        command: manager,
        args: manager === "yarn" ? [script] : ["run", script]
      }));
    }
    if (await pathExists(path.join(root, "pyproject.toml"))) {
      return [{
        id: "python-compile",
        label: "Python compile",
        available: true,
        command: "python3",
        args: ["-m", "compileall", "-q", "."]
      }];
    }
    if (await pathExists(path.join(root, "Cargo.toml"))) {
      return [
        { id: "cargo-check", label: "Cargo check", available: true, command: "cargo", args: ["check"] },
        { id: "cargo-test", label: "Cargo tests", available: true, command: "cargo", args: ["test"] }
      ];
    }
    if (await pathExists(path.join(root, "go.mod"))) {
      return [{ id: "go-test", label: "Go tests", available: true, command: "go", args: ["test", "./..."] }];
    }
    return [{
      id: "project-validation",
      label: "Project validation",
      available: false,
      command: null,
      args: []
    }];
  }

  async function validate(record) {
    await transition(record, "validating", "implementation.validation.started", "Ejecutando validaciones");
    const definitions = await validationDefinitions(record.sourceRoot);
    const controller = new AbortController();
    controllers.set(record.id, controller);
    record.validationSummary = { status: "running", checks: [] };
    try {
      for (const definition of definitions) {
        if (!definition.available) {
          record.validationSummary.checks.push({
            id: definition.id,
            label: definition.label,
            command: null,
            durationMs: 0,
            status: "unavailable",
            summary: "El Project no define esta validación.",
            error: null,
            evidence: "",
            recommendation: null
          });
          continue;
        }
        if (record.cancelRequested) controller.abort();
        event(record, "implementation.validation.started", `Ejecutando ${definition.label}`, null, { check: definition.id });
        const result = await commandRunner(definition.command, definition.args, {
          cwd: record.sourceRoot,
          env: safeProcessEnv(),
          timeoutMs: VALIDATION_TIMEOUT_MS,
          signal: controller.signal
        });
        const status = result.cancelled ? "cancelled" : result.unavailable ? "unavailable" : result.timedOut ? "failed" : result.ok ? "passed" : "failed";
        const check = {
          id: definition.id,
          label: definition.label,
          command: `${definition.command} ${definition.args.join(" ")}`,
          durationMs: result.durationMs,
          status,
          summary: status === "passed" ? `${definition.label} pasó.` : status === "unavailable" ? `${definition.label} no está disponible en este entorno.` : result.timedOut ? `${definition.label} excedió el tiempo permitido.` : status === "cancelled" ? `${definition.label} fue cancelado.` : `${definition.label} falló.`,
          error: status === "failed" ? safeText(result.output, `${definition.label} falló.`, 500) : null,
          evidence: sanitizedOutput(result.output, [record.sourceRoot, record.revisionRoot, record.checkpointRoot]),
          recommendation: status === "failed" ? "Revisa el error o pide a CoCreate una corrección acotada." : null
        };
        record.validationSummary.checks.push(check);
        event(record, "implementation.validation.completed", check.summary, null, { check: definition.id, result: status });
        await persist();
        if (status === "cancelled") break;
      }
    } finally {
      controllers.delete(record.id);
    }
    if (record.validationSummary.checks.some((check) => check.status === "cancelled")) {
      record.validationSummary.status = "cancelled";
      await transition(record, "cancelled", "implementation.cancelled", "Validación cancelada; los cambios aplicados se conservaron");
      return false;
    }
    if (record.validationSummary.checks.some((check) => check.status === "failed")) {
      record.validationSummary.status = "failed";
      return true;
    }
    const passed = record.validationSummary.checks.filter((check) => check.status === "passed");
    record.validationSummary.status = passed.length ? "passed" : "unavailable";
    await persist();
    return true;
  }

  async function refresh(record) {
    await transition(record, "refreshing", "implementation.refresh.started", "Actualizando la aplicación");
    const available = await stat(record.sourceRoot).then((info) => info.isDirectory()).catch(() => false);
    record.refresh = available
      ? { status: "completed", target: "workspace", message: "El workspace principal refleja la revisión aprobada." }
      : { status: "failed", target: null, message: "El workspace principal ya no está disponible." };
    event(record, "implementation.refresh.completed", record.refresh.message, null, { result: record.refresh.status });
    await persist();
  }

  async function runPipeline(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (TERMINAL_STATUSES.has(record.status)) return publicOperation(record);
    const unresolvedConflicts = record.conflicts.filter((conflict) => !conflict.resolution);
    const retryingRepositoryState = record.status === "conflict"
      && unresolvedConflicts.length > 0
      && unresolvedConflicts.every((conflict) => !conflict.changeId && conflict.kind === "repository_state");
    if (record.status === "conflict" && unresolvedConflicts.length > 0 && !retryingRepositoryState) return publicOperation(record);
    const continuingResolvedConflict = record.status === "conflict" && unresolvedConflicts.length === 0;
    const activeId = projectLocks.get(record.projectId);
    if (activeId && activeId !== record.id && ACTIVE_STATUSES.has(operations.get(activeId)?.status)) throw new Error("Otra implementación está usando este Project.");
    projectLocks.set(record.projectId, record.id);
    record.recoveryRequired = false;
    try {
      await transition(record, "preparing", "implementation.preparing", "Preparando los cambios");
      if (!continuingResolvedConflict) {
        if (retryingRepositoryState) event(record, "implementation.conflict.recheck", "Volviendo a comprobar el estado del repositorio");
        const canApply = await analyze(record);
        if (!canApply) return publicOperation(record);
      } else {
        event(record, "implementation.conflict.review.completed", "Conflictos resueltos; continuaré con las decisiones aprobadas");
        await persist();
      }
      if (!await apply(record)) return publicOperation(record);
      if (!await validate(record)) return publicOperation(record);
      await refresh(record);
      const warnings = record.validationSummary.status !== "passed" || record.refresh.status !== "completed";
      await proposalRuntime.finalizeImplementation(record.proposalId, ownerId).catch((cause) => {
        record.events.push({
          id: `implementation-event-${randomUUID()}`,
          type: "implementation.proposal.cleanup.warning",
          label: "La implementación terminó, pero la Proposal necesita limpieza posterior",
          detail: safeText(cause instanceof Error ? cause.message : cause, "", 300),
          timestamp: timestamp()
        });
      });
      record.rollback.available = record.checkpoint.available;
      record.rollback.status = record.checkpoint.available ? "available" : "unavailable";
      await transition(
        record,
        warnings ? "completed_with_warnings" : "completed",
        "implementation.completed",
        warnings ? "Implementación completada con advertencias" : "Implementación completada",
        null,
        { fileCount: record.changeSet.filter((entry) => entry.applied).length, validationStatus: record.validationSummary.status }
      );
      return publicOperation(record);
    } catch (cause) {
      record.failure = {
        code: "IMPLEMENTATION_PIPELINE_FAILED",
        message: safeText(cause instanceof Error ? cause.message : cause, "No pude completar la implementación."),
        phase: record.status,
        rollbackStatus: record.rollback.status,
        retriable: record.status !== "applying"
      };
      await transition(record, "failed", "implementation.failed", "No pude completar la implementación", record.failure.message);
      return publicOperation(record);
    } finally {
      if (TERMINAL_STATUSES.has(record.status)) projectLocks.delete(record.projectId);
    }
  }

  async function resolveConflict(ownerId, id, conflictId, resolution) {
    const record = owned(id, ownerId);
    if (record.status !== "conflict") throw new Error("La operación no está esperando conflictos.");
    const conflict = record.conflicts.find((entry) => entry.id === conflictId);
    if (!conflict) throw new Error("El conflicto ya no existe.");
    if (resolution === "cancel") return cancel(ownerId, id);
    if (!conflict.changeId) throw new Error("Este conflicto debe resolverse fuera de CoCreate antes de continuar.");
    if (!new Set(["current", "proposal"]).has(resolution)) throw new Error("Resolución de conflicto no válida.");
    conflict.resolution = resolution;
    event(record, "implementation.conflict.resolved", resolution === "current" ? `Se conservará Current en ${conflict.path}` : `Se usará Proposal en ${conflict.path}`, null, { conflictId, resolution });
    await persist();
    return publicOperation(record);
  }

  async function cancel(ownerId, id) {
    const record = owned(id, ownerId);
    if (TERMINAL_STATUSES.has(record.status)) return publicOperation(record);
    record.cancelRequested = true;
    controllers.get(id)?.abort();
    if (["queued", "preparing", "analyzing", "conflict"].includes(record.status)) {
      await transition(record, "cancelled", "implementation.cancelled", "Implementación cancelada antes de Apply");
      projectLocks.delete(record.projectId);
    } else {
      event(record, "implementation.cancel.requested", "Cancelación solicitada; terminaré el paso atómico actual");
      await persist();
    }
    return publicOperation(record);
  }

  async function rollback(ownerId, id) {
    const record = owned(id, ownerId);
    if (!record.checkpoint.available || !record.postApplyManifest) throw new Error("Esta implementación no tiene un rollback seguro disponible.");
    if (ACTIVE_STATUSES.has(record.status)) throw new Error("Espera a que termine la operación antes de revertirla.");
    const laterChanges = [];
    for (const [relative, expected] of Object.entries(record.postApplyManifest)) {
      const candidate = path.join(record.sourceRoot, relative);
      const actual = await pathExists(candidate)
        ? { hash: await hashFile(candidate), mode: (await stat(candidate)).mode }
        : null;
      if (!sameManifestEntry(actual, expected)) laterChanges.push(relative);
    }
    if (laterChanges.length) {
      record.rollback = { available: false, status: "conflict", verified: false, message: "Hay cambios posteriores que impiden una reversión segura." };
      record.conflicts.push(...laterChanges.map((relative) => ({
        id: `conflict-${randomUUID()}`,
        changeId: null,
        path: relative,
        newPath: null,
        severity: "blocking",
        kind: "rollback_conflict",
        currentState: "changed_after_implementation",
        proposalState: "checkpoint",
        risk: "Revertir podría destruir trabajo posterior.",
        recommendation: "Revisa el archivo y revierte manualmente solo el cambio deseado.",
        resolution: null
      })));
      event(record, "implementation.rollback.conflict", "No es seguro revertir automáticamente", null, { conflictCount: laterChanges.length });
      await persist();
      return publicOperation(record);
    }
    record.cancelRequested = false;
    event(record, "implementation.rollback.started", "Revirtiendo esta implementación");
    const restored = await restoreCheckpoint(record);
    record.rollback = { available: false, status: restored.status, verified: restored.verified, message: restored.message };
    if (!restored.verified) {
      record.failure = { code: "IMPLEMENTATION_ROLLBACK_FAILED", message: restored.message, phase: "rollback", rollbackStatus: restored.status, retriable: false };
      await transition(record, "failed", "implementation.rollback.failed", restored.status === "partial" ? "Rollback parcial" : "El rollback falló", restored.message);
      return publicOperation(record);
    }
    record.postApplyManifest = null;
    record.validationSummary = { status: "idle", checks: [] };
    if (!await validate(record)) return publicOperation(record);
    await refresh(record);
    record.refresh = { status: "completed", target: "workspace", message: "Current volvió al estado anterior a la implementación." };
    await transition(
      record,
      "rolled_back",
      "implementation.rollback.completed",
      record.validationSummary.status === "failed" ? "Cambios revertidos; una validación necesita atención" : "Cambios revertidos correctamente"
    );
    projectLocks.delete(record.projectId);
    return publicOperation(record);
  }

  async function recover(ownerId, id) {
    const record = owned(id, ownerId);
    if (!record.recoveryRequired) return publicOperation(record);
    record.recoveryRequired = false;
    if (record.status === "applying") {
      const appliedCount = record.changeSet.filter((entry) => entry.applied || entry.skipped).length;
      if (appliedCount === record.changeSet.length && record.postApplyManifest) {
        if (!await validate(record)) return publicOperation(record);
        await refresh(record);
        const warnings = record.validationSummary.status !== "passed" || record.refresh.status !== "completed";
        await proposalRuntime.finalizeImplementation(record.proposalId, ownerId).catch(() => undefined);
        record.rollback.available = record.checkpoint.available;
        record.rollback.status = record.checkpoint.available ? "available" : "unavailable";
        await transition(record, warnings ? "completed_with_warnings" : "completed", "implementation.recovery.completed", warnings ? "Implementación recuperada con advertencias" : "Implementación recuperada y completada");
        projectLocks.delete(record.projectId);
        return publicOperation(record);
      }
      const restored = await restoreCheckpoint(record);
      record.rollback = { available: restored.verified, status: restored.status, verified: restored.verified, message: restored.message };
      await transition(record, restored.verified ? "rolled_back" : "failed", "implementation.recovery.completed", restored.verified ? "La operación interrumpida fue revertida al checkpoint" : "La recuperación necesita revisión", restored.message);
      projectLocks.delete(record.projectId);
      return publicOperation(record);
    }
    if (record.status === "validating") {
      if (!await validate(record)) return publicOperation(record);
      await refresh(record);
      const warnings = record.validationSummary.status !== "passed" || record.refresh.status !== "completed";
      await proposalRuntime.finalizeImplementation(record.proposalId, ownerId).catch(() => undefined);
      await transition(record, warnings ? "completed_with_warnings" : "completed", "implementation.recovery.completed", warnings ? "Implementación recuperada con advertencias" : "Implementación recuperada y completada");
      projectLocks.delete(record.projectId);
      return publicOperation(record);
    }
    if (record.status === "refreshing") {
      await refresh(record);
      const warnings = record.validationSummary.status !== "passed" || record.refresh.status !== "completed";
      await proposalRuntime.finalizeImplementation(record.proposalId, ownerId).catch(() => undefined);
      await transition(record, warnings ? "completed_with_warnings" : "completed", "implementation.recovery.completed", warnings ? "Implementación recuperada con advertencias" : "Implementación recuperada y completada");
      projectLocks.delete(record.projectId);
      return publicOperation(record);
    }
    return runPipeline(ownerId, id);
  }

  async function list(ownerId, conversationId = null) {
    await initialize();
    const output = [];
    for (const record of operations.values()) {
      if (record.ownerId === null) record.ownerId = ownerId;
      if (record.ownerId !== ownerId) continue;
      if (conversationId && record.conversationId !== conversationId) continue;
      output.push(publicOperation(record));
    }
    return output.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function dispose() {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    await persist().catch(() => undefined);
  }

  return {
    initialize,
    list,
    createOperation,
    runPipeline,
    resolveConflict,
    cancel,
    rollback,
    recover,
    subscribe,
    dispose,
    _operations: operations
  };
}

export function registerImplementationRuntimeIpc({ ipcMain, browserWindow, runtime }) {
  const ownerId = (event) => browserWindow.fromWebContents(event.sender)?.id ?? null;
  const withOwner = (event) => {
    const resolved = ownerId(event);
    if (!resolved) throw new Error("No pude verificar la ventana propietaria de la implementación.");
    return resolved;
  };
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.availability, async () => ({ available: true, environment: "desktop", reason: null }));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.list, (event, payload) => runtime.list(withOwner(event), payload?.conversationId ?? null));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.create, (event, payload) => runtime.createOperation(withOwner(event), payload));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.start, (event, payload) => runtime.runPipeline(withOwner(event), payload?.id));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.resolveConflict, (event, payload) => runtime.resolveConflict(withOwner(event), payload?.id, payload?.conflictId, payload?.resolution));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.cancel, (event, payload) => runtime.cancel(withOwner(event), payload?.id));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.rollback, (event, payload) => runtime.rollback(withOwner(event), payload?.id));
  ipcMain.handle(IMPLEMENTATION_IPC_CHANNELS.recover, (event, payload) => runtime.recover(withOwner(event), payload?.id));
  const unsubscribe = runtime.subscribe((windowId, operation) => {
    if (!windowId) return;
    browserWindow.fromId(windowId)?.webContents.send(IMPLEMENTATION_IPC_CHANNELS.event, operation);
  });
  return () => {
    unsubscribe();
    for (const channel of Object.values(IMPLEMENTATION_IPC_CHANNELS)) {
      if (channel !== IMPLEMENTATION_IPC_CHANNELS.event) ipcMain.removeHandler(channel);
    }
  };
}
