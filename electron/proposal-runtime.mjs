import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { redactCodexDiagnostic } from "../shared/codex-upstream-contracts.js";

export const PROPOSAL_IPC_CHANNELS = Object.freeze({
  availability: "cocreate:proposal:availability",
  list: "cocreate:proposal:list",
  create: "cocreate:proposal:create",
  begin: "cocreate:proposal:begin",
  complete: "cocreate:proposal:complete",
  fail: "cocreate:proposal:fail",
  validate: "cocreate:proposal:validate",
  approve: "cocreate:proposal:approve",
  reject: "cocreate:proposal:reject",
  apply: "cocreate:proposal:apply",
  destroy: "cocreate:proposal:destroy",
  previewStart: "cocreate:proposal:preview-start",
  previewStop: "cocreate:proposal:preview-stop",
  previewRestart: "cocreate:proposal:preview-restart",
  previewRefresh: "cocreate:proposal:preview-refresh"
});

const RECORD_VERSION = 1;
const STORE_VERSION = 1;
const MAX_FILES = 20_000;
const MAX_DIFF_BYTES = 300_000;
const PREVIEW_TIMEOUT_MS = 25_000;
const VALIDATION_TIMEOUT_MS = 4 * 60_000;
const ABANDONED_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".turbo", ".cache", "build", "coverage", "dist", "node_modules", "release"
]);
const SENSITIVE_NAMES = new Set([
  ".npmrc", ".pypirc", "credentials", "credentials.json", "id_rsa", "id_ed25519", "service-account.json"
]);
const STATUS_VALUES = new Set([
  "draft", "preparing", "applying", "running", "ready", "failed", "rejected", "approved", "applied", "destroyed"
]);

function timestamp() {
  return new Date().toISOString();
}

function safeText(value, fallback, limit = 300) {
  const text = redactCodexDiagnostic(typeof value === "string" ? value : "", limit)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function safeId(value, prefix = "proposal") {
  if (typeof value === "string" && /^[a-zA-Z0-9_-]{8,160}$/.test(value)) return value;
  return `${prefix}-${randomUUID()}`;
}

function isSensitiveRelativePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const base = (parts.at(-1) ?? "").toLowerCase();
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (SENSITIVE_NAMES.has(base)) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
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

async function walkFiles(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isSensitiveRelativePath(relative)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(relative);
      if (files.length > MAX_FILES) throw new Error(`El Project supera el límite seguro de ${MAX_FILES} archivos.`);
    }
  }
  await visit(root);
  return files.sort();
}

async function createManifest(root) {
  const manifest = {};
  for (const relative of await walkFiles(root)) {
    const filePath = path.join(root, relative);
    const info = await stat(filePath);
    manifest[relative] = { hash: await hashFile(filePath), size: info.size, mode: info.mode };
  }
  return manifest;
}

async function copyWorkspaceTree(sourceRoot, destinationRoot) {
  await mkdir(destinationRoot, { recursive: true });
  async function copyDirectory(source, destination, prefix = "") {
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isSensitiveRelativePath(relative) || entry.isSymbolicLink()) continue;
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await mkdir(destinationPath, { recursive: true });
        await copyDirectory(sourcePath, destinationPath, relative);
      } else if (entry.isFile()) {
        await copyFile(sourcePath, destinationPath);
        await chmod(destinationPath, (await stat(sourcePath)).mode & 0o777);
      }
    }
  }
  await copyDirectory(sourceRoot, destinationRoot);
}

async function linkDependencyCache(sourceRoot, proposalRoot) {
  const sourceModules = path.join(sourceRoot, "node_modules");
  if (!await pathExists(sourceModules)) return false;
  const target = path.join(proposalRoot, "node_modules");
  if (await pathExists(target)) await rm(target, { recursive: true, force: true });
  await symlink(sourceModules, target, "junction");
  return true;
}

function sanitizeOutput(value, roots = []) {
  let output = redactCodexDiagnostic(String(value ?? ""), 32_000);
  for (const root of roots.filter(Boolean)) output = output.split(root).join("[workspace]");
  return output
    .replace(/(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .slice(-16_000);
}

function publicRecord(record) {
  return {
    version: record.version,
    id: record.id,
    sequence: record.sequence,
    parentId: record.parentId,
    status: record.status,
    instruction: record.instruction,
    source: record.source,
    selectionLabel: record.selectionLabel,
    author: record.author,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    durationMs: record.durationMs,
    workspace: {
      strategy: "temporary-copy-on-write",
      available: record.workspaceAvailable,
      dependencyCacheReused: record.dependencyCacheReused,
      restored: record.restored === true
    },
    preview: { ...record.preview },
    diff: {
      files: record.diff.files,
      components: record.diff.components,
      additions: record.diff.additions,
      deletions: record.diff.deletions,
      preview: record.diff.preview,
      updatedAt: record.diff.updatedAt
    },
    validation: { ...record.validation, checks: record.validation.checks.map((check) => ({ ...check })) },
    errors: [...record.errors],
    timeline: record.timeline.map((item) => ({ ...item })),
    appliedAt: record.appliedAt,
    destroyedAt: record.destroyedAt
  };
}

function emptyDiff() {
  return { files: [], components: [], additions: 0, deletions: 0, preview: "", filePreviews: [], updatedAt: null };
}

function emptyValidation() {
  return { status: "idle", ok: false, checks: [], startedAt: null, completedAt: null, durationMs: null };
}

function emptyPreview() {
  return {
    status: "stopped",
    url: null,
    error: null,
    script: null,
    port: null,
    refreshToken: 0,
    hotReload: false,
    startedAt: null,
    durationMs: null,
    output: ""
  };
}

function transition(record, status, label, detail = null) {
  if (!STATUS_VALUES.has(status)) throw new Error(`Estado de Proposal inválido: ${status}`);
  const at = timestamp();
  record.status = status;
  record.updatedAt = at;
  record.durationMs = Math.max(0, Date.parse(at) - Date.parse(record.createdAt));
  record.timeline.push({
    id: `proposal-event-${randomUUID()}`,
    status,
    label: safeText(label, "Proposal actualizado", 160),
    detail: detail ? safeText(detail, "", 300) : null,
    timestamp: at
  });
  record.timeline = record.timeline.slice(-100);
}

function inferComponents(files) {
  return Array.from(new Set(files.flatMap((file) => {
    const extension = path.extname(file).toLowerCase();
    if (![".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss"].includes(extension)) return [];
    return [path.basename(file, extension)];
  }))).slice(0, 80);
}

function lineDiff(relative, before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const count = Math.max(oldLines.length, newLines.length);
  const output = [`--- a/${relative}`, `+++ b/${relative}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`];
  let additions = 0;
  let deletions = 0;
  for (let index = 0; index < count; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) output.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) { output.push(`-${oldLine}`); deletions += 1; }
    if (newLine !== undefined) { output.push(`+${newLine}`); additions += 1; }
  }
  return { preview: output.join("\n"), additions, deletions };
}

async function readDiffText(filePath) {
  try {
    const info = await stat(filePath);
    if (info.size > MAX_DIFF_BYTES) return `[Archivo de ${info.size} bytes; preview omitido]`;
    const buffer = await readFile(filePath);
    if (buffer.includes(0)) return `[Archivo binario de ${info.size} bytes]`;
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function safeProcessEnv(port) {
  const allowed = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "SHELL", "LANG", "LC_ALL", "TERM"];
  const environment = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
  return { ...environment, BROWSER: "none", CI: "1", NODE_ENV: "development", PORT: String(port) };
}

function packageCommand(root, script, port) {
  const packageJsonPath = path.join(root, "package.json");
  return readFile(packageJsonPath, "utf8").then((contents) => {
    const packageJson = JSON.parse(contents);
    const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
    const selected = script && typeof scripts[script] === "string"
      ? script
      : ["dev", "preview", "start"].find((candidate) => typeof scripts[candidate] === "string");
    if (!selected) return null;
    const scriptBody = scripts[selected];
    const passthrough = /\bnext\b/i.test(scriptBody)
      ? ["--", "--hostname", "127.0.0.1", "--port", String(port)]
      : /\bvite\b/i.test(scriptBody)
        ? ["--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
        : [];
    return { command: "npm", args: ["run", selected, ...passthrough], script: selected, hotReload: selected === "dev" };
  }).catch(() => null);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".webp": "image/webp"
  })[extension] ?? "application/octet-stream";
}

async function createStaticPreview(root, port) {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname);
      const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const safe = safeRelativePath(relative);
      let filePath = safe ? path.join(root, safe) : path.join(root, "index.html");
      if (!isWithin(root, filePath) || !await pathExists(filePath)) filePath = path.join(root, "index.html");
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Preview no disponible");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

async function waitForHealth(url, healthCheck, timeoutMs = PREVIEW_TIMEOUT_MS) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await healthCheck(url)) return;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(lastError instanceof Error ? lastError.message : "El preview no respondió a tiempo.");
}

async function closeHttpServer(server) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, 1_500);
    server.close(finish);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

async function defaultHealthCheck(url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1_500) });
  return response.status >= 200 && response.status < 500;
}

async function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });
    let output = "";
    const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-32_000); };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timeout = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? VALIDATION_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, exitCode: null, durationMs: Date.now() - started, output: error.message });
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, exitCode: code, durationMs: Date.now() - started, output });
    });
  });
}

export function createProposalRuntime(options = {}) {
  const baseDir = options.baseDir;
  if (!baseDir) throw new TypeError("createProposalRuntime requires baseDir.");
  const storePath = path.join(baseDir, "proposal-runtime.json");
  const workspacesDir = path.join(baseDir, "workspaces");
  const transactionsDir = path.join(baseDir, "transactions");
  const records = new Map();
  const previews = new Map();
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const healthCheck = options.healthCheck ?? defaultHealthCheck;
  const spawnImpl = options.spawnImpl ?? spawn;
  let initialized = false;
  let writeQueue = Promise.resolve();

  async function persist() {
    const payload = {
      version: STORE_VERSION,
      updatedAt: timestamp(),
      proposals: Array.from(records.values()).map((record) => ({ ...record, ownerId: null, restored: false }))
    };
    writeQueue = writeQueue.then(async () => {
      await mkdir(baseDir, { recursive: true });
      const temporary = `${storePath}.tmp`;
      await writeFile(temporary, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, storePath);
    });
    await writeQueue;
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    await mkdir(workspacesDir, { recursive: true });
    await mkdir(transactionsDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      for (const candidate of Array.isArray(parsed?.proposals) ? parsed.proposals : []) {
        if (!candidate || candidate.version !== RECORD_VERSION || !STATUS_VALUES.has(candidate.status)) continue;
        const workspaceRoot = typeof candidate.workspaceRoot === "string" ? candidate.workspaceRoot : "";
        if (!isWithin(workspacesDir, workspaceRoot)) continue;
        const workspaceAvailable = candidate.workspaceAvailable === true && await pathExists(workspaceRoot);
        const record = {
          ...candidate,
          ownerId: null,
          restored: true,
          workspaceAvailable,
          preview: { ...emptyPreview(), ...candidate.preview, status: "stopped", url: null, port: null },
          validation: candidate.validation?.checks ? candidate.validation : emptyValidation(),
          diff: candidate.diff?.files ? candidate.diff : emptyDiff(),
          errors: Array.isArray(candidate.errors) ? candidate.errors.slice(-20) : [],
          timeline: Array.isArray(candidate.timeline) ? candidate.timeline.slice(-100) : []
        };
        if (Date.now() - Date.parse(record.updatedAt) > ABANDONED_TTL_MS && workspaceAvailable && !["approved", "ready"].includes(record.status)) {
          await rm(record.workspaceContainer, { recursive: true, force: true });
          record.workspaceAvailable = false;
          transition(record, "destroyed", "Workspace abandonado eliminado automáticamente");
        }
        records.set(record.id, record);
      }
      const managed = new Set(Array.from(records.values()).map((record) => path.basename(record.workspaceContainer)));
      for (const entry of await readdir(workspacesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !managed.has(entry.name)) {
          await rm(path.join(workspacesDir, entry.name), { recursive: true, force: true });
        }
      }
      await persist();
    } catch {
      // First run has no store yet.
    }
  }

  function owned(id, ownerId) {
    const record = records.get(safeId(id));
    if (!record) throw new Error("No encontré esa propuesta.");
    if (record.ownerId !== null && record.ownerId !== ownerId) throw new Error("La propuesta pertenece a otra ventana.");
    record.ownerId = ownerId;
    return record;
  }

  async function inspectDiff(record) {
    if (!record.workspaceAvailable) throw new Error("El Proposal Workspace ya no está disponible.");
    const proposalManifest = await createManifest(record.workspaceRoot);
    const baseline = record.baselineManifest ?? {};
    const allFiles = Array.from(new Set([...Object.keys(baseline), ...Object.keys(proposalManifest)])).sort();
    const changed = allFiles.filter((relative) => (
      baseline[relative]?.hash !== proposalManifest[relative]?.hash ||
      baseline[relative]?.mode !== proposalManifest[relative]?.mode
    ));
    const previews = [];
    const filePreviews = [];
    let additions = 0;
    let deletions = 0;
    for (const relative of changed.slice(0, 200)) {
      const before = baseline[relative] ? await readDiffText(path.join(record.sourceRoot, relative)) : "";
      const after = proposalManifest[relative] ? await readDiffText(path.join(record.workspaceRoot, relative)) : "";
      const diff = lineDiff(relative, before, after);
      additions += diff.additions;
      deletions += diff.deletions;
      previews.push(diff.preview);
      filePreviews.push({ path: relative, additions: diff.additions, deletions: diff.deletions, preview: diff.preview });
    }
    record.diff = {
      files: changed.slice(0, 500),
      components: inferComponents(changed),
      additions,
      deletions,
      preview: previews.join("\n\n").slice(0, 500_000),
      filePreviews,
      updatedAt: timestamp()
    };
    return record.diff;
  }

  async function stopPreview(record) {
    const active = previews.get(record.id);
    if (active?.kind === "child" && active.process && !active.process.killed) {
      active.stopping = true;
      active.process.kill("SIGTERM");
    }
    if (active?.kind === "static") await closeHttpServer(active.server);
    previews.delete(record.id);
    record.preview.status = "stopped";
    record.preview.url = null;
    record.preview.port = null;
    record.preview.durationMs = record.preview.startedAt ? Math.max(0, Date.now() - Date.parse(record.preview.startedAt)) : null;
    record.updatedAt = timestamp();
    await persist();
    return publicRecord(record);
  }

  async function startPreview(record, requestedScript = null) {
    if (!record.workspaceAvailable) throw new Error("El Proposal Workspace ya no está disponible.");
    if (previews.has(record.id)) await stopPreview(record);
    const port = await findFreePort();
    const url = `http://127.0.0.1:${port}/`;
    const command = await packageCommand(record.workspaceRoot, requestedScript, port);
    record.preview = { ...record.preview, status: "starting", url: null, error: null, port, output: "", startedAt: timestamp() };
    transition(record, "running", "Preview de propuesta iniciando");
    await persist();

    try {
      if (command) {
        const child = spawnImpl(command.command, command.args, {
          cwd: record.workspaceRoot,
          env: safeProcessEnv(port),
          stdio: ["ignore", "pipe", "pipe"],
          shell: false
        });
        const active = { kind: "child", process: child, stopping: false };
        previews.set(record.id, active);
        const append = (chunk) => {
          record.preview.output = sanitizeOutput(`${record.preview.output}\n${String(chunk)}`, [record.workspaceRoot, record.sourceRoot]);
        };
        child.stdout?.on("data", append);
        child.stderr?.on("data", append);
        child.once("exit", (code) => {
          if (active.stopping) return;
          previews.delete(record.id);
          record.preview.status = "failed";
          record.preview.url = null;
          record.preview.error = `El preview terminó con código ${code ?? "desconocido"}.`;
          transition(record, "failed", "El preview se detuvo inesperadamente", record.preview.error);
          void persist();
        });
        child.once("error", (cause) => append(cause instanceof Error ? cause.message : String(cause)));
        record.preview.script = command.script;
        record.preview.hotReload = command.hotReload;
      } else if (await pathExists(path.join(record.workspaceRoot, "index.html"))) {
        const server = await createStaticPreview(record.workspaceRoot, port);
        previews.set(record.id, { kind: "static", server });
        record.preview.script = "static";
        record.preview.hotReload = false;
      } else {
        throw new Error("El Project no publica un script de preview ni un index.html ejecutable.");
      }

      await waitForHealth(url, healthCheck);
      record.preview.status = "ready";
      record.preview.url = url;
      record.preview.error = null;
      record.preview.refreshToken += 1;
      record.preview.durationMs = Date.now() - Date.parse(record.preview.startedAt);
      transition(record, "ready", "Proposal lista para revisar");
      await persist();
      return publicRecord(record);
    } catch (cause) {
      const active = previews.get(record.id);
      if (active?.kind === "child") { active.stopping = true; active.process.kill("SIGTERM"); }
      if (active?.kind === "static") await closeHttpServer(active.server);
      previews.delete(record.id);
      const message = sanitizeOutput(cause instanceof Error ? cause.message : cause, [record.workspaceRoot, record.sourceRoot]);
      record.preview.status = "failed";
      record.preview.url = null;
      record.preview.error = safeText(message, "No pude iniciar el preview.", 500);
      record.errors.push(record.preview.error);
      transition(record, "failed", "No fue posible ejecutar la propuesta", record.preview.error);
      await persist();
      return publicRecord(record);
    }
  }

  async function createProposal(ownerId, input, sourceRootValue) {
    await initialize();
    const sourceRoot = await realpath(sourceRootValue ?? "").catch(() => null);
    if (!sourceRoot || !(await stat(sourceRoot).catch(() => null))?.isDirectory()) {
      throw new Error("Asocia una carpeta local válida al Project antes de crear una propuesta.");
    }
    let parent = input?.parentId ? owned(input.parentId, ownerId) : null;
    if (parent && (!parent.workspaceAvailable || ["destroyed", "applied", "rejected"].includes(parent.status))) {
      throw new Error("La propuesta anterior ya no puede usarse como base.");
    }
    if (parent && parent.sourceRoot !== sourceRoot) parent = null;
    const id = safeId(null);
    const workspaceContainer = path.join(workspacesDir, id);
    const workspaceRoot = path.join(workspaceContainer, "project");
    const createdAt = timestamp();
    const sequence = Math.max(0, ...Array.from(records.values()).filter((entry) => entry.sourceRoot === sourceRoot).map((entry) => entry.sequence)) + 1;
    const record = {
      version: RECORD_VERSION,
      id,
      sequence,
      parentId: parent?.id ?? null,
      ownerId,
      status: "draft",
      instruction: safeText(input?.instruction, "Nueva propuesta", 4_000),
      source: input?.source === "voice" ? "voice" : "text",
      selectionLabel: typeof input?.selectionLabel === "string" ? safeText(input.selectionLabel, "Elemento seleccionado", 100) : null,
      author: safeText(input?.author, "Usuario local", 100),
      sourceRoot,
      workspaceContainer,
      workspaceRoot,
      workspaceAvailable: false,
      dependencyCacheReused: false,
      baselineManifest: parent?.baselineManifest ?? await createManifest(sourceRoot),
      preview: emptyPreview(),
      diff: emptyDiff(),
      validation: emptyValidation(),
      errors: [],
      timeline: [],
      createdAt,
      updatedAt: createdAt,
      durationMs: 0,
      appliedAt: null,
      destroyedAt: null,
      restored: false
    };
    records.set(id, record);
    transition(record, "draft", `Proposal ${sequence} creada`);
    transition(record, "preparing", parent ? `Creando iteración desde Proposal ${parent.sequence}` : "Creando workspace aislado");
    await persist();
    try {
      await copyWorkspaceTree(parent?.workspaceRoot ?? sourceRoot, workspaceRoot);
      record.dependencyCacheReused = await linkDependencyCache(sourceRoot, workspaceRoot);
      record.workspaceAvailable = true;
      transition(record, "draft", "Proposal Workspace listo");
      await persist();
      return publicRecord(record);
    } catch (cause) {
      const message = sanitizeOutput(cause instanceof Error ? cause.message : cause, [sourceRoot, workspaceRoot]);
      record.errors.push(message);
      transition(record, "failed", "No pude crear el Proposal Workspace", message);
      await rm(workspaceContainer, { recursive: true, force: true });
      await persist();
      return publicRecord(record);
    }
  }

  async function beginProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (!record.workspaceAvailable || !["draft", "ready", "approved"].includes(record.status)) throw new Error("La propuesta no está lista para iterar.");
    record.validation = emptyValidation();
    transition(record, "applying", record.source === "voice" ? "Aplicando instrucción de voz en la propuesta" : "Aplicando instrucción en la propuesta");
    await persist();
    return publicRecord(record);
  }

  async function completeProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    const diff = await inspectDiff(record);
    if (!diff.files.length) {
      const message = "Codex terminó sin producir cambios en el Proposal Workspace.";
      record.errors.push(message);
      transition(record, "failed", "La propuesta no contiene cambios", message);
      await persist();
      return publicRecord(record);
    }
    transition(record, "running", "Cambios aislados; levantando preview");
    await persist();
    return startPreview(record);
  }

  async function failProposal(ownerId, id, reason) {
    await initialize();
    const record = owned(id, ownerId);
    const message = safeText(reason, "Codex no pudo completar la propuesta.", 700);
    record.errors.push(message);
    transition(record, "failed", "La iteración no pudo completarse", message);
    await persist();
    return publicRecord(record);
  }

  async function validateProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (!record.workspaceAvailable || !["ready", "approved"].includes(record.status)) throw new Error("La propuesta debe estar lista antes de validarla.");
    const packageJson = JSON.parse(await readFile(path.join(record.workspaceRoot, "package.json"), "utf8").catch(() => "{}"));
    const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
    const definitions = [
      ["typecheck", "Typecheck"],
      ["lint", "Lint"],
      ["test", "Tests rápidos"],
      ["build", "Build parcial"]
    ];
    const startedAt = timestamp();
    record.validation = { status: "running", ok: false, checks: [], startedAt, completedAt: null, durationMs: null };
    record.timeline.push({ id: `proposal-event-${randomUUID()}`, status: record.status, label: "Validando propuesta", detail: null, timestamp: startedAt });
    await persist();
    for (const [script, label] of definitions) {
      if (typeof scripts[script] !== "string") {
        record.validation.checks.push({ id: script, label, status: "skipped", durationMs: 0, output: "El Project no define este script." });
        continue;
      }
      const result = await commandRunner("npm", ["run", script], {
        cwd: record.workspaceRoot,
        env: { ...safeProcessEnv(record.preview.port ?? 0), NODE_ENV: "test" },
        timeoutMs: VALIDATION_TIMEOUT_MS
      });
      record.validation.checks.push({
        id: script,
        label,
        status: result.ok ? "passed" : "failed",
        durationMs: result.durationMs,
        output: sanitizeOutput(result.output, [record.workspaceRoot, record.sourceRoot])
      });
      if (!result.ok) break;
    }
    record.validation.ok = record.validation.checks.every((check) => check.status !== "failed");
    record.validation.status = record.validation.ok ? "passed" : "failed";
    record.validation.completedAt = timestamp();
    record.validation.durationMs = Math.max(0, Date.parse(record.validation.completedAt) - Date.parse(startedAt));
    record.timeline.push({
      id: `proposal-event-${randomUUID()}`,
      status: record.status,
      label: record.validation.ok ? "Validaciones completadas" : "La propuesta no pasó las validaciones",
      detail: null,
      timestamp: record.validation.completedAt
    });
    await persist();
    return publicRecord(record);
  }

  async function approveProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (record.status !== "ready") throw new Error("Solo puedes aprobar una propuesta lista.");
    transition(record, "approved", "Propuesta aprobada para aplicar");
    await persist();
    return publicRecord(record);
  }

  async function rejectProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (["applied", "destroyed"].includes(record.status)) throw new Error("La propuesta ya no puede rechazarse.");
    transition(record, "rejected", "Propuesta rechazada");
    await stopPreview(record);
    return publicRecord(record);
  }

  async function rollbackTransaction(record, transaction) {
    for (const entry of [...transaction].reverse()) {
      const destination = path.join(record.sourceRoot, entry.relative);
      if (entry.existed) {
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(entry.backupPath, destination);
      } else {
        await rm(destination, { force: true });
      }
    }
  }

  async function assertSafeDestination(root, relative) {
    const safe = safeRelativePath(relative);
    if (!safe) throw new Error(`Ruta de cambio no permitida: ${relative}`);
    const destination = path.join(root, safe);
    if (!isWithin(root, destination)) throw new Error(`Ruta fuera del Project: ${relative}`);
    let cursor = path.dirname(destination);
    while (cursor !== root && isWithin(root, cursor)) {
      if (await pathExists(cursor) && (await lstat(cursor)).isSymbolicLink()) throw new Error(`La ruta contiene un symlink: ${relative}`);
      cursor = path.dirname(cursor);
    }
    return { safe, destination };
  }

  async function applyProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (record.status !== "approved") throw new Error("Aprueba explícitamente la propuesta antes de aplicarla.");
    if (record.validation.status !== "passed" || !record.validation.ok) throw new Error("Ejecuta y supera las validaciones antes de aplicar.");
    const diff = await inspectDiff(record);
    if (!diff.files.length) throw new Error("La propuesta no contiene cambios de archivos para aplicar.");
    const currentManifest = await createManifest(record.sourceRoot);
    const conflicts = diff.files.filter((relative) => (
      currentManifest[relative]?.hash !== record.baselineManifest[relative]?.hash ||
      currentManifest[relative]?.mode !== record.baselineManifest[relative]?.mode
    ));
    if (conflicts.length) throw new Error(`Current cambió desde que nació la propuesta: ${conflicts.slice(0, 3).join(", ")}.`);
    transition(record, "applying", "Aplicando archivos aprobados a Current");
    await persist();
    const transactionRoot = path.join(transactionsDir, `${record.id}-${Date.now()}`);
    const backupRoot = path.join(transactionRoot, "backup");
    const transaction = [];
    try {
      await mkdir(backupRoot, { recursive: true });
      for (const relative of diff.files) {
        const { safe, destination } = await assertSafeDestination(record.sourceRoot, relative);
        const proposalPath = path.join(record.workspaceRoot, safe);
        const existed = await pathExists(destination);
        const backupPath = path.join(backupRoot, safe);
        if (existed) {
          const destinationInfo = await lstat(destination);
          if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) throw new Error(`Current contiene una ruta no segura: ${safe}`);
          await mkdir(path.dirname(backupPath), { recursive: true });
          await copyFile(destination, backupPath);
        }
        transaction.push({ relative: safe, destination, existed, backupPath });
        await options.beforeApplyFile?.({ relative: safe, index: transaction.length - 1 });
        if (await pathExists(proposalPath)) {
          const proposalInfo = await lstat(proposalPath);
          if (!proposalInfo.isFile() || proposalInfo.isSymbolicLink()) throw new Error(`La propuesta contiene una ruta no segura: ${safe}`);
          await mkdir(path.dirname(destination), { recursive: true });
          const temporary = `${destination}.cocreate-${randomUUID()}.tmp`;
          await copyFile(proposalPath, temporary);
          await chmod(temporary, proposalInfo.mode & 0o777);
          await rename(temporary, destination);
        } else {
          await rm(destination, { force: true });
        }
      }
      record.appliedAt = timestamp();
      transition(record, "applied", "Propuesta aplicada a Current");
      await stopPreview(record);
      await rm(record.workspaceContainer, { recursive: true, force: true });
      record.workspaceAvailable = false;
      record.destroyedAt = timestamp();
      record.timeline.push({
        id: `proposal-event-${randomUUID()}`,
        status: "applied",
        label: "Proposal Workspace eliminado después de Apply",
        detail: null,
        timestamp: record.destroyedAt
      });
      await rm(transactionRoot, { recursive: true, force: true });
      await persist();
      return publicRecord(record);
    } catch (cause) {
      await rollbackTransaction(record, transaction).catch(() => undefined);
      const message = sanitizeOutput(cause instanceof Error ? cause.message : cause, [record.workspaceRoot, record.sourceRoot]);
      record.errors.push(message);
      transition(record, "failed", "Apply falló; Current fue restaurado", message);
      await persist();
      throw new Error(`No pude aplicar la propuesta. Current fue restaurado. ${safeText(message, "", 300)}`);
    } finally {
      await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function destroyProposal(ownerId, id) {
    await initialize();
    const record = owned(id, ownerId);
    if (record.status === "applied") return publicRecord(record);
    await stopPreview(record);
    await rm(record.workspaceContainer, { recursive: true, force: true });
    record.workspaceAvailable = false;
    record.destroyedAt = timestamp();
    transition(record, "destroyed", "Proposal Workspace eliminado");
    await persist();
    return publicRecord(record);
  }

  async function list(ownerId) {
    await initialize();
    const output = [];
    for (const record of records.values()) {
      if (record.ownerId === null) record.ownerId = ownerId;
      if (record.ownerId === ownerId) output.push(publicRecord(record));
    }
    return output.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  async function resolveWorkspace(id, ownerId) {
    await initialize();
    const record = owned(id, ownerId);
    if (!record.workspaceAvailable || !isWithin(workspacesDir, record.workspaceRoot)) throw new Error("El Proposal Workspace no está disponible.");
    return { id: record.id, rootPath: record.workspaceRoot, sourceRoot: record.sourceRoot };
  }

  async function resolveApprovedRevision(id, ownerId) {
    await initialize();
    const record = owned(id, ownerId);
    if (record.status !== "approved") throw new Error("La Proposal debe estar aprobada antes de congelar su implementación.");
    if (!record.workspaceAvailable) throw new Error("El Proposal Workspace aprobado ya no está disponible.");
    const diff = await inspectDiff(record);
    if (!diff.files.length) throw new Error("La Proposal aprobada no contiene cambios para implementar.");
    const proposalManifest = await createManifest(record.workspaceRoot);
    const approvedRevisionId = createHash("sha256").update(JSON.stringify({
      proposalId: record.id,
      instruction: record.instruction,
      selectionLabel: record.selectionLabel,
      files: diff.files.map((relative) => [relative, proposalManifest[relative]?.hash ?? null, proposalManifest[relative]?.mode ?? null])
    })).digest("hex");
    return {
      proposal: publicRecord(record),
      approvedRevisionId,
      sourceRoot: record.sourceRoot,
      workspaceRoot: record.workspaceRoot,
      baselineManifest: structuredClone(record.baselineManifest),
      proposalManifest,
      diff: structuredClone(diff)
    };
  }

  async function finalizeImplementation(id, ownerId) {
    await initialize();
    const record = owned(id, ownerId);
    if (record.status === "applied") return publicRecord(record);
    if (record.status !== "approved") throw new Error("La Proposal ya no puede finalizarse como implementada.");
    record.appliedAt = timestamp();
    transition(record, "applied", "Proposal implementada en Current");
    await stopPreview(record);
    await rm(record.workspaceContainer, { recursive: true, force: true });
    record.workspaceAvailable = false;
    record.destroyedAt = timestamp();
    record.timeline.push({
      id: `proposal-event-${randomUUID()}`,
      status: "applied",
      label: "Proposal Workspace eliminado después de la implementación",
      detail: null,
      timestamp: record.destroyedAt
    });
    await persist();
    return publicRecord(record);
  }

  async function dispose() {
    for (const record of records.values()) {
      if (previews.has(record.id)) await stopPreview(record).catch(() => undefined);
    }
    await persist().catch(() => undefined);
  }

  return {
    initialize,
    list,
    createProposal,
    beginProposal,
    completeProposal,
    failProposal,
    validateProposal,
    approveProposal,
    rejectProposal,
    applyProposal,
    destroyProposal,
    startPreview: async (ownerId, id, script) => startPreview(owned(id, ownerId), script),
    stopPreview: async (ownerId, id) => stopPreview(owned(id, ownerId)),
    restartPreview: async (ownerId, id) => {
      const record = owned(id, ownerId);
      const script = record.preview.script;
      await stopPreview(record);
      return startPreview(record, script);
    },
    refreshPreview: async (ownerId, id) => {
      const record = owned(id, ownerId);
      if (record.preview.status !== "ready") throw new Error("El preview no está listo para refrescar.");
      record.preview.refreshToken += 1;
      record.updatedAt = timestamp();
      await persist();
      return publicRecord(record);
    },
    resolveWorkspace,
    resolveApprovedRevision,
    finalizeImplementation,
    dispose,
    _records: records
  };
}

export function registerProposalRuntimeIpc({ ipcMain, browserWindow, runtime, resolveSourceRoot }) {
  const ownerId = (event) => browserWindow.fromWebContents(event.sender)?.id ?? null;
  const withOwner = (event) => {
    const resolved = ownerId(event);
    if (!resolved) throw new Error("No pude verificar la ventana propietaria de la propuesta.");
    return resolved;
  };
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.availability, async () => ({
    available: true,
    environment: "desktop",
    strategy: "temporary-copy-on-write",
    reason: null
  }));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.list, (event) => runtime.list(withOwner(event)));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.create, async (event, payload) => {
    const sourceRoot = await resolveSourceRoot();
    return runtime.createProposal(withOwner(event), payload ?? {}, sourceRoot);
  });
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.begin, (event, payload) => runtime.beginProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.complete, (event, payload) => runtime.completeProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.fail, (event, payload) => runtime.failProposal(withOwner(event), payload?.id, payload?.reason));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.validate, (event, payload) => runtime.validateProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.approve, (event, payload) => runtime.approveProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.reject, (event, payload) => runtime.rejectProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.apply, (event, payload) => runtime.applyProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.destroy, (event, payload) => runtime.destroyProposal(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.previewStart, (event, payload) => runtime.startPreview(withOwner(event), payload?.id, payload?.script));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.previewStop, (event, payload) => runtime.stopPreview(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.previewRestart, (event, payload) => runtime.restartPreview(withOwner(event), payload?.id));
  ipcMain.handle(PROPOSAL_IPC_CHANNELS.previewRefresh, (event, payload) => runtime.refreshPreview(withOwner(event), payload?.id));

  return () => {
    for (const channel of Object.values(PROPOSAL_IPC_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
