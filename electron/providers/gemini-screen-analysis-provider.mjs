import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFunctionProviderAdapter, createProviderError } from "../../shared/provider-runtime.js";

function assertOk(response, payload, requestId) {
  if (response.ok) return;
  const detail = payload && typeof payload === "object" ? JSON.stringify(payload) : String(payload ?? response.statusText);
  throw createProviderError(response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UPSTREAM_ERROR", detail, {
    provider: "gemini-screen-analysis",
    requestId,
    status: response.status,
    kind: response.status === 429 ? "rate-limit" : "upstream",
    health: response.status === 429 ? "Rate Limited" : response.status === 503 ? "Maintenance" : "Unavailable",
    safeMessage: "El proveedor de análisis de video no pudo completar la solicitud.",
    retriable: response.status === 429 || response.status >= 500
  });
}

async function startResumableUpload({ apiKey, mimeType, fileSize, displayName, signal, requestId }) {
  const response = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    signal,
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileSize),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: displayName } })
  });
  if (!response.ok) assertOk(response, await response.text(), requestId);
  const uploadUrl = response.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw createProviderError("PROVIDER_INVALID_RESPONSE", "Gemini no devolvió URL de subida.", {
      provider: "gemini-screen-analysis",
      requestId,
      kind: "parsing",
      safeMessage: "El proveedor no devolvió una referencia de subida válida."
    });
  }
  return uploadUrl;
}

async function uploadFileBytes({ uploadUrl, buffer, signal, requestId }) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    signal,
    headers: {
      "Content-Length": String(buffer.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: buffer
  });
  const payload = await response.json().catch(() => null);
  assertOk(response, payload, requestId);
  if (!payload?.file?.uri || !payload?.file?.name) {
    throw createProviderError("PROVIDER_INVALID_RESPONSE", "Gemini no devolvió el archivo subido.", {
      provider: "gemini-screen-analysis",
      requestId,
      kind: "parsing",
      safeMessage: "El proveedor no devolvió una referencia de archivo válida."
    });
  }
  return payload.file;
}

async function waitForFileActive({ apiKey, fileName, signal, requestId }) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      signal,
      headers: { "x-goog-api-key": apiKey }
    });
    const payload = await response.json().catch(() => null);
    assertOk(response, payload, requestId);
    const state = typeof payload?.state === "string" ? payload.state : payload?.state?.name;
    if (state === "ACTIVE") return;
    if (state === "FAILED") {
      throw createProviderError("PROVIDER_PROCESSING_FAILED", "Gemini marcó el video como FAILED.", {
        provider: "gemini-screen-analysis",
        requestId,
        kind: "upstream",
        safeMessage: "El proveedor no pudo procesar el video."
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw createProviderError("PROVIDER_TIMEOUT", "Gemini no terminó de procesar el video.", {
    provider: "gemini-screen-analysis",
    requestId,
    kind: "timeout",
    safeMessage: "El análisis de video tardó demasiado.",
    retriable: true
  });
}

function extractText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const fragments = [];
  for (const step of payload?.steps ?? []) {
    for (const part of step?.content ?? []) {
      if (part?.type === "text" && typeof part.text === "string") fragments.push(part.text.trim());
    }
  }
  return fragments.filter(Boolean).join("\n\n").trim();
}

function buildPrompt(notes) {
  return [
    "Analiza esta grabacion de pantalla como si fueras un operador senior que prepara instrucciones para OpenAI Codex.",
    "Convierte lo observado en prompts técnicos accionables. Responde en espanol y declara cualquier suposición.",
    "Usa esta estructura Markdown: # Resumen, # Lo que parece querer el usuario, # Prompt principal para Codex, # Prompt de seguimiento, # Checklist de ejecucion, # Riesgos o vacios.",
    notes?.trim() ? `Contexto extra del usuario:\n${notes.trim()}` : "No se proporcionó contexto adicional."
  ].join("\n\n");
}

export function createGeminiScreenAnalysisProvider({ apiKey, defaultModel }) {
  return createFunctionProviderAdapter({
    id: "gemini-screen-analysis",
    name: "Gemini Screen Analysis (Legacy)",
    capabilities: {
      operations: ["multimodal-analysis"],
      domains: ["screen-analysis"],
      streaming: false,
      tools: false,
      reasoning: true,
      multimodal: true,
      embeddings: false
    },
    metadata: { model: defaultModel, scope: "legacy-specialized" },
    async getHealth() {
      return apiKey
        ? { status: "Healthy" }
        : { status: "Misconfigured", message: "GEMINI_API_KEY no está configurada en el proceso principal." };
    },
    async execute(request) {
      const input = request.input ?? {};
      if (!apiKey) {
        throw createProviderError("PROVIDER_MISCONFIGURED", "GEMINI_API_KEY no está configurada.", {
          provider: "gemini-screen-analysis",
          requestId: request.requestId,
          kind: "configuration",
          health: "Misconfigured",
          safeMessage: "El análisis de video no está configurado en este entorno."
        });
      }
      if (!input.filePath) {
        throw createProviderError("PROVIDER_INVALID_REQUEST", "No hay video guardado para analizar.", {
          provider: "gemini-screen-analysis",
          requestId: request.requestId,
          kind: "validation",
          safeMessage: "No hay video guardado para analizar."
        });
      }
      const mimeType = input.mimeType ?? "video/webm";
      const model = input.model?.trim() || defaultModel;
      const fileBuffer = await readFile(input.filePath);
      const uploadUrl = await startResumableUpload({
        apiKey,
        mimeType,
        fileSize: fileBuffer.byteLength,
        displayName: path.basename(input.filePath),
        signal: request.signal,
        requestId: request.requestId
      });
      const file = await uploadFileBytes({ uploadUrl, buffer: fileBuffer, signal: request.signal, requestId: request.requestId });
      await waitForFileActive({ apiKey, fileName: file.name, signal: request.signal, requestId: request.requestId });
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        signal: request.signal,
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [
            { type: "video", uri: file.uri, mime_type: mimeType },
            { type: "text", text: buildPrompt(input.notes ?? "") }
          ]
        })
      });
      const payload = await response.json().catch(() => null);
      assertOk(response, payload, request.requestId);
      const output = extractText(payload);
      if (!output) {
        throw createProviderError("PROVIDER_EMPTY_RESPONSE", "Gemini no devolvió texto útil.", {
          provider: "gemini-screen-analysis",
          requestId: request.requestId,
          kind: "parsing",
          safeMessage: "El proveedor no devolvió texto útil."
        });
      }
      return { output, model };
    }
  });
}
