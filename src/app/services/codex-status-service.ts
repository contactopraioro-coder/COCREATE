import type { CodexAdapter, CodexStatus } from "../../../shared/codex-contracts.js";

export class CodexStatusService {
  constructor(private readonly adapter: CodexAdapter) {}

  async refreshStatus(): Promise<CodexStatus> {
    return this.adapter.getStatus();
  }
}
