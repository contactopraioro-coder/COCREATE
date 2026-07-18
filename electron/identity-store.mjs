import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IDENTITY_SCHEMA_VERSION,
  createDefaultUserProfile,
  createDeviceIdentity,
  createIdentityLink,
  createLocalIdentity,
  hasForbiddenSensitiveKeys,
  nowIso,
  normalizeLegacyActor
} from "../shared/identity-domain.js";

function createDefaultIdentityState() {
  return {
    version: IDENTITY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    identity: null,
    profile: null,
    device: null,
    preparedLink: null,
    events: [],
    metadata: {
      migrationVersion: 1
    }
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object");
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

function normalizeIdentityEvent(entry) {
  if (!isRecord(entry)) {
    return null;
  }

  return {
    id: typeof entry.id === "string" ? entry.id : `identity-event-${Date.now()}`,
    type: typeof entry.type === "string" ? entry.type : "identity.updated",
    version: typeof entry.version === "number" ? entry.version : 1,
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : nowIso(),
    actor: normalizeLegacyActor(entry.actor),
    payload: isRecord(entry.payload) ? entry.payload : {}
  };
}

function sanitizeProfile(profile, identity) {
  const nextProfile = createDefaultUserProfile(identity, profile ?? {});
  if (hasForbiddenSensitiveKeys(nextProfile)) {
    return createDefaultUserProfile(identity, {
      displayName: nextProfile.displayName,
      locale: nextProfile.locale,
      timezone: nextProfile.timezone
    });
  }

  return nextProfile;
}

function normalizeState(rawState) {
  const fallback = createDefaultIdentityState();
  if (!isRecord(rawState)) {
    return fallback;
  }

  if (typeof rawState.version === "number" && rawState.version > IDENTITY_SCHEMA_VERSION) {
    return {
      ...fallback,
      metadata: {
        ...fallback.metadata,
        recoveredFromUnsupportedVersion: rawState.version
      }
    };
  }

  const identity = rawState.identity ? createLocalIdentity(rawState.identity) : null;
  const profile = identity ? sanitizeProfile(rawState.profile, identity) : null;
  const device = identity ? createDeviceIdentity(identity, rawState.device ?? {}) : null;

  return {
    version: IDENTITY_SCHEMA_VERSION,
    updatedAt: typeof rawState.updatedAt === "string" ? rawState.updatedAt : nowIso(),
    identity,
    profile,
    device,
    preparedLink:
      identity && rawState.preparedLink && isRecord(rawState.preparedLink)
        ? createIdentityLink(identity, rawState.preparedLink)
        : null,
    events: Array.isArray(rawState.events) ? rawState.events.map(normalizeIdentityEvent).filter(Boolean).slice(-200) : [],
    metadata: isRecord(rawState.metadata) ? rawState.metadata : { migrationVersion: 1 }
  };
}

export function createIdentityStore({ filePath }) {
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function loadNow() {
    const rawState = await readJsonFileSafe(filePath, createDefaultIdentityState());
    return normalizeState(rawState);
  }

  async function load() {
    await mutationQueue;
    return loadNow();
  }

  async function saveNow(state) {
    const nextState = normalizeState({
      ...state,
      updatedAt: nowIso()
    });
    await writeJsonAtomic(filePath, nextState);
    return nextState;
  }

  function save(state) {
    return enqueue(() => saveNow(state));
  }

  function update(mutator) {
    return enqueue(async () => {
      const current = await loadNow();
      await mutator(current);
      return saveNow(current);
    });
  }

  return {
    filePath,
    load,
    save,
    update
  };
}
