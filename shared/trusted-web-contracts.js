const SEARCH_FRESHNESS = new Set(["any", "today", "week", "month", "year"]);
const WEB_CONFIDENCE = new Set([
  "Verified",
  "VerifiedWithConflict",
  "InsufficientEvidence",
  "Unavailable"
]);

export const TRUSTED_WEB_ERROR_CODES = Object.freeze([
  "WEB_TOOL_NOT_CONFIGURED",
  "WEB_SEARCH_AUTH_ERROR",
  "WEB_SEARCH_RATE_LIMITED",
  "WEB_SEARCH_TIMEOUT",
  "WEB_SEARCH_NETWORK_ERROR",
  "WEB_SEARCH_INVALID_RESPONSE",
  "WEB_SEARCH_NO_RESULTS",
  "WEB_FETCH_BLOCKED_URL",
  "WEB_FETCH_UNSUPPORTED_CONTENT",
  "WEB_FETCH_TOO_LARGE",
  "WEB_FETCH_TIMEOUT",
  "WEB_FETCH_PARSE_ERROR",
  "WEB_INSUFFICIENT_EVIDENCE",
  "WEB_PROVIDER_UNAVAILABLE",
  "WEB_CANCELLED"
]);

const TRACKING_PARAMETERS = [
  "fbclid",
  "gclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref_src"
];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function normalizeDomain(value) {
  return text(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/:\d+$/, "");
}

function normalizeDomains(values, limit) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map(normalizeDomain)
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
    )
  ).slice(0, limit);
}

export function createTrustedWebRequestId(prefix = "web") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTrustedWebError(code, message, options = {}) {
  const error = new Error(message);
  error.name = "TrustedWebError";
  error.code = TRUSTED_WEB_ERROR_CODES.includes(code) ? code : "WEB_PROVIDER_UNAVAILABLE";
  error.provider = options.provider ?? "web-tool";
  error.kind = options.kind ?? "web";
  error.health = options.health ?? "Unavailable";
  error.safeMessage = options.safeMessage ?? "No pude verificar esta informacion en la web.";
  error.retriable = Boolean(options.retriable);
  error.requestId = options.requestId ?? null;
  error.status = options.status ?? null;
  if (options.cause !== undefined) error.cause = options.cause;
  return error;
}

export function normalizeTrustedWebError(error, context = {}) {
  const source = error instanceof Error ? error : new Error(String(error ?? "Unknown web error"));
  return {
    code: TRUSTED_WEB_ERROR_CODES.includes(source.code)
      ? source.code
      : context.code ?? "WEB_PROVIDER_UNAVAILABLE",
    provider: source.provider ?? context.provider ?? "web-tool",
    kind: source.kind ?? context.kind ?? "web",
    health: source.health ?? context.health ?? "Unavailable",
    message: source.message,
    safeMessage: source.safeMessage ?? context.safeMessage ?? "No pude verificar esta informacion en la web.",
    retriable: Boolean(source.retriable ?? context.retriable),
    requestId: source.requestId ?? context.requestId ?? null,
    status: source.status ?? context.status ?? null
  };
}

export function validateTrustedWebSearchInput(input = {}) {
  const query = text(input.query);
  if (!query) {
    throw createTrustedWebError("WEB_SEARCH_INVALID_RESPONSE", "La consulta web esta vacia.", {
      kind: "validation",
      safeMessage: "Necesito una consulta concreta para buscar informacion publica."
    });
  }
  if (query.length > 400 || query.split(/\s+/).length > 50) {
    throw createTrustedWebError("WEB_SEARCH_INVALID_RESPONSE", "La consulta web excede el limite permitido.", {
      kind: "validation",
      safeMessage: "La consulta web es demasiado larga. Intenta resumirla."
    });
  }

  const freshness = SEARCH_FRESHNESS.has(input.freshness) ? input.freshness : "any";
  const locale = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(text(input.locale)) ? text(input.locale) : undefined;
  const timezone = text(input.timezone).slice(0, 80) || undefined;
  const countryHint = /^[A-Za-z]{2}$/.test(text(input.countryHint))
    ? text(input.countryHint).toUpperCase()
    : undefined;
  const correlationId = text(input.correlationId).slice(0, 128) || undefined;

  return {
    query,
    locale,
    timezone,
    countryHint,
    freshness,
    domains: normalizeDomains(input.domains, 10),
    excludedDomains: normalizeDomains(input.excludedDomains, 20),
    resultLimit: boundedInteger(input.resultLimit, 6, 1, 10),
    safeSearch: input.safeSearch !== false,
    intent: text(input.intent).slice(0, 80) || undefined,
    correlationId
  };
}

export function validateTrustedWebFetchInput(input = {}) {
  const url = text(input.url);
  if (!url) {
    throw createTrustedWebError("WEB_FETCH_BLOCKED_URL", "La URL esta vacia.", {
      kind: "validation",
      safeMessage: "La fuente no contiene una URL publica valida."
    });
  }
  return {
    url,
    timeoutMs: boundedInteger(input.timeoutMs, 8_000, 500, 20_000),
    maxBytes: boundedInteger(input.maxBytes, 512_000, 1_024, 1_500_000),
    acceptedContentTypes: Array.isArray(input.acceptedContentTypes)
      ? input.acceptedContentTypes.map(text).filter(Boolean).slice(0, 8)
      : ["text/html", "text/plain", "application/xhtml+xml", "application/json"]
  };
}

export function stripTrackingParameters(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

export function isValidCitation(value) {
  if (!value || typeof value !== "object") return false;
  const url = stripTrackingParameters(value.url);
  if (!url || !text(value.id) || !text(value.sourceId) || !text(value.title) || !text(value.domain)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return normalizeDomain(parsed.hostname) === normalizeDomain(value.domain) && Boolean(text(value.retrievedAt));
  } catch {
    return false;
  }
}

export function normalizeWebConfidence(value) {
  return WEB_CONFIDENCE.has(value) ? value : "Unavailable";
}

export const TRUSTED_WEB_CONFIDENCE = WEB_CONFIDENCE;
