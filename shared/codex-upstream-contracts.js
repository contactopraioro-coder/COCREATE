export const CODEX_UPSTREAM_VALIDATED_VERSION = "0.134.0";
export const CODEX_UPSTREAM_PROTOCOL_VERSION = "v2";
export const CODEX_RUNTIME_MODES = Object.freeze(["app-server", "exec", "auto"]);

const SAFE_UPSTREAM_MESSAGES = {
  CODEX_APP_SERVER_UNAVAILABLE: "Codex App Server no está disponible.",
  CODEX_APP_SERVER_INCOMPATIBLE: "La versión instalada de Codex no es compatible con CoCreate.",
  CODEX_APP_SERVER_INITIALIZATION_FAILED: "Codex App Server no pudo inicializarse.",
  CODEX_APP_SERVER_PROTOCOL_ERROR: "Codex App Server envió un mensaje inválido.",
  CODEX_APP_SERVER_TIMEOUT: "Codex App Server tardó demasiado en responder.",
  CODEX_APP_SERVER_CLOSED: "La conexión con Codex App Server se cerró.",
  CODEX_APPROVAL_UNAVAILABLE: "La acción requiere una aprobación que no pudo mostrarse.",
  CODEX_THREAD_NOT_FOUND: "No encontré el thread de Codex asociado a esta conversación."
};

export function resolveCodexRuntimeMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CODEX_RUNTIME_MODES.includes(normalized) ? normalized : "auto";
}

export function normalizeCodexVersion(rawVersion) {
  const match = String(rawVersion ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function evaluateCodexUpstreamCompatibility(version, validatedVersion = CODEX_UPSTREAM_VALIDATED_VERSION) {
  if (!version) {
    return "binary-missing";
  }
  return version === validatedVersion ? "compatible" : "unsupported-version";
}

export function createCodexUpstreamError(code, message, options = {}) {
  const error = new Error(message);
  error.name = "CodexUpstreamError";
  error.code = code;
  error.safeMessage = options.safeMessage ?? SAFE_UPSTREAM_MESSAGES[code] ?? "Codex no pudo completar la operación.";
  error.retriable = Boolean(options.retriable);
  error.details = options.details;
  return error;
}

export function toCodexUpstreamError(cause, fallbackCode = "CODEX_APP_SERVER_PROTOCOL_ERROR") {
  if (cause && typeof cause === "object" && cause.name === "CodexUpstreamError") {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : String(cause ?? "Unknown Codex App Server error");
  const lower = message.toLowerCase();
  const code = lower.includes("timeout") || lower.includes("timed out")
    ? "CODEX_APP_SERVER_TIMEOUT"
    : lower.includes("closed") || lower.includes("exited")
      ? "CODEX_APP_SERVER_CLOSED"
      : fallbackCode;
  return createCodexUpstreamError(code, message, {
    retriable: code === "CODEX_APP_SERVER_TIMEOUT" || code === "CODEX_APP_SERVER_CLOSED"
  });
}

export function redactCodexDiagnostic(value, maxLength = 4_096) {
  return String(value ?? "")
    .replace(/(bearer|token|api[_-]?key|authorization)(\s*[=:]\s*)[^\s,}\]]+/gi, "$1$2<redacted>")
    .replace(/[A-Za-z0-9_\-]{32,}/g, "<redacted>")
    .slice(0, maxLength);
}

export function createCodexUpstreamEvent(type, input = {}) {
  return {
    type,
    timestamp: new Date().toISOString(),
    executionId: input.executionId ?? null,
    codexThreadId: input.codexThreadId ?? null,
    codexTurnId: input.codexTurnId ?? null,
    codexRuntimeVersion: input.codexRuntimeVersion ?? CODEX_UPSTREAM_VALIDATED_VERSION,
    codexProtocolVersion: input.codexProtocolVersion ?? CODEX_UPSTREAM_PROTOCOL_VERSION,
    data: input.data && typeof input.data === "object" ? input.data : {}
  };
}
