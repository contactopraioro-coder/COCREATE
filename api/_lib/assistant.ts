type ChatMessage = {
  role: "user" | "assistant" | "system";
  body: string;
};

type ChatRequest = {
  prompt: string;
  history?: ChatMessage[];
};

type TranscriptionRequest = {
  audioBase64: string;
  mimeType: string;
  language?: string;
};

type ChatResult = {
  ok: boolean;
  output: string;
  provider: "openai" | "gemini" | "fallback";
};

type TranscriptionResult = {
  ok: boolean;
  text: string;
  provider: "openai" | "browser-fallback";
};

const defaultOpenAIModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const defaultTranscribeModel = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
const defaultGeminiModel = process.env.GEMINI_WEB_MODEL ?? "gemini-2.5-flash";

function cleanHistory(history: ChatMessage[] = []) {
  return history
    .filter((message) => typeof message?.body === "string" && message.body.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.body.trim()
    }));
}

function extractOpenAIText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.filter(Boolean).join("\n\n").trim();
}

function extractGeminiText(payload: any) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();

  return text || "";
}

function buildFallbackReply(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  const now = new Date();

  if (normalized.includes("hora")) {
    return `Ahora mismo son las ${now.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit"
    })}.`;
  }

  if (normalized.includes("fecha") || normalized.includes("dia")) {
    return `Hoy es ${now.toLocaleDateString("es-CO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    })}.`;
  }

  if (normalized.includes("capital de colombia")) {
    return "La capital de Colombia es Bogota.";
  }

  if (normalized.includes("hola")) {
    return "Hola. Ya quedo activo el modo web. Si conectas una API key en el backend, tambien puedo responder con IA completa y transcribir voz.";
  }

  return [
    "Ya estoy respondiendo en el modo web de CoCreate.",
    "En este despliegue todavia falta configurar `OPENAI_API_KEY` o `GEMINI_API_KEY` en Vercel para respuestas de IA completas.",
    `Tu mensaje fue: \"${prompt.trim()}\"`,
    "Puedo seguir sirviendo como fallback y darte respuestas basicas mientras activamos la clave del backend."
  ].join("\n\n");
}

export async function generateAssistantReply({ prompt, history = [] }: ChatRequest): Promise<ChatResult> {
  const text = prompt.trim();
  if (!text) {
    throw new Error("No hay prompt para responder.");
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model: defaultOpenAIModel,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Eres CoCreate Web. Responde en espanol, de forma breve, util y clara. Ayuda a construir, depurar y planear software."
              }
            ]
          },
          ...cleanHistory(history).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            content: [
              {
                type: "input_text",
                text: message.content
              }
            ]
          })),
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text
              }
            ]
          }
        ]
      })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "OpenAI no pudo responder.");
    }

    const output = extractOpenAIText(payload);
    if (!output) {
      throw new Error("OpenAI no devolvio texto util.");
    }

    return {
      ok: true,
      output,
      provider: "openai"
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${defaultGeminiModel}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    "Eres CoCreate Web. Responde en espanol, de forma breve, util y clara.",
                    "Historial reciente:",
                    ...cleanHistory(history).map((message) => `${message.role}: ${message.content}`),
                    `Mensaje actual: ${text}`
                  ].join("\n")
                }
              ]
            }
          ]
        })
      }
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "Gemini no pudo responder.");
    }

    const output = extractGeminiText(payload);
    if (!output) {
      throw new Error("Gemini no devolvio texto util.");
    }

    return {
      ok: true,
      output,
      provider: "gemini"
    };
  }

  return {
    ok: true,
    output: buildFallbackReply(text),
    provider: "fallback"
  };
}

export async function transcribeAudio({ audioBase64, mimeType, language = "es" }: TranscriptionRequest): Promise<TranscriptionResult> {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiKey) {
    throw new Error("La transcripcion de voz en web requiere `OPENAI_API_KEY` en Vercel.");
  }

  const bytes = Buffer.from(audioBase64, "base64");
  const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
  const formData = new FormData();
  formData.append("model", defaultTranscribeModel);
  formData.append("language", language);
  formData.append("file", new Blob([bytes], { type: mimeType }), `voice-note.${extension}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`
    },
    body: formData
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "OpenAI no pudo transcribir el audio.");
  }

  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new Error("La transcripcion llego vacia.");
  }

  return {
    ok: true,
    text,
    provider: "openai"
  };
}
