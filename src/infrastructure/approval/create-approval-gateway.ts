import type { ApprovalGateway } from "./approval-gateway.js";
import { DesktopApprovalGateway } from "./desktop-approval-gateway.js";
import { NullApprovalGateway } from "./null-approval-gateway.js";

export function createApprovalGateway(): ApprovalGateway {
  return window.overlayBridge ? new DesktopApprovalGateway() : new NullApprovalGateway();
}
