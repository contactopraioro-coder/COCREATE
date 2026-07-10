type ApiRequest = {
  method?: string;
  body?: any;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type ChatMessage = {
  role: "user" | "assistant" | "system";
  body: string;
};

const defaultOpenAIModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const defaultGeminiModel = process.env.GEMINI_WEB_MODEL ?? "gemini-2.5-flash";
const searchProvider = process.env.SEARCH_PROVIDER ?? "auto";

function cleanHistory(history: ChatMessage[] = []) {
  return history
    .filter((message) => typeof message?.body === "string" && message.body.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.body.trim()
    }));
}

function buildOpenAIInput(history: ChatMessage[], prompt: string) {
  const transcript = cleanHistory(history)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    "Eres CoCreate Web. Responde en espanol, de forma breve, util y clara. Ayuda a construir, depurar y planear software.",
    transcript ? `Historial reciente:\n${transcript}` : "Historial reciente: sin mensajes previos.",
    `Mensaje actual: ${prompt}`
  ].join("\n\n");
}

function shouldUseSearch(prompt: string) {
  const normalized = prompt.trim().toLowerCase();

  const signals = [
    "actual",
    "actualmente",
    "hoy",
    "ahora",
    "reciente",
    "recientes",
    "ultima",
    "ultimas",
    "ultimo",
    "ultimos",
    "quien es",
    "quién es",
    "alcalde",
    "presidente",
    "gobernador",
    "ceo",
    "precio",
    "cuanto vale",
    "cuánto vale",
    "cuanta gente",
    "cuánta gente",
    "poblacion",
    "población",
    "vive en",
    "noticia",
    "noticias",
    "resultados",
    "marcador",
    "2026",
    "2025",
    "este año",
    "esta semana",
    "este mes"
  ];

  return signals.some((signal) => normalized.includes(signal));
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
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const interactionText = payload?.output
    ?.map((item: { content?: Array<{ type?: string; text?: string }> }) =>
      (item?.content ?? [])
        .map((part) => (part?.type === "output_text" && typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (interactionText) {
    return interactionText;
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();

  return text || "";
}

async function requestGeminiResponse(history: ChatMessage[], prompt: string, geminiKey: string) {
  const aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": geminiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: defaultGeminiModel,
      input: [
        {
          type: "text",
          text: [
            "Eres CoCreate Web. Responde en espanol, de forma breve, util y clara.",
            "Usa Google Search de forma autonoma cuando la pregunta requiera actualidad o precision factual.",
            "Historial reciente:",
            ...cleanHistory(history).map((message) => `${message.role}: ${message.content}`),
            `Mensaje actual: ${prompt}`
          ].join("\n")
        }
      ],
      tools: [{ type: "google_search" }]
    })
  });

  const payload = await aiResponse.json().catch(() => null);
  if (!aiResponse.ok) {
    throw new Error(payload?.error?.message ?? "Gemini no pudo responder.");
  }

  const output = extractGeminiText(payload);
  if (!output) {
    throw new Error("Gemini no devolvio texto util.");
  }

  return output;
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
    return "Hola. Ya quedo activo el modo web. Si conectas una API key en el backend, tambien puedo responder con IA completa.";
  }

  return [
    "Ya estoy respondiendo en el modo web de CoCreate.",
    "En este despliegue todavia falta configurar `OPENAI_API_KEY` o `GEMINI_API_KEY` en Vercel para respuestas de IA completas.",
    `Tu mensaje fue: \"${prompt.trim()}\"`
  ].join("\n\n");
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    const history = Array.isArray(request.body?.history) ? request.body.history : [];
    const needsSearch = shouldUseSearch(prompt);

    if (!prompt) {
      response.status(400).json({ error: "No hay prompt para responder." });
      return;
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    const preferGemini =
      searchProvider === "gemini" || (searchProvider === "auto" && needsSearch && geminiKey && !openAiKey);

    if (preferGemini && geminiKey) {
      try {
        const output = await requestGeminiResponse(history, prompt, geminiKey);
        response.status(200).json({
          ok: true,
          output,
          provider: "gemini"
        });
        return;
      } catch (error) {
        if (!openAiKey) {
          throw error;
        }
      }
    }

    if (openAiKey) {
      const tools = [
        {
          type: "web_search",
          user_location: {
            type: "approximate",
            country: "CO",
            city: "Medellin",
            region: "Antioquia"
          },
          external_web_access: true
        }
      ];

      const aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: defaultOpenAIModel,
          input: buildOpenAIInput(history, prompt),
          tools,
          tool_choice: needsSearch ? "required" : "auto"
        })
      });

      const payload = await aiResponse.json().catch(() => null);
      if (!aiResponse.ok) {
        throw new Error(payload?.error?.message ?? "OpenAI no pudo responder.");
      }

      const output = extractOpenAIText(payload);
      if (!output) {
        throw new Error("OpenAI no devolvio texto util.");
      }

      response.status(200).json({
        ok: true,
        output,
        provider: "openai"
      });
      return;
    }

    if (geminiKey) {
      const output = await requestGeminiResponse(history, prompt, geminiKey);
      response.status(200).json({
        ok: true,
        output,
        provider: "gemini"
      });
      return;
    }

    response.status(200).json({
      ok: true,
      output: buildFallbackReply(prompt),
      provider: "fallback"
    });
  } catch (cause) {
    response.status(500).json({
      error: cause instanceof Error ? cause.message : "No pude responder en CoCreate Web."
    });
  }
}
