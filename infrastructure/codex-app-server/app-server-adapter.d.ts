import type { CodexAdapter } from "../../shared/codex-contracts.js";

export interface CodexApprovalRequest {
  kind: "command" | "file-change";
  command: string | null;
  cwd: string | null;
  reason: string | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
}

export declare function createCodexAppServerAdapter(options: {
  processManager: any;
  client?: any;
  cwd?: string;
  timeoutMs?: number;
  webSearchMode?: "disabled" | "cached" | "live";
  requestApproval?: (request: CodexApprovalRequest) => Promise<boolean>;
  persistThreadMapping?: (mapping: Record<string, unknown>) => Promise<void>;
}): CodexAdapter & { listModels(): Promise<{ data: Array<Record<string, unknown>> }> };
