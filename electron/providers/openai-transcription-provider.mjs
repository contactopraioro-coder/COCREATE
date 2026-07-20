import { createFunctionProviderAdapter, createProviderError } from "../../shared/provider-runtime.js";

export function createOpenAITranscriptionProvider(options = {}) {
  const apiKey = options.apiKey?.trim() ?? "";
  const model = options.model ?? "gpt-4o-mini-transcribe";
  const fetchImpl = options.fetchImpl ?? fetch;
  return createFunctionProviderAdapter({
    id: "openai-transcription",
    name: "OpenAI Transcription",
    capabilities: {
      operations: ["transcription"],
      domains: ["transcription"],
      streaming: false,
      tools: false,
      reasoning: false,
      multimodal: true,
      embeddings: false
    },
    metadata: { model },
    async getHealth() {
      return apiKey
        ? { status: "Healthy" }
        : { status: "Misconfigured", message: "OPENAI_API_KEY no esta configurada para voz Desktop." };
    },
    async execute(request) {
      if (!apiKey) {
        throw createProviderError("PROVIDER_MISCONFIGURED", "OPENAI_API_KEY no esta configurada.", {
          provider: "openai-transcription",
          kind: "configuration",
          health: "Misconfigured",
          safeMessage: "La transcripcion de voz no esta configurada en CoCreate Desktop."
        });
      }
      const buffer = Buffer.from(request.input?.audioBase64 ?? "", "base64");
      const mimeType = request.input?.mimeType ?? "audio/webm";
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: mimeType }), `voice.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
      form.append("model", model);
      if (request.input?.language) form.append("language", request.input.language);
      const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: request.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        console.error("[transcribe] OpenAI error", response.status, "bytes:", buffer.length, "mime:", mimeType, "model:", model, "->", JSON.stringify(payload)?.slice(0, 400));
        throw createProviderError("PROVIDER_UPSTREAM_ERROR", "OpenAI transcription failed.", {
          provider: "openai-transcription",
          kind: response.status === 429 ? "rate-limit" : "upstream",
          status: response.status,
          health: response.status === 429 ? "Rate Limited" : "Unavailable",
          safeMessage: response.status === 429
            ? "La transcripcion esta temporalmente limitada. Intentalo de nuevo."
            : "No pude transcribir la nota de voz."
        });
      }
      const output = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!output) {
        throw createProviderError("PROVIDER_EMPTY_RESPONSE", "OpenAI returned an empty transcription.", {
          provider: "openai-transcription",
          kind: "parsing",
          safeMessage: "La transcripcion llego vacia."
        });
      }
      return { output, model, metadata: { upstreamRequestId: response.headers.get("x-request-id") } };
    }
  });
}
