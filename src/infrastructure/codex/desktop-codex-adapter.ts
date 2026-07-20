import type {
  CancelCodexExecutionRequest,
  CodexAdapter,
  CodexExecutionEvent,
  CodexExecutionHandle,
  CodexExecutionObserver,
  CodexTerminalEvent,
  StartCodexExecutionRequest
} from "../../../shared/codex-contracts.js";
import { createExecutionId } from "../../../shared/codex-contracts.js";
import { assertCodexExecutionEvent } from "../../../shared/codex-ipc.js";

function isTerminalEvent(event: CodexExecutionEvent): event is CodexTerminalEvent {
  return (
    event.type === "execution.completed" ||
    event.type === "execution.cancelled" ||
    event.type === "execution.failed"
  );
}

function createMissingBridgeError() {
  return new Error("CoCreate Desktop Bridge no está disponible en este entorno.");
}

export class DesktopCodexAdapter implements CodexAdapter {
  async getStatus() {
    if (!window.overlayBridge) {
      throw createMissingBridgeError();
    }

    return window.overlayBridge.getCodexStatus();
  }

  async execute(request: StartCodexExecutionRequest, observer: CodexExecutionObserver): Promise<CodexExecutionHandle> {
    if (!window.overlayBridge) {
      throw createMissingBridgeError();
    }

    let trackedExecutionId = request.executionId ?? createExecutionId();
    let unsubscribe: () => void = () => undefined;
    let resolveCompleted: (event: CodexTerminalEvent) => void = () => undefined;

    const completed = new Promise<CodexTerminalEvent>((resolve) => {
      resolveCompleted = resolve;
    });

    unsubscribe = window.overlayBridge.onCodexEvent((event: CodexExecutionEvent) => {
      assertCodexExecutionEvent(event);
      if ("executionId" in event && trackedExecutionId && event.executionId !== trackedExecutionId) {
        return;
      }

      if (import.meta.env.DEV) {
        const e = event as unknown as Record<string, unknown>;
        const detail =
          event.type === "execution.progress" ? e.message
          : event.type === "execution.output" ? `${event.stream}: ${String(e.chunk ?? "").slice(0, 200)}`
          : event.type === "execution.failed" ? (e.error as { safeMessage?: string } | undefined)?.safeMessage
          : e.stage;
        console.info(`[Codex] ${event.type}`, detail ?? "", event);
      }

      void Promise.resolve(observer(event)).then(() => {
        if (isTerminalEvent(event)) {
          unsubscribe();
          resolveCompleted(event);
        }
      });
    });

    const response = await window.overlayBridge.startCodexExecution({
      ...request,
      executionId: trackedExecutionId
    });
    const executionId = response.executionId;
    trackedExecutionId = executionId;

    return {
      executionId,
      completed,
      cancel: async (reason?: string) => {
        return this.cancelExecution({
          executionId,
          reason
        });
      }
    };
  }

  async cancelExecution(request: CancelCodexExecutionRequest) {
    if (!window.overlayBridge) {
      throw createMissingBridgeError();
    }

    return window.overlayBridge.cancelCodexExecution(request);
  }

  async dispose() {
    return;
  }
}
