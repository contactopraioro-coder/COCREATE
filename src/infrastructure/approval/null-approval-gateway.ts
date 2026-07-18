import type { ApprovalGateway } from "./approval-gateway.js";

export class NullApprovalGateway implements ApprovalGateway {
  isAvailable() { return false; }
  subscribe() { return () => undefined; }
  async respond() { return { ok: false }; }
}
