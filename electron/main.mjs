import "dotenv/config";
import { app, BrowserWindow, clipboard, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const defaultGeminiModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const codexBinary = process.env.CODEX_BINARY ?? "codex";
const featureFlags = {
  persistentSessions: true,
  liveCompare: process.env.FEATURE_LIVE_COMPARE === "1",
  realtimeChunks: process.env.FEATURE_REALTIME_CHUNKS === "1",
  autoApplyCodex: process.env.FEATURE_AUTO_APPLY_CODEX === "1"
};

let mainWindow = null;

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getAppVideoDir() {
  return path.join(app.getPath("movies"), "Caleidoscopio");
}

function getStateStorePath() {
  return path.join(app.getPath("userData"), "state", "app-state.json");
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function buildRecordingName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `caleidoscopio-${stamp}.webm`;
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

async function loadPersistedState() {
  const state = await readJsonFileSafe(getStateStorePath(), createEmptyAppState());
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

async function savePersistedState(state) {
  state.updatedAt = Date.now();
  await writeJsonAtomic(getStateStorePath(), state);
  return state;
}

async function updatePersistedState(mutator) {
  const state = await loadPersistedState();
  const activeSession = ensureActiveSession(state);
  await mutator(state, activeSession);
  ensureActiveSession(state);
  await savePersistedState(state);
  return {
    state,
    session: state.sessions.find((item) => item.id === state.activeSessionId) ?? null
  };
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

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 700,
    title: "CoCreate",
    backgroundColor: "#f7f7f5",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(rootDir, "dist", "index.html"));
  }
}

async function resolveCodexStatus() {
  try {
    const { stdout, stderr } = await execFileAsync(codexBinary, ["--version"], {
      timeout: 5000
    });
    return {
      available: true,
      binary: codexBinary,
      version: (stdout || stderr).trim() || "installed",
      license: "Apache-2.0",
      source: "https://github.com/openai/codex",
      mode: "cli-upstream"
    };
  } catch (cause) {
    return {
      available: false,
      binary: codexBinary,
      version: null,
      license: "Apache-2.0",
      source: "https://github.com/openai/codex",
      mode: "cli-upstream",
      error:
        cause instanceof Error
          ? cause.message
          : "Codex CLI is not available in PATH."
    };
  }
}

async function runCodexPrompt(prompt) {
  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmedPrompt) {
    throw new Error("No hay prompt para ejecutar en Codex.");
  }

  const runDir = await mkdtemp(path.join(tmpdir(), "cocreate-codex-"));
  const lastMessagePath = path.join(runDir, "last-message.txt");

  return await new Promise((resolve, reject) => {
    const child = spawn(
      codexBinary,
      [
        "exec",
        "--cd",
        rootDir,
        "--sandbox",
        "workspace-write",
        "--output-last-message",
        lastMessagePath,
        "-"
      ],
      {
        cwd: rootDir,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex tardó demasiado y se detuvo la ejecución."));
    }, 10 * 60 * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (cause) => {
      clearTimeout(timeout);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = stdout.trim();
      const diagnostics = stderr.trim();
      if (code === 0) {
        readFile(lastMessagePath, "utf8")
          .catch(() => output || diagnostics || "Codex terminó sin salida.")
          .then((lastMessage) => {
            resolve({
              ok: true,
              output: lastMessage.trim() || output || diagnostics || "Codex terminó sin salida.",
              stderr: diagnostics
            });
          })
          .finally(() => {
            rm(runDir, { recursive: true, force: true }).catch(() => {});
          });
        return;
      }

      rm(runDir, { recursive: true, force: true }).catch(() => {});
      reject(new Error(diagnostics || output || `Codex terminó con código ${code}.`));
    });

    child.stdin.write(trimmedPrompt);
    child.stdin.end();
  });
}

function assertOk(response, payload) {
  if (response.ok) {
    return;
  }

  const detail =
    payload && typeof payload === "object"
      ? JSON.stringify(payload)
      : typeof payload === "string"
        ? payload
        : response.statusText;

  throw new Error(`Gemini API ${response.status}: ${detail}`);
}

async function startResumableUpload({ apiKey, mimeType, fileSize, displayName }) {
  const response = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileSize),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      file: {
        display_name: displayName
      }
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    assertOk(response, payload);
  }

  const uploadUrl = response.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("No pude obtener la URL de subida resumable de Gemini.");
  }

  return uploadUrl;
}

async function uploadFileBytes({ uploadUrl, buffer }) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: buffer
  });

  const payload = await response.json().catch(() => null);
  assertOk(response, payload);

  if (!payload?.file?.uri || !payload?.file?.name) {
    throw new Error("Gemini no devolvio la referencia del archivo subido.");
  }

  return payload.file;
}

async function waitForFileActive({ apiKey, fileName }) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      headers: {
        "x-goog-api-key": apiKey
      }
    });

    const payload = await response.json().catch(() => null);
    assertOk(response, payload);

    const state = typeof payload?.state === "string" ? payload.state : payload?.state?.name;

    if (state === "ACTIVE") {
      return payload;
    }

    if (state === "FAILED") {
      throw new Error("Gemini marco el video como FAILED durante el procesamiento.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error("Gemini no termino de procesar el video dentro del tiempo esperado.");
}

function extractInteractionText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const fragments = [];
  for (const step of payload?.steps ?? []) {
    for (const part of step?.content ?? []) {
      if (part?.type === "text" && typeof part.text === "string") {
        fragments.push(part.text.trim());
      }
    }
  }

  return fragments.filter(Boolean).join("\n\n").trim();
}

function buildAnalysisPrompt(userNotes) {
  const noteBlock = userNotes?.trim()
    ? `Contexto extra del usuario:\n${userNotes.trim()}`
    : "Contexto extra del usuario:\nNo se proporciono contexto adicional.";

  return [
    "Analiza esta grabacion de pantalla como si fueras un operador senior que prepara instrucciones para OpenAI Codex.",
    "Tu objetivo es convertir lo observado en prompts listos para pegar en Codex y ejecutar trabajo tecnico.",
    "Responde en espanol.",
    "Si faltan detalles, haz suposiciones prudentes y decláralas.",
    "Usa exactamente esta estructura Markdown:",
    "# Resumen",
    "# Lo que parece querer el usuario",
    "# Prompt principal para Codex",
    "```text",
    "PROMPT AQUI",
    "```",
    "# Prompt de seguimiento",
    "```text",
    "PROMPT AQUI",
    "```",
    "# Checklist de ejecucion",
    "- item",
    "# Riesgos o vacios",
    "- item",
    noteBlock
  ].join("\n\n");
}

async function createInteraction({ apiKey, model, fileUri, mimeType, userNotes }) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          type: "video",
          uri: fileUri,
          mime_type: mimeType
        },
        {
          type: "text",
          text: buildAnalysisPrompt(userNotes)
        }
      ]
    })
  });

  const payload = await response.json().catch(() => null);
  assertOk(response, payload);

  const text = extractInteractionText(payload);
  if (!text) {
    throw new Error("Gemini respondio, pero no devolvio texto util para convertir en prompts.");
  }

  return text;
}

ipcMain.handle("app:get-config", async () => {
  const outputDir = getAppVideoDir();
  await mkdir(outputDir, { recursive: true });

  return {
    outputDir,
    defaultGeminiModel,
    platform: process.platform,
    stateStorePath: getStateStorePath(),
    featureFlags,
    codex: await resolveCodexStatus()
  };
});

ipcMain.handle("app-state:get", async () => {
  const state = await loadPersistedState();
  const session = ensureActiveSession(state);
  await savePersistedState(state);
  return {
    state,
    session,
    featureFlags
  };
});

ipcMain.handle("app-state:save-renderer", async (_event, payload) => {
  const result = await updatePersistedState(async (state, session) => {
    const title = payload?.title;
    if (typeof title === "string" && title.trim()) {
      session.title = title.trim().slice(0, 120);
    }

    session.renderer = {
      ...session.renderer,
      workbench: payload?.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null
    };
    appendSessionEvent(session, {
      type: "renderer.snapshot.saved",
      source: "renderer",
      payload: {
        mode: payload?.snapshot?.activeMode ?? null
      }
    });
    state.activeSessionId = session.id;
  });

  return {
    ok: true,
    sessionId: result.session?.id ?? null,
    updatedAt: result.state.updatedAt
  };
});

ipcMain.handle("app-state:append-event", async (_event, payload) => {
  const result = await updatePersistedState(async (_state, session) => {
    appendSessionEvent(session, payload);
  });

  return {
    ok: true,
    sessionId: result.session?.id ?? null
  };
});

ipcMain.handle("codex:status", async () => resolveCodexStatus());

ipcMain.handle("codex:run", async (_event, payload) => {
  const result = await runCodexPrompt(payload?.prompt ?? "");
  await updatePersistedState(async (_state, session) => {
    appendSessionEvent(session, {
      type: "codex.run.completed",
      source: "main",
      payload: {
        ok: result.ok,
        promptPreview: typeof payload?.prompt === "string" ? payload.prompt.slice(0, 280) : "",
        outputPreview: typeof result.output === "string" ? result.output.slice(0, 280) : ""
      }
    });
  });
  return result;
});

ipcMain.handle("recording:save", async (_event, payload) => {
  const outputDir = getAppVideoDir();
  await mkdir(outputDir, { recursive: true });

  const preferredName = payload?.suggestedName ? sanitizeFileName(payload.suggestedName) : "";
  const extension =
    payload?.mimeType === "video/mp4" ? "mp4" : payload?.mimeType?.includes("webm") ? "webm" : "bin";
  const fileName = preferredName
    ? `${preferredName}.${extension}`
    : buildRecordingName();
  const filePath = path.join(outputDir, fileName);

  const buffer = Buffer.from(payload.buffer);
  await writeFile(filePath, buffer);

  await updatePersistedState(async (_state, session) => {
    appendSessionEvent(session, {
      type: "recording.saved",
      source: "main",
      payload: {
        filePath,
        fileSize: buffer.byteLength,
        mimeType: payload?.mimeType ?? null
      }
    });
  });

  return {
    filePath,
    fileSize: buffer.byteLength
  };
});

ipcMain.handle("analysis:run", async (_event, payload) => {
  const apiKey = payload?.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Falta la API key de Gemini.");
  }

  const filePath = payload?.filePath;
  const mimeType = payload?.mimeType ?? "video/webm";
  const model = payload?.model?.trim() || defaultGeminiModel;

  if (!filePath) {
    throw new Error("No hay video guardado para analizar.");
  }

  const fileBuffer = await readFile(filePath);
  const displayName = path.basename(filePath);
  const uploadUrl = await startResumableUpload({
    apiKey,
    mimeType,
    fileSize: fileBuffer.byteLength,
    displayName
  });
  const file = await uploadFileBytes({
    uploadUrl,
    buffer: fileBuffer
  });
  await waitForFileActive({
    apiKey,
    fileName: file.name
  });

  const output = await createInteraction({
    apiKey,
    model,
    fileUri: file.uri,
    mimeType,
    userNotes: payload?.notes ?? ""
  });

  await updatePersistedState(async (_state, session) => {
    appendSessionEvent(session, {
      type: "analysis.completed",
      source: "main",
      payload: {
        model,
        filePath,
        fileName: file.name,
        promptPreview: output.slice(0, 280)
      }
    });
  });

  return {
    model,
    fileUri: file.uri,
    fileName: file.name,
    output
  };
});

ipcMain.handle("clipboard:write-text", async (_event, value) => {
  clipboard.writeText(typeof value === "string" ? value : "");
  return { ok: true };
});

ipcMain.handle("app:close", () => {
  app.quit();
});

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  app.quit();
});
