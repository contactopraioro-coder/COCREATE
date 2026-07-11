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
const defaultMemoryModel = process.env.OPENAI_MEMORY_MODEL ?? defaultOpenAIModel;
const searchProvider = process.env.SEARCH_PROVIDER ?? "auto";
const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

function isQuotaError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("exceeded your current quota") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("billing") ||
    normalized.includes("rate limit")
  );
}

function buildProviderUnavailableReply() {
  return [
    "La respuesta por OpenAI no esta disponible ahora mismo por cuota o facturacion del proyecto.",
    "Si configuras `GEMINI_API_KEY` en Vercel, CoCreate puede seguir respondiendo como respaldo.",
    "Tambien puedes revisar la facturacion de OpenAI y volver a intentar."
  ].join("\n\n");
}

function cleanHistory(history: ChatMessage[] = []) {
  return history
    .filter((message) => typeof message?.body === "string" && message.body.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.body.trim()
    }));
}

function buildOpenAIInput(history: ChatMessage[], prompt: string, memorySummary = "") {
  const transcript = cleanHistory(history)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    "Eres CoCreate Web. Responde en espanol, de forma breve, util y clara. Ayuda a construir, depurar y planear software.",
    memorySummary ? `Memoria persistente del usuario:\n${memorySummary}` : "Memoria persistente del usuario: sin memoria previa consolidada.",
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

async function requestGeminiResponse(history: ChatMessage[], prompt: string, geminiKey: string, memorySummary = "") {
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
            memorySummary ? `Memoria persistente del usuario:\n${memorySummary}` : "Memoria persistente del usuario: sin memoria previa consolidada.",
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

function canUseSupabase() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function normalizeClientId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function supabaseHeaders() {
  return {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json"
  };
}

async function fetchSupabaseJson(url: string, init?: RequestInit) {
  const result = await fetch(url, init);
  const payload = await result.json().catch(() => null);
  if (!result.ok) {
    throw new Error(payload?.message ?? payload?.error_description ?? payload?.error ?? "Supabase no pudo responder.");
  }
  return payload;
}

async function loadUserMemory(clientId: string) {
  if (!clientId || !canUseSupabase()) {
    return "";
  }

  const query = new URLSearchParams({
    select: "memory_summary",
    client_id: `eq.${clientId}`,
    limit: "1"
  });

  const payload = (await fetchSupabaseJson(`${supabaseUrl}/rest/v1/cocreate_profiles?${query.toString()}`, {
    headers: supabaseHeaders()
  })) as Array<{ memory_summary?: string | null }>;

  return typeof payload[0]?.memory_summary === "string" ? payload[0].memory_summary.trim() : "";
}

function buildMemoryInput(existingSummary: string, history: ChatMessage[], prompt: string, output: string) {
  const transcript = cleanHistory([
    ...history,
    { role: "user", body: prompt },
    { role: "assistant", body: output }
  ])
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    "Actualiza la memoria a largo plazo de un usuario de CoCreate.",
    "Conserva solo informacion duradera y util para futuras sesiones: proyectos en curso, stack, preferencias, decisiones, despliegues, herramientas, objetivos y datos personales solo si son relevantes para el trabajo.",
    "No guardes preguntas triviales temporales ni respuestas efimeras.",
    "Responde en espanol con maximo 8 bullets cortos.",
    existingSummary ? `Memoria previa:\n${existingSummary}` : "Memoria previa: vacia.",
    `Conversacion nueva:\n${transcript}`
  ].join("\n\n");
}

async function persistMemorySummary(clientId: string, summary: string) {
  if (!clientId || !summary || !canUseSupabase()) {
    return;
  }

  await fetchSupabaseJson(`${supabaseUrl}/rest/v1/cocreate_profiles?on_conflict=client_id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify([
      {
        client_id: clientId,
        memory_summary: summary.slice(0, 4000),
        updated_at: new Date().toISOString()
      }
    ])
  });
}

async function refreshMemorySummary(params: {
  clientId: string;
  existingSummary: string;
  history: ChatMessage[];
  prompt: string;
  output: string;
  openAiKey?: string;
}) {
  if (!params.clientId || !params.openAiKey || !canUseSupabase()) {
    return;
  }

  const aiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.openAiKey}`
    },
    body: JSON.stringify({
      model: defaultMemoryModel,
      input: buildMemoryInput(params.existingSummary, params.history, params.prompt, params.output)
    })
  });

  const payload = await aiResponse.json().catch(() => null);
  if (!aiResponse.ok) {
    throw new Error(payload?.error?.message ?? "No pude actualizar la memoria del usuario.");
  }

  const summary = extractOpenAIText(payload);
  if (!summary) {
    return;
  }

  await persistMemorySummary(params.clientId, summary);
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
    const clientId = normalizeClientId(request.body?.clientId);
    const needsSearch = shouldUseSearch(prompt);

    if (!prompt) {
      response.status(400).json({ error: "No hay prompt para responder." });
      return;
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    const memorySummary = await loadUserMemory(clientId).catch(() => "");
    const preferGemini =
      searchProvider === "gemini" || (searchProvider === "auto" && needsSearch && geminiKey && !openAiKey);

    if (preferGemini && geminiKey) {
      try {
        const output = await requestGeminiResponse(history, prompt, geminiKey, memorySummary);
        if (openAiKey && clientId) {
          void refreshMemorySummary({
            clientId,
            existingSummary: memorySummary,
            history,
            prompt,
            output,
            openAiKey
          }).catch(() => {});
        }
        response.status(200).json({
          ok: true,
          output,
          provider: "gemini",
          memorySummary
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
          input: buildOpenAIInput(history, prompt, memorySummary),
          tools,
          tool_choice: needsSearch ? "required" : "auto"
        })
      });

      const payload = await aiResponse.json().catch(() => null);
      if (!aiResponse.ok) {
        const message = payload?.error?.message ?? "OpenAI no pudo responder.";
        if (isQuotaError(message) && geminiKey) {
          const output = await requestGeminiResponse(history, prompt, geminiKey, memorySummary);
          response.status(200).json({
            ok: true,
            output,
            provider: "gemini",
            memorySummary
          });
          return;
        }

        if (isQuotaError(message)) {
          response.status(200).json({
            ok: true,
            output: buildProviderUnavailableReply(),
            provider: "fallback",
            memorySummary
          });
          return;
        }

        throw new Error(message);
      }

      const output = extractOpenAIText(payload);
      if (!output) {
        throw new Error("OpenAI no devolvio texto util.");
      }

      if (clientId) {
        void refreshMemorySummary({
          clientId,
          existingSummary: memorySummary,
          history,
          prompt,
          output,
          openAiKey
        }).catch(() => {});
      }

      response.status(200).json({
        ok: true,
        output,
        provider: "openai",
        memorySummary
      });
      return;
    }

    if (geminiKey) {
      const output = await requestGeminiResponse(history, prompt, geminiKey, memorySummary);
      response.status(200).json({
        ok: true,
        output,
        provider: "gemini",
        memorySummary
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
