import { ProviderRegistry, ProviderRuntime } from "../shared/provider-runtime.js";
import { createOpenAITranscriptionProvider } from "./providers/openai-transcription-provider.mjs";

const allowedMimeTypes = new Set(["audio/webm", "audio/webm;codecs=opus", "audio/mp4", "audio/ogg"]);
const maxBase64Length = 16 * 1024 * 1024;

export function registerVoiceIpc({ ipcMain, apiKey, model, fetchImpl }) {
  const provider = createOpenAITranscriptionProvider({ apiKey, model, fetchImpl });
  const runtime = new ProviderRuntime({
    registry: new ProviderRegistry([provider]),
    timeoutMs: 45_000
  });

  ipcMain.handle("cocreate:voice:status", () => provider.getHealth());
  ipcMain.handle("cocreate:voice:transcribe", async (_event, payload = {}) => {
    const audioBase64 = typeof payload.audioBase64 === "string" ? payload.audioBase64 : "";
    const mimeType = allowedMimeTypes.has(payload.mimeType) ? payload.mimeType : "";
    if (!audioBase64 || audioBase64.length > maxBase64Length || !/^[A-Za-z0-9+/=]+$/.test(audioBase64) || !mimeType) {
      throw new Error("La nota de voz no tiene un formato o tamano permitido.");
    }
    const result = await runtime.execute({
      operation: "transcription",
      capability: "transcription",
      requiredProvider: "openai-transcription",
      input: {
        audioBase64,
        mimeType,
        language: typeof payload.language === "string" ? payload.language.slice(0, 12) : "es"
      }
    });
    return { ok: true, text: result.output, provider: result.provider, model: result.model };
  });

  return () => {
    ipcMain.removeHandler("cocreate:voice:status");
    ipcMain.removeHandler("cocreate:voice:transcribe");
  };
}
