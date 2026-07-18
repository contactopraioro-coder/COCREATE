import type { ApprovalGateway } from "./approval-gateway.js";

export class DesktopApprovalGateway implements ApprovalGateway {
  isAvailable() {
    return Boolean(window.overlayBridge?.onCodexApprovalRequest && window.overlayBridge?.respondCodexApproval);
  }

  subscribe(listener: Parameters<ApprovalGateway["subscribe"]>[0]) {
    return window.overlayBridge?.onCodexApprovalRequest?.(listener) ?? (() => undefined);
  }

  async respond(approvalId: string, decision: "approve" | "reject") {
    if (!window.overlayBridge?.respondCodexApproval) return { ok: false };
    return window.overlayBridge.respondCodexApproval({ approvalId, decision });
  }
}
