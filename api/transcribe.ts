import { normalizeProviderError } from "../shared/provider-runtime.js";
import { createServerProviderRuntime } from "./_lib/server-provider-runtime.js";

type ApiRequest = { method?: string; body?: any };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const result = await createServerProviderRuntime().execute({
      operation: "transcription",
      capability: "transcription",
      input: {
        audioBase64: typeof request.body?.audioBase64 === "string" ? request.body.audioBase64 : "",
        mimeType: typeof request.body?.mimeType === "string" ? request.body.mimeType : "audio/webm",
        language: typeof request.body?.language === "string" ? request.body.language : "es"
      }
    });
    response.status(200).json({ ok: true, text: result.output, provider: result.provider });
  } catch (cause) {
    const error = normalizeProviderError(cause);
    response.status(500).json({ error: error.safeMessage, code: error.code });
  }
}
