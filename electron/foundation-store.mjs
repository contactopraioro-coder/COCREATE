import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FOUNDATION_SCHEMA_VERSION = 1;

function createDefaultFoundationState() {
  return {
    version: FOUNDATION_SCHEMA_VERSION,
    preferences: {
      theme: null,
      activeMode: null,
      sidebarCollapsed: null
    },
    codex: {
      lastKnownStatus: null
    },
    recentExecutions: []
  };
}

async function readJsonFileSafe(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempFile = `${filePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempFile, filePath);
}

function normalizeExecution(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    executionId: typeof entry.executionId === "string" ? entry.executionId : "",
    status: typeof entry.status === "string" ? entry.status : "unknown",
    binary: typeof entry.binary === "string" ? entry.binary : "",
    version: typeof entry.version === "string" ? entry.version : "",
    promptPreview: typeof entry.promptPreview === "string" ? entry.promptPreview : "",
    outputPreview: typeof entry.outputPreview === "string" ? entry.outputPreview : "",
    startedAt: typeof entry.startedAt === "string" ? entry.startedAt : new Date().toISOString(),
    finishedAt: typeof entry.finishedAt === "string" ? entry.finishedAt : null
  };
}

function migrateFoundationState(rawState) {
  const fallback = createDefaultFoundationState();
  if (!rawState || typeof rawState !== "object") {
    return fallback;
  }

  return {
    version: FOUNDATION_SCHEMA_VERSION,
    preferences: {
      theme: typeof rawState.preferences?.theme === "string" ? rawState.preferences.theme : null,
      activeMode: typeof rawState.preferences?.activeMode === "string" ? rawState.preferences.activeMode : null,
      sidebarCollapsed:
        typeof rawState.preferences?.sidebarCollapsed === "boolean" ? rawState.preferences.sidebarCollapsed : null
    },
    codex: {
      lastKnownStatus:
        rawState.codex?.lastKnownStatus && typeof rawState.codex.lastKnownStatus === "object"
          ? rawState.codex.lastKnownStatus
          : null
    },
    recentExecutions: Array.isArray(rawState.recentExecutions)
      ? rawState.recentExecutions.map(normalizeExecution).filter(Boolean).slice(-20)
      : []
  };
}

export function createFoundationStore({ filePath }) {
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function loadNow() {
    const rawState = await readJsonFileSafe(filePath, createDefaultFoundationState());
    return migrateFoundationState(rawState);
  }

  async function load() {
    await mutationQueue;
    return loadNow();
  }

  async function saveNow(state) {
    await writeJsonAtomic(filePath, migrateFoundationState(state));
    return state;
  }

  function save(state) {
    return enqueue(() => saveNow(state));
  }

  function update(mutator) {
    return enqueue(async () => {
      const current = await loadNow();
      await mutator(current);
      await saveNow(current);
      return current;
    });
  }

  async function recordCodexStatus(status) {
    await update((state) => {
      state.codex.lastKnownStatus = {
        available: Boolean(status?.available),
        binary: typeof status?.binary === "string" ? status.binary : "",
        version: typeof status?.version === "string" ? status.version : null,
        compatible: Boolean(status?.compatible),
        validatedVersion: typeof status?.validatedVersion === "string" ? status.validatedVersion : null,
        minimumSupportedVersion:
          typeof status?.minimumSupportedVersion === "string" ? status.minimumSupportedVersion : null,
        error: typeof status?.error === "string" ? status.error : null,
        updatedAt: typeof status?.updatedAt === "string" ? status.updatedAt : new Date().toISOString()
      };
    });
  }

  async function updatePreferencesFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    await update((state) => {
      state.preferences.theme = typeof snapshot.theme === "string" ? snapshot.theme : state.preferences.theme;
      state.preferences.activeMode =
        typeof snapshot.activeMode === "string" ? snapshot.activeMode : state.preferences.activeMode;
      state.preferences.sidebarCollapsed =
        typeof snapshot.sidebarCollapsed === "boolean"
          ? snapshot.sidebarCollapsed
          : state.preferences.sidebarCollapsed;
    });
  }

  async function recordExecution(entry) {
    await update((state) => {
      const normalized = normalizeExecution(entry);
      if (!normalized?.executionId) {
        return;
      }

      const withoutCurrent = state.recentExecutions.filter((item) => item.executionId !== normalized.executionId);
      state.recentExecutions = [...withoutCurrent, normalized].slice(-20);
    });
  }

  return {
    filePath,
    load,
    save,
    update,
    recordCodexStatus,
    updatePreferencesFromSnapshot,
    recordExecution
  };
}
