import { createCodexError } from "./codex-contracts.js";
import codexIpcChannels from "./codex-ipc-channels.json" with { type: "json" };

export const CODEX_IPC_CHANNELS = codexIpcChannels;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertStartCodexExecutionRequest(value) {
  if (!isRecord(value) || typeof value.prompt !== "string" || !value.prompt.trim() || typeof value.origin !== "string") {
    throw createCodexError("INVALID_PAYLOAD", "Invalid execute payload.", {
      safeMessage: "No pude iniciar la ejecución porque el payload es inválido."
    });
  }
}

export function assertCancelCodexExecutionRequest(value) {
  if (!isRecord(value) || typeof value.executionId !== "string" || !value.executionId.trim()) {
    throw createCodexError("INVALID_PAYLOAD", "Invalid cancel payload.", {
      safeMessage: "No pude cancelar la ejecución porque el payload es inválido."
    });
  }
}

export function assertCodexExecutionEvent(value) {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.timestamp !== "string") {
    throw createCodexError("INVALID_PAYLOAD", "Invalid Codex event payload.", {
      safeMessage: "Llegó un evento inválido desde Codex."
    });
  }
}

export function createStatusResponse(status) {
  return status;
}
