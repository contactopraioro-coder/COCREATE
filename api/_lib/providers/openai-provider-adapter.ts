import {
  createFunctionProviderAdapter,
  createProviderError,
  type ProviderAdapter,
  type ProviderRequest
} from "../../../shared/provider-runtime.js";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  body: string;
};

type WebAttachment = {
  name: string;
  kind: "image" | "file";
  type: string;
  dataBase64: string;
};

type OpenAIProviderOptions = {
  apiKey?: string;
  chatModel?: string;
  transcriptionModel?: string;
  fetchImpl?: typeof fetch;
};

const MAX_INLINE_ATTACHMENT_CHARACTERS = 200_000;

function cleanHistory(history: ChatMessage[] = []) {
  return history
    .filter((message) => typeof message?.body === "string" && message.body.trim())
    .slice(-8)
    .map((message) => `${message.role}: ${message.body.trim()}`)
    .join("\n");
}

function buildChatText(input: { prompt?: string; history?: ChatMessage[]; instruction?: string }) {
  if (input.instruction) {
    return input.instruction;
  }
  const transcript = cleanHistory(input.history);
  return [
    "Eres CoCreate Web. Responde en espanol, de forma breve, util y clara. Ayuda a construir, depurar y planear software.",
    transcript ? `Historial reciente:\n${transcript}` : "Historial reciente: sin mensajes previos.",
    `Mensaje actual: ${input.prompt ?? ""}`
  ].join("\n\n");
}

function isPdfAttachment(attachment: WebAttachment) {
  return attachment.type === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf");
}

function buildAttachmentInput(attachment: WebAttachment) {
  if (attachment.kind === "image") {
    return {
      type: "input_image",
      image_url: `data:${attachment.type};base64,${attachment.dataBase64}`,
      detail: "auto"
    };
  }
  if (isPdfAttachment(attachment)) {
    return {
      type: "input_file",
      filename: attachment.name,
      file_data: attachment.dataBase64
    };
  }

  const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8").replace(/\u0000/g, "");
  const truncated = decoded.length > MAX_INLINE_ATTACHMENT_CHARACTERS;
  const content = decoded.slice(0, MAX_INLINE_ATTACHMENT_CHARACTERS);
  return {
    type: "input_text",
    text: [
      `Archivo adjunto: ${attachment.name}`,
      "--- inicio del archivo ---",
      content,
      truncated ? "[Contenido truncado de forma segura por límite de contexto.]" : null,
      "--- fin del archivo ---"
    ].filter(Boolean).join("\n")
  };
}

function buildChatInput(input: { prompt?: string; history?: ChatMessage[]; instruction?: string; attachments?: WebAttachment[] }) {
  const text = buildChatText(input);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  if (!attachments.length) return text;
  return [{
    role: "user",
    content: [
      { type: "input_text", text },
      ...attachments.map(buildAttachmentInput)
    ]
  }];
}

function extractResponseText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const fragments: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        fragments.push(content.text.trim());
      }
    }
  }
  return fragments.filter(Boolean).join("\n\n").trim();
}

function failureForStatus(status: number, message: string, requestId: string | null, cause: unknown) {
  if (status === 429) {
    return createProviderError("PROVIDER_RATE_LIMITED", message, {
      provider: "openai",
      requestId,
      status,
      kind: "rate-limit",
      health: "Rate Limited",
      safeMessage: "OpenAI alcanzó su límite temporal o de cuota. Inténtalo más tarde.",
      retriable: true,
      cause
    });
  }
  if (status === 401 || status === 403) {
    return createProviderError("PROVIDER_MISCONFIGURED", message, {
      provider: "openai",
      requestId,
      status,
      kind: "authentication",
      health: "Misconfigured",
      safeMessage: "OpenAI no está autenticado correctamente en este entorno.",
      cause
    });
  }
  return createProviderError("PROVIDER_UPSTREAM_ERROR", message, {
    provider: "openai",
    requestId,
    status,
    kind: "upstream",
    health: status === 503 ? "Maintenance" : "Unavailable",
    safeMessage: "OpenAI no pudo completar la solicitud. Inténtalo de nuevo.",
    retriable: status >= 500,
    cause
  });
}

export function createOpenAIProviderAdapter(options: OpenAIProviderOptions = {}): ProviderAdapter {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? "";
  const chatModel = options.chatModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const transcriptionModel =
    options.transcriptionModel ?? process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function requestJson(url: string, init: RequestInit, request: ProviderRequest) {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: request.signal });
    } catch (cause) {
      if (request.signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) {
        throw createProviderError("PROVIDER_TIMEOUT", "OpenAI excedió el tiempo disponible.", {
          provider: "openai",
          requestId: request.requestId,
          kind: "timeout",
          health: "Unavailable",
          safeMessage: "OpenAI tardó demasiado en responder. Inténtalo de nuevo.",
          retriable: true,
          cause
        });
      }
      throw createProviderError("PROVIDER_NETWORK_ERROR", cause instanceof Error ? cause.message : "OpenAI no está accesible.", {
        provider: "openai",
        requestId: request.requestId,
        kind: "network",
        health: "Unavailable",
        safeMessage: "No pude conectar con OpenAI. Revisa la conexión e inténtalo de nuevo.",
        retriable: true,
        cause
      });
    }

    const payload = await response.json().catch(() => null);
    const upstreamRequestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string" ? payload.error.message : `OpenAI respondió con HTTP ${response.status}.`;
      throw failureForStatus(response.status, message, upstreamRequestId ?? request.requestId ?? null, payload);
    }
    return { payload, upstreamRequestId };
  }

  return createFunctionProviderAdapter({
    id: "openai",
    name: "OpenAI",
    capabilities: {
      operations: ["chat", "completion", "transcription"],
      domains: ["chat", "model", "completion", "transcription"],
      streaming: false,
      tools: true,
      reasoning: true,
      multimodal: true,
      embeddings: false
    },
    metadata: { models: { chat: chatModel, transcription: transcriptionModel } },
    async getHealth() {
      return apiKey
        ? { status: "Healthy" as const }
        : { status: "Misconfigured" as const, message: "OPENAI_API_KEY no está configurada." };
    },
    async execute(request) {
      if (!apiKey) {
        throw createProviderError("PROVIDER_MISCONFIGURED", "OPENAI_API_KEY no está configurada.", {
          provider: "openai",
          requestId: request.requestId,
          kind: "configuration",
          health: "Misconfigured",
          safeMessage: "OpenAI no está configurado en este entorno."
        });
      }

      if (request.operation === "transcription") {
        const input = request.input ?? {};
        const bytes = Buffer.from(typeof input.audioBase64 === "string" ? input.audioBase64 : "", "base64");
        const mimeType = typeof input.mimeType === "string" ? input.mimeType : "audio/webm";
        const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
        const formData = new FormData();
        formData.append("model", transcriptionModel);
        formData.append("language", typeof input.language === "string" ? input.language : "es");
        formData.append("file", new Blob([bytes], { type: mimeType }), `voice-note.${extension}`);
        const { payload, upstreamRequestId } = await requestJson(
          "https://api.openai.com/v1/audio/transcriptions",
          { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: formData },
          request
        );
        const output = typeof payload?.text === "string" ? payload.text.trim() : "";
        if (!output) {
          throw createProviderError("PROVIDER_EMPTY_RESPONSE", "OpenAI devolvió una transcripción vacía.", {
            provider: "openai",
            requestId: request.requestId,
            kind: "parsing",
            safeMessage: "La transcripción llegó vacía.",
            retriable: true
          });
        }
        return { output, model: transcriptionModel, metadata: { upstreamRequestId } };
      }

      const { payload, upstreamRequestId } = await requestJson(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: chatModel, input: buildChatInput(request.input ?? {}) })
        },
        request
      );
      const output = extractResponseText(payload);
      if (!output) {
        throw createProviderError("PROVIDER_EMPTY_RESPONSE", "OpenAI no devolvió texto útil.", {
          provider: "openai",
          requestId: request.requestId,
          kind: "parsing",
          safeMessage: "El modelo no devolvió texto útil. Inténtalo de nuevo.",
          retriable: true
        });
      }
      return {
        output,
        model: chatModel,
        usage: payload?.usage ?? null,
        metadata: { upstreamRequestId }
      };
    }
  });
}
