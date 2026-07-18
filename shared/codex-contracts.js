const SAFE_ERROR_MESSAGES = {
  CODEX_UNAVAILABLE: "Codex no está disponible en este entorno.",
  EXECUTABLE_NOT_FOUND: "No encontré el ejecutable de Codex configurado.",
  PROCESS_EXITED: "Codex terminó inesperadamente.",
  TIMEOUT: "Codex tardó demasiado y la ejecución fue detenida.",
  CANCELLED: "La ejecución fue cancelada.",
  IPC_ERROR: "No pude comunicarme de forma segura con Codex.",
  INVALID_PAYLOAD: "La solicitud hacia Codex no es válida.",
  UNKNOWN: "Codex no pudo completar la ejecución."
};

export function createExecutionId(prefix = "exec") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimestamp() {
  return new Date().toISOString();
}

export function createCodexError(code, message, options = {}) {
  return {
    code,
    message,
    safeMessage: options.safeMessage ?? SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES.UNKNOWN,
    retriable: Boolean(options.retriable),
    details: options.details
  };
}

export function toCodexError(error, fallbackCode = "UNKNOWN") {
  if (error && typeof error === "object" && "code" in error && "safeMessage" in error) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error ?? "Unknown Codex error");
  if (/ENOENT|not found/i.test(message)) {
    return createCodexError("EXECUTABLE_NOT_FOUND", message, {
      safeMessage: SAFE_ERROR_MESSAGES.EXECUTABLE_NOT_FOUND
    });
  }

  if (/timeout|demasiado/i.test(message)) {
    return createCodexError("TIMEOUT", message, {
      retriable: true,
      safeMessage: SAFE_ERROR_MESSAGES.TIMEOUT
    });
  }

  if (/cancel/i.test(message)) {
    return createCodexError("CANCELLED", message, {
      safeMessage: SAFE_ERROR_MESSAGES.CANCELLED
    });
  }

  return createCodexError(fallbackCode, message, {
    safeMessage: SAFE_ERROR_MESSAGES[fallbackCode] ?? SAFE_ERROR_MESSAGES.UNKNOWN
  });
}

export function isCodexTerminalEvent(event) {
  return (
    Boolean(event) &&
    typeof event === "object" &&
    (event.type === "execution.completed" ||
      event.type === "execution.cancelled" ||
      event.type === "execution.failed")
  );
}

export function getSafeCodexErrorMessage(error) {
  return error?.safeMessage ?? SAFE_ERROR_MESSAGES.UNKNOWN;
}
