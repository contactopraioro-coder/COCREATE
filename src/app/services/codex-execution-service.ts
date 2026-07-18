import type {
  CodexAdapter,
  CodexExecutionHandle,
  CodexExecutionObserver,
  StartCodexExecutionRequest
} from "../../../shared/codex-contracts.js";

export class CodexExecutionService {
  constructor(private readonly adapter: CodexAdapter) {}

  async executePrompt(
    request: StartCodexExecutionRequest,
    observer?: CodexExecutionObserver
  ): Promise<CodexExecutionHandle> {
    return this.adapter.execute(request, observer ?? (() => undefined));
  }

  async cancelExecution(executionId: string, reason = "user-requested") {
    return this.adapter.cancelExecution({
      executionId,
      reason
    });
  }

  async getStatus() {
    return this.adapter.getStatus();
  }

  async dispose() {
    await this.adapter.dispose();
  }
}
