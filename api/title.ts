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

const defaultOpenAIModel = process.env.OPENAI_TITLE_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const defaultGeminiModel = process.env.GEMINI_WEB_MODEL ?? "gemini-2.5-flash";

function cleanHistory(history: ChatMessage[] = []) {
  return history
    .filter((message) => typeof message?.body === "string" && message.body.trim())
    .slice(-4)
    .map((message) => `${message.role}: ${message.body.trim()}`);
}

function sanitizeTitle(title: string) {
  return title.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\.+$/g, "").slice(0, 48).trim();
}

function buildFallbackTitle(prompt: string) {
  const clean = prompt
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");

  return sanitizeTitle(clean || "Nuevo chat");
}

function extractOpenAIText(payload: any) {
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

  return fragments.filter(Boolean).join("\n").trim();
}

function extractGeminiText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();

  return text || "";
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
  const history = Array.isArray(request.body?.history) ? (request.body.history as ChatMessage[]) : [];

  if (!prompt) {
    response.status(400).json({ error: "No hay prompt para titular." });
    return;
  }

  const instruction = [
    "Genera un titulo corto para un chat de producto o programacion.",
    "Debe estar en espanol.",
    "Maximo 5 palabras.",
    "Sin comillas ni punto final.",
    "Devuelve solo el titulo."
  ].join("\n");

  try {
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    if (openAiKey) {
      const aiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: defaultOpenAIModel,
          input: [instruction, ...cleanHistory(history), `Mensaje actual: ${prompt}`].join("\n\n")
        })
      });

      const payload = await aiResponse.json().catch(() => null);
      if (aiResponse.ok) {
        const title = sanitizeTitle(extractOpenAIText(payload));
        response.status(200).json({ ok: true, title: title || buildFallbackTitle(prompt) });
        return;
      }
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey) {
      const aiResponse = await fetch(
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
                    text: [instruction, ...cleanHistory(history), `Mensaje actual: ${prompt}`].join("\n\n")
                  }
                ]
              }
            ]
          })
        }
      );

      const payload = await aiResponse.json().catch(() => null);
      if (aiResponse.ok) {
        const title = sanitizeTitle(extractGeminiText(payload));
        response.status(200).json({ ok: true, title: title || buildFallbackTitle(prompt) });
        return;
      }
    }

    response.status(200).json({ ok: true, title: buildFallbackTitle(prompt) });
  } catch (cause) {
    response.status(200).json({
      ok: true,
      title: buildFallbackTitle(prompt),
      warning: cause instanceof Error ? cause.message : "No pude titular por API."
    });
  }
}
