import { randomUUID } from "node:crypto";
import { redactCodexDiagnostic } from "../shared/codex-upstream-contracts.js";
import APPROVAL_IPC_CHANNELS from "../shared/approval-ipc-channels.cjs";

function describeRequest(request) {
  const command = redactCodexDiagnostic(request.command ?? "", 500);
  const normalized = command.toLowerCase();
  if (request.kind === "file-change") {
    return {
      category: "File change",
      risk: "Codex modificará archivos del Project activo.",
      action: "Aplicar cambios de archivos propuestos por Codex"
    };
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b/.test(normalized)) {
    return {
      category: "Dependencies",
      risk: "Este comando modificará dependencias del Project.",
      action: command || "Instalar dependencias"
    };
  }
  return {
    category: "Command",
    risk: "Este comando se ejecutará una sola vez dentro del Project activo.",
    action: command || "Ejecutar comando"
  };
}

export function createApprovalBroker({ ipcMain, BrowserWindow, timeoutMs = 90_000 }) {
  const pending = new Map();

  ipcMain.handle(APPROVAL_IPC_CHANNELS.respond, async (event, payload) => {
    const approvalId = typeof payload?.approvalId === "string" ? payload.approvalId : "";
    const request = pending.get(approvalId);
    if (!request || request.webContentsId !== event.sender.id) {
      return { ok: false, approvalId, reason: "stale-or-foreign" };
    }
    if (request.responded) return { ok: false, approvalId, reason: "already-responded" };
    request.responded = true;
    pending.delete(approvalId);
    clearTimeout(request.timer);
    request.cleanup();
    request.resolve(payload?.decision === "approve");
    return { ok: true, approvalId, decision: payload?.decision === "approve" ? "approve" : "reject" };
  });

  async function requestApproval(request) {
    const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (!owner || owner.isDestroyed()) return false;
    const approvalId = randomUUID();
    const description = describeRequest(request);
    return new Promise((resolve) => {
      const finishRejected = () => {
        const pendingRequest = pending.get(approvalId);
        if (!pendingRequest) return;
        pending.delete(approvalId);
        clearTimeout(pendingRequest.timer);
        pendingRequest.cleanup();
        resolve(false);
      };
      const timer = setTimeout(finishRejected, timeoutMs);
      const cleanup = () => owner.webContents.removeListener("destroyed", finishRejected);
      pending.set(approvalId, {
        approvalId,
        webContentsId: owner.webContents.id,
        resolve,
        timer,
        cleanup,
        responded: false
      });
      owner.webContents.once("destroyed", finishRejected);
      owner.webContents.send(APPROVAL_IPC_CHANNELS.requested, {
        approvalId,
        category: description.category,
        action: description.action,
        risk: description.risk,
        reason: redactCodexDiagnostic(request.reason ?? "", 500) || null,
        threadId: typeof request.threadId === "string" ? request.threadId : null,
        turnId: typeof request.turnId === "string" ? request.turnId : null,
        itemId: typeof request.itemId === "string" ? request.itemId : null,
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + timeoutMs).toISOString()
      });
    });
  }

  function dispose() {
    ipcMain.removeHandler(APPROVAL_IPC_CHANNELS.respond);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.cleanup();
      request.resolve(false);
    }
    pending.clear();
  }

  return { requestApproval, dispose };
}
