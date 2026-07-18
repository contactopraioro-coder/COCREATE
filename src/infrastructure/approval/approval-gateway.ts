import type { ApprovalRequest } from "../../app/services/approval-runtime-service.js";

export type ApprovalGateway = {
  isAvailable: () => boolean;
  subscribe: (listener: (request: ApprovalRequest) => void) => () => void;
  respond: (approvalId: string, decision: "approve" | "reject") => Promise<{ ok: boolean }>;
};
