import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProviderRegistry, ProviderRuntime } from "../shared/provider-runtime.js";
import { createGeminiScreenAnalysisProvider } from "./providers/gemini-screen-analysis-provider.mjs";

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function buildRecordingName() {
  return `caleidoscopio-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
}

export function createAnalysisService({ getVideoDir, defaultGeminiModel, geminiApiKey, appStateStore }) {
  const providerRuntime = new ProviderRuntime({
    registry: new ProviderRegistry([
      createGeminiScreenAnalysisProvider({ apiKey: geminiApiKey, defaultModel: defaultGeminiModel })
    ]),
    timeoutMs: 10 * 60 * 1000,
    observer(event) {
      const logger = event.type === "provider.failed" ? console.error : console.debug;
      logger("[ProviderRuntime]", event);
    }
  });

  async function saveRecording(payload) {
    const outputDir = getVideoDir();
    await mkdir(outputDir, { recursive: true });
    const preferredName = payload?.suggestedName ? sanitizeFileName(payload.suggestedName) : "";
    const extension = payload?.mimeType === "video/mp4" ? "mp4" : payload?.mimeType?.includes("webm") ? "webm" : "bin";
    const fileName = preferredName ? `${preferredName}.${extension}` : buildRecordingName();
    const filePath = path.join(outputDir, fileName);
    const buffer = Buffer.from(payload.buffer);
    await writeFile(filePath, buffer);
    await appStateStore.update(async (_state, session) => {
      appStateStore.appendSessionEvent(session, {
        type: "recording.saved",
        source: "main",
        payload: { filePath, fileSize: buffer.byteLength, mimeType: payload?.mimeType ?? null }
      });
    });
    return { filePath, fileSize: buffer.byteLength };
  }

  async function analyzeRecording(payload) {
    const result = await providerRuntime.execute({
      operation: "multimodal-analysis",
      capability: "screen-analysis",
      input: {
        filePath: payload?.filePath,
        mimeType: payload?.mimeType,
        model: payload?.model,
        notes: payload?.notes
      }
    });
    await appStateStore.update(async (_state, session) => {
      appStateStore.appendSessionEvent(session, {
        type: "analysis.completed",
        source: "main",
        payload: { filePath: payload?.filePath, model: result.model, provider: result.provider }
      });
    });
    return {
      output: result.output,
      model: result.model,
      provider: result.provider,
      requestId: result.requestId,
      fileName: path.basename(payload.filePath)
    };
  }

  return { saveRecording, analyzeRecording };
}
