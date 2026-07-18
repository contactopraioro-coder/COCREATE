export const TRUSTED_WEB_IPC_CHANNELS = Object.freeze({
  getStatus: "trusted-web:get-status",
  execute: "trusted-web:execute",
  cancel: "trusted-web:cancel"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function assertTrustedWebExecuteRequest(value) {
  if (!value || typeof value !== "object") throw new TypeError("Trusted Web requiere un payload.");
  if (!text(value.requestId) || text(value.requestId).length > 160) throw new TypeError("requestId invalido.");
  const query = text(value.input?.query ?? value.input?.prompt);
  if (!query || query.length > 400 || query.split(/\s+/).length > 50) throw new TypeError("query invalida.");
  return value;
}

export function assertTrustedWebCancelRequest(value) {
  if (!value || typeof value !== "object" || !text(value.requestId) || text(value.requestId).length > 160) {
    throw new TypeError("requestId invalido.");
  }
  return value;
}
