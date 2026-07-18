import {
  createTrustedWebError,
  stripTrackingParameters,
  validateTrustedWebSearchInput
} from "../../shared/trusted-web-contracts.js";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const FRESHNESS = {
  today: "pd",
  week: "pw",
  month: "pm",
  year: "py"
};

function combineSignals(parent, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const onAbort = () => controller.abort(parent.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    }
  };
}

function searchErrorForStatus(status, message, requestId, cause) {
  if (status === 401 || status === 403) {
    return createTrustedWebError("WEB_SEARCH_AUTH_ERROR", message, {
      provider: "brave-search",
      kind: "authentication",
      health: "Misconfigured",
      requestId,
      status,
      safeMessage: "El proveedor de busqueda web no esta autenticado correctamente.",
      cause
    });
  }
  if (status === 429) {
    return createTrustedWebError("WEB_SEARCH_RATE_LIMITED", message, {
      provider: "brave-search",
      kind: "rate-limit",
      health: "Rate Limited",
      requestId,
      status,
      safeMessage: "La busqueda web alcanzo su limite temporal. Intenta de nuevo mas tarde.",
      retriable: true,
      cause
    });
  }
  return createTrustedWebError("WEB_PROVIDER_UNAVAILABLE", message, {
    provider: "brave-search",
    kind: "upstream",
    health: status === 503 ? "Maintenance" : "Unavailable",
    requestId,
    status,
    safeMessage: "El proveedor de busqueda web no esta disponible.",
    retriable: status >= 500,
    cause
  });
}

function domainFrom(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function parsePublishedAt(item) {
  const candidate = item?.page_age ?? item?.age ?? item?.profile?.long_name;
  if (typeof candidate !== "string") return undefined;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function buildQuery(input) {
  const includes = input.domains.map((domain) => `site:${domain}`);
  const excludes = input.excludedDomains.map((domain) => `-site:${domain}`);
  return [input.query, ...includes, ...excludes].join(" ").slice(0, 400);
}

export function createBraveSearchAdapter(options = {}) {
  const apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY?.trim() ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? BRAVE_SEARCH_ENDPOINT;
  const timeoutMs = Math.min(20_000, Math.max(500, Number(options.timeoutMs) || 8_000));

  async function getHealth() {
    return apiKey
      ? { status: "Healthy", metadata: { provider: "brave-search", configured: true } }
      : { status: "Misconfigured", message: "BRAVE_SEARCH_API_KEY no esta configurada.", metadata: { configured: false } };
  }

  async function search(input, execution = {}) {
    if (!apiKey) {
      throw createTrustedWebError("WEB_TOOL_NOT_CONFIGURED", "BRAVE_SEARCH_API_KEY no esta configurada.", {
        provider: "brave-search",
        kind: "configuration",
        health: "Misconfigured",
        requestId: execution.requestId,
        safeMessage: "La busqueda web todavia no esta configurada en este entorno."
      });
    }
    const normalized = validateTrustedWebSearchInput(input);
    const params = new URLSearchParams({
      q: buildQuery(normalized),
      count: String(normalized.resultLimit),
      safesearch: normalized.safeSearch ? "strict" : "moderate"
    });
    if (normalized.countryHint) params.set("country", normalized.countryHint.toLowerCase());
    if (normalized.locale) params.set("search_lang", normalized.locale.split("-")[0]);
    if (FRESHNESS[normalized.freshness]) params.set("freshness", FRESHNESS[normalized.freshness]);

    const timed = combineSignals(execution.signal, timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${endpoint}?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey
        },
        signal: timed.signal
      });
    } catch (cause) {
      const cancelled = execution.signal?.aborted;
      throw createTrustedWebError(cancelled ? "WEB_CANCELLED" : timed.signal.reason === "timeout" ? "WEB_SEARCH_TIMEOUT" : "WEB_SEARCH_NETWORK_ERROR", cancelled ? "Busqueda cancelada." : cause instanceof Error ? cause.message : "Busqueda no disponible.", {
        provider: "brave-search",
        kind: cancelled ? "cancelled" : timed.signal.reason === "timeout" ? "timeout" : "network",
        health: "Unavailable",
        requestId: execution.requestId,
        safeMessage: cancelled ? "La consulta web fue cancelada." : "No pude conectar con el proveedor de busqueda web.",
        retriable: true,
        cause
      });
    } finally {
      timed.cleanup();
    }

    const payload = await response.json().catch(() => null);
    const requestId = response.headers.get("x-request-id") ?? execution.requestId ?? null;
    if (!response.ok) {
      const message = payload?.message ?? payload?.error?.message ?? `Brave Search respondio con HTTP ${response.status}.`;
      throw searchErrorForStatus(response.status, message, requestId, payload);
    }
    if (!payload || !Array.isArray(payload.web?.results)) {
      throw createTrustedWebError("WEB_SEARCH_INVALID_RESPONSE", "Brave Search devolvio un payload invalido.", {
        provider: "brave-search",
        kind: "parse",
        requestId,
        safeMessage: "El proveedor de busqueda devolvio una respuesta invalida.",
        retriable: true
      });
    }

    const retrievedAt = new Date().toISOString();
    const items = payload.web.results
      .map((item, index) => {
        const url = stripTrackingParameters(item?.url);
        const domain = url ? domainFrom(url) : "";
        if (!url || !domain || typeof item?.title !== "string") return null;
        return {
          id: `source-${index + 1}`,
          title: item.title.trim().slice(0, 300),
          url,
          domain,
          snippet: typeof item.description === "string" ? item.description.trim().slice(0, 1_200) : "",
          publishedAt: parsePublishedAt(item),
          retrievedAt,
          rank: index + 1,
          sourceType: "search-result",
          metadata: {
            language: item.language ?? null,
            subtype: item.subtype ?? null
          }
        };
      })
      .filter(Boolean);

    return {
      query: normalized.query,
      searchedAt: retrievedAt,
      provider: "brave-search",
      status: "completed",
      requestId,
      items,
      warnings: [],
      metadata: {
        resultCount: items.length,
        requestedCount: normalized.resultLimit
      }
    };
  }

  return {
    id: "brave-search",
    name: "Brave Search API",
    search,
    getHealth,
    metadata: { endpoint, credentialLocation: "server-only" }
  };
}
