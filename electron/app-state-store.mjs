import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSession(title = "Workspace principal") {
  const now = Date.now();
  return {
    id: createId("session"),
    title,
    createdAt: now,
    updatedAt: now,
    renderer: {
      workbench: null
    },
    events: []
  };
}

function createEmptyAppState() {
  return {
    version: 1,
    updatedAt: Date.now(),
    activeSessionId: null,
    sessions: []
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

export function createAppStateStore({ filePath }) {
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function ensureActiveSession(state) {
    if (!state.activeSessionId || !state.sessions.some((session) => session.id === state.activeSessionId)) {
      const session = createSession();
      state.sessions = [session, ...state.sessions];
      state.activeSessionId = session.id;
      state.updatedAt = Date.now();
      return session;
    }

    return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
  }

  async function loadNow() {
    const state = await readJsonFileSafe(filePath, createEmptyAppState());
    if (!state || typeof state !== "object") {
      return createEmptyAppState();
    }

    const normalized = {
      version: typeof state.version === "number" ? state.version : 1,
      updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : Date.now(),
      activeSessionId: typeof state.activeSessionId === "string" ? state.activeSessionId : null,
      sessions: Array.isArray(state.sessions) ? state.sessions : []
    };

    ensureActiveSession(normalized);
    return normalized;
  }

  async function load() {
    await mutationQueue;
    return loadNow();
  }

  async function saveNow(state) {
    state.updatedAt = Date.now();
    await writeJsonAtomic(filePath, state);
    return state;
  }

  function save(state) {
    return enqueue(() => saveNow(state));
  }

  function update(mutator) {
    return enqueue(async () => {
      const state = await loadNow();
      const activeSession = ensureActiveSession(state);
      await mutator(state, activeSession);
      ensureActiveSession(state);
      await saveNow(state);
      return {
        state,
        session: state.sessions.find((item) => item.id === state.activeSessionId) ?? null
      };
    });
  }

  function appendSessionEvent(session, event) {
    const entry = {
      id: createId("event"),
      type: typeof event?.type === "string" ? event.type : "event",
      source: typeof event?.source === "string" ? event.source : "renderer",
      payload: event?.payload && typeof event.payload === "object" ? event.payload : {},
      createdAt: Date.now()
    };

    session.events = Array.isArray(session.events) ? session.events : [];
    session.events.push(entry);
    if (session.events.length > 250) {
      session.events = session.events.slice(-250);
    }
    session.updatedAt = Date.now();
    return entry;
  }

  return {
    filePath,
    load,
    save,
    update,
    ensureActiveSession,
    appendSessionEvent
  };
}
