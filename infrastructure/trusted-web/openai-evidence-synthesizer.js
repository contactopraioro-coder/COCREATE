import { createTrustedWebError } from "../../shared/trusted-web-contracts.js";
import { buildTrustedWebSynthesisPrompt, normalizeTrustedWebSynthesis } from "../../shared/trusted-web-synthesis.js";

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
}

function failure(status, message, requestId, cause) {
  const authentication = status === 401 || status === 403;
  const rateLimited = status === 429;
  return createTrustedWebError(authentication ? "WEB_SEARCH_AUTH_ERROR" : rateLimited ? "WEB_SEARCH_RATE_LIMITED" : "WEB_PROVIDER_UNAVAILABLE", message, {
    provider: "openai-evidence-synthesizer",
    kind: authentication ? "authentication" : rateLimited ? "rate-limit" : "synthesis",
    health: authentication ? "Misconfigured" : rateLimited ? "Rate Limited" : status === 503 ? "Maintenance" : "Unavailable",
    requestId,
    status,
    safeMessage: "No pude sintetizar la evidencia web recuperada.",
    retriable: rateLimited || status >= 500,
    cause
  });
}

export function createOpenAIEvidenceSynthesizer(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function synthesize(input, execution = {}) {
    if (!apiKey) {
      throw createTrustedWebError("WEB_TOOL_NOT_CONFIGURED", "OPENAI_API_KEY no esta configurada para sintesis.", {
        provider: "openai-evidence-synthesizer",
        kind: "configuration",
        health: "Misconfigured",
        requestId: execution.requestId,
        safeMessage: "La sintesis de evidencia no esta configurada en este entorno."
      });
    }
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: buildTrustedWebSynthesisPrompt(input.query, input.bundle, input.locale),
          store: false,
          temperature: 0
        }),
        signal: execution.signal
      });
    } catch (cause) {
      const cancelled = execution.signal?.aborted;
      throw createTrustedWebError(cancelled ? "WEB_CANCELLED" : "WEB_SEARCH_NETWORK_ERROR", cancelled ? "Sintesis cancelada." : cause instanceof Error ? cause.message : "Sintesis no disponible.", {
        provider: "openai-evidence-synthesizer",
        kind: cancelled ? "cancelled" : "network",
        requestId: execution.requestId,
        safeMessage: cancelled ? "La consulta web fue cancelada." : "No pude sintetizar la evidencia web recuperada.",
        retriable: true,
        cause
      });
    }
    const payload = await response.json().catch(() => null);
    const requestId = response.headers.get("x-request-id") ?? execution.requestId ?? null;
    if (!response.ok) {
      throw failure(response.status, payload?.error?.message ?? `OpenAI respondio con HTTP ${response.status}.`, requestId, payload);
    }
    const synthesis = normalizeTrustedWebSynthesis(extractResponseText(payload), input.bundle);
    if (!synthesis) {
      throw createTrustedWebError("WEB_SEARCH_INVALID_RESPONSE", "La sintesis no cumple el contrato de grounding.", {
        provider: "openai-evidence-synthesizer",
        kind: "grounding",
        requestId,
        safeMessage: "La sintesis no pudo validarse contra las fuentes recuperadas."
      });
    }
    return synthesis;
  }

  return { id: "openai-evidence-synthesizer", model, synthesize };
}
