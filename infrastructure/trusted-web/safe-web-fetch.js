import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

import { createTrustedWebError, validateTrustedWebFetchInput } from "../../shared/trusted-web-contracts.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com"
]);

function blockedUrl(message, options = {}) {
  return createTrustedWebError("WEB_FETCH_BLOCKED_URL", message, {
    kind: "security",
    safeMessage: "La fuente fue bloqueada por la politica de acceso web seguro.",
    ...options
  });
}

function isBlockedIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function mappedIpv4(address) {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) return dotted;
  const hex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const upper = Number.parseInt(hex[1], 16);
  const lower = Number.parseInt(hex[2], 16);
  return `${upper >> 8}.${upper & 255}.${lower >> 8}.${lower & 255}`;
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  const mapped = mappedIpv4(normalized);
  if (mapped) return isBlockedIpv4(mapped);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("2001:db8:")
  );
}

export function isPublicIpAddress(address) {
  const family = isIP(address);
  if (family === 4) return !isBlockedIpv4(address);
  if (family === 6) return !isBlockedIpv6(address);
  return false;
}

export function validatePublicWebUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw blockedUrl("La fuente no contiene una URL valida.", { cause });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw blockedUrl(`El protocolo ${url.protocol || "desconocido"} no esta permitido.`);
  }
  if (url.username || url.password) {
    throw blockedUrl("Las URLs con credenciales estan bloqueadas.");
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw blockedUrl(`El puerto ${url.port} no esta permitido.`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw blockedUrl(`El host ${hostname || "vacio"} esta bloqueado.`);
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw blockedUrl(`La direccion ${hostname} no es publica.`);
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

async function resolvePublicAddress(hostname, lookupImpl) {
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) };
  let records;
  try {
    records = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw createTrustedWebError("WEB_SEARCH_NETWORK_ERROR", `No pude resolver ${hostname}.`, {
      kind: "dns",
      safeMessage: "No pude conectar con una de las fuentes publicas.",
      retriable: true,
      cause
    });
  }
  const normalized = Array.isArray(records) ? records : [records];
  if (!normalized.length || normalized.some((record) => !isPublicIpAddress(record?.address))) {
    throw blockedUrl(`La resolucion DNS de ${hostname} incluye una direccion no publica.`);
  }
  return normalized.find((record) => record.family === 4) ?? normalized[0];
}

export function createPinnedLookup(address) {
  return function pinnedLookup(_hostname, lookupOptions, callback) {
    if (lookupOptions?.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function requestPinned(url, address, options) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      headers: {
        Accept: options.accept,
        "Accept-Encoding": "identity",
        "User-Agent": options.userAgent
      },
      lookup: createPinnedLookup(address)
    }, resolve);
    const onAbort = () => request.destroy(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    request.once("error", reject);
    request.once("close", () => options.signal?.removeEventListener("abort", onAbort));
    request.end();
  });
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers["content-length"] ?? 0);
  if (declaredLength > maxBytes) {
    response.destroy();
    throw createTrustedWebError("WEB_FETCH_TOO_LARGE", `La fuente declara ${declaredLength} bytes.`, {
      kind: "size",
      safeMessage: "La fuente es demasiado grande para recuperarla de forma segura."
    });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > maxBytes) {
      response.destroy();
      throw createTrustedWebError("WEB_FETCH_TOO_LARGE", `La fuente excedio ${maxBytes} bytes.`, {
        kind: "size",
        safeMessage: "La fuente es demasiado grande para recuperarla de forma segura."
      });
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks).toString("utf8"), bytes: total };
}

function decodeHtmlEntities(value) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function parseText(body, contentType) {
  if (contentType.includes("html") || contentType.includes("xhtml")) {
    const title = decodeHtmlEntities(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const text = decodeHtmlEntities(
      body
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    ).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { title, text };
  }
  return { title: "", text: body.replace(/\s+/g, " ").trim() };
}

function abortSignal(parent, timeoutMs) {
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

function mapRequestError(error, signal, requestId) {
  if (error?.name === "TrustedWebError") return error;
  if (signal.aborted) {
    const cancelled = signal.reason !== "timeout" && signal.reason !== undefined;
    return createTrustedWebError(cancelled ? "WEB_CANCELLED" : "WEB_FETCH_TIMEOUT", cancelled ? "Fetch cancelado." : "Fetch agotado.", {
      kind: cancelled ? "cancelled" : "timeout",
      requestId,
      safeMessage: cancelled ? "La consulta web fue cancelada." : "Una fuente tardo demasiado en responder.",
      retriable: true,
      cause: error
    });
  }
  return createTrustedWebError("WEB_SEARCH_NETWORK_ERROR", error instanceof Error ? error.message : "Fetch fallo.", {
    kind: "network",
    requestId,
    safeMessage: "No pude conectar con una de las fuentes publicas.",
    retriable: true,
    cause: error
  });
}

export function createSafeWebFetcher(options = {}) {
  const lookupImpl = options.lookupImpl ?? dnsLookup;
  const requestImpl = options.requestImpl ?? requestPinned;
  const maxRedirects = Math.min(5, Math.max(0, Number(options.maxRedirects) || 3));
  const maxTextChars = Math.min(250_000, Math.max(4_000, Number(options.maxTextChars) || 80_000));
  const userAgent = options.userAgent ?? "CoCreate-TrustedWeb/1.0";

  async function fetchSource(input, execution = {}) {
    const normalized = validateTrustedWebFetchInput(input);
    const timed = abortSignal(execution.signal, normalized.timeoutMs);
    let currentUrl = validatePublicWebUrl(normalized.url);
    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        if (timed.signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        const address = await resolvePublicAddress(currentUrl.hostname, lookupImpl);
        const response = await requestImpl(currentUrl, address, {
          accept: normalized.acceptedContentTypes.join(", "),
          signal: timed.signal,
          userAgent
        });
        const status = Number(response.statusCode ?? 0);
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          if (redirectCount >= maxRedirects) {
            throw blockedUrl("La fuente excedio el limite de redirecciones.", { requestId: execution.requestId });
          }
          const location = response.headers.location;
          if (!location) throw blockedUrl("La redireccion no contiene destino.", { requestId: execution.requestId });
          currentUrl = validatePublicWebUrl(new URL(location, currentUrl).toString());
          continue;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          throw createTrustedWebError("WEB_FETCH_PARSE_ERROR", `La fuente respondio con HTTP ${status}.`, {
            kind: "upstream",
            requestId: execution.requestId,
            status,
            safeMessage: "Una fuente publica no pudo recuperarse.",
            retriable: status >= 500
          });
        }
        const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!normalized.acceptedContentTypes.some((accepted) => contentType === accepted || contentType.startsWith(`${accepted};`))) {
          response.resume();
          throw createTrustedWebError("WEB_FETCH_UNSUPPORTED_CONTENT", `Tipo de contenido no permitido: ${contentType || "desconocido"}.`, {
            kind: "content-type",
            requestId: execution.requestId,
            safeMessage: "La fuente no ofrece contenido textual compatible."
          });
        }
        const { body, bytes } = await readBoundedBody(response, normalized.maxBytes);
        const parsed = parseText(body, contentType);
        if (!parsed.text) {
          throw createTrustedWebError("WEB_FETCH_PARSE_ERROR", "La fuente no contiene texto util.", {
            kind: "parse",
            requestId: execution.requestId,
            safeMessage: "La fuente no contiene texto util para verificar la respuesta."
          });
        }
        const truncated = parsed.text.length > maxTextChars;
        return {
          url: normalized.url,
          finalUrl: currentUrl.toString(),
          title: parsed.title,
          text: truncated ? parsed.text.slice(0, maxTextChars) : parsed.text,
          contentType,
          bytes,
          statusCode: status,
          truncated,
          retrievedAt: new Date().toISOString(),
          redirects: redirectCount,
          warnings: truncated ? ["content-truncated"] : [],
          metadata: { redirects: redirectCount }
        };
      }
      throw blockedUrl("La fuente excedio el limite de redirecciones.");
    } catch (error) {
      throw mapRequestError(error, timed.signal, execution.requestId);
    } finally {
      timed.cleanup();
    }
  }

  return { fetch: fetchSource };
}
