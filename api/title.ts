import { createServerProviderRuntime } from "./_lib/server-provider-runtime.js";

type ApiRequest = { method?: string; body?: any };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };
type ChatMessage = { role: "user" | "assistant" | "system"; body: string };

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
  return sanitizeTitle(prompt.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ") || "Nuevo chat");
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
    "Debe estar en espanol. Maximo 5 palabras. Sin comillas ni punto final.",
    ...cleanHistory(history),
    `Mensaje actual: ${prompt}`,
    "Devuelve solo el titulo."
  ].join("\n\n");

  try {
    const result = await createServerProviderRuntime().execute({
      operation: "completion",
      capability: "completion",
      input: { instruction }
    });
    const title = sanitizeTitle(result.output ?? "");
    response.status(200).json({ ok: true, title: title || buildFallbackTitle(prompt), provider: result.provider });
  } catch (cause) {
    response.status(200).json({
      ok: true,
      title: buildFallbackTitle(prompt),
      warning: cause instanceof Error ? cause.message : "No pude titular mediante Provider Runtime."
    });
  }
}
