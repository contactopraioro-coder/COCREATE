import "dotenv/config";
import { app, BrowserWindow, clipboard, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const defaultGeminiModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

let mainWindow = null;

function getAppVideoDir() {
  return path.join(app.getPath("movies"), "Caleidoscopio");
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function buildRecordingName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `caleidoscopio-${stamp}.webm`;
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "Caleidoscopio Recorder",
    backgroundColor: "#f2efe8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(rootDir, "overlay-dist", "overlay.html"));
  }
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
    defaultGeminiModel
  };
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
