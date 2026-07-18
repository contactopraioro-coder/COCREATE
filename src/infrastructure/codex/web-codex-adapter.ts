import type {
  CancelCodexExecutionRequest,
  CodexAdapter,
  CodexError,
  CodexExecutionHandle,
  CodexExecutionObserver,
  StartCodexExecutionRequest
} from "../../../shared/codex-contracts.js";
import { createCodexError, createExecutionId, createTimestamp } from "../../../shared/codex-contracts.js";

export class WebCodexAdapter implements CodexAdapter {
  private readonly controllers = new Map<string, AbortController>();

  async getStatus() {
    return {
      available: false,
      binary: "web-api",
      version: null,
      compatible: false,
      validatedVersion: "0.134.0",
      minimumSupportedVersion: "0.134.0",
      license: "n/a",
      source: "/api/chat",
      mode: "browser-fallback",
      updatedAt: createTimestamp()
    };
  }

  async execute(request: StartCodexExecutionRequest, observer: CodexExecutionObserver): Promise<CodexExecutionHandle> {
    const executionId = request.executionId ?? createExecutionId();
    const controller = new AbortController();
    this.controllers.set(executionId, controller);

    let resolveCompleted: (value: Awaited<CodexExecutionHandle["completed"]>) => void = () => undefined;
    const completed = new Promise<Awaited<CodexExecutionHandle["completed"]>>((resolve) => {
      resolveCompleted = resolve;
    });

    void (async () => {
      try {
        await observer({
          type: "execution.started",
          executionId,
          timestamp: createTimestamp(),
          stage: "starting",
          origin: request.origin,
          promptPreview: request.prompt.slice(0, 280)
        });

        await observer({
          type: "execution.progress",
          executionId,
          timestamp: createTimestamp(),
          stage: "running",
          message: "CoCreate Web está respondiendo."
        });

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt: request.prompt,
            history: request.metadata?.history,
            attachments: request.metadata?.webAttachments,
            context: {
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              locale: navigator.language
            }
          }),
          signal: controller.signal
        });

        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          code?: string;
          output?: string;
          provider?: string;
          confidence?: string;
          capability?: string;
        } | null;
        if (!response.ok) {
          throw createCodexError("UNKNOWN", payload?.error ?? `CoCreate Web respondió con HTTP ${response.status}.`, {
            safeMessage: payload?.error ?? "No pude procesar la solicitud del asistente. Inténtalo de nuevo.",
            retriable: response.status >= 500,
            details: {
              status: response.status,
              code: payload?.code ?? null
            }
          });
        }

        if (payload?.ok === false) {
          throw createCodexError("UNKNOWN", payload.output ?? payload.error ?? "El modelo no pudo responder.", {
            safeMessage: payload.output ?? payload.error ?? "El modelo no pudo responder. Inténtalo de nuevo.",
            retriable: true,
            details: {
              provider: payload.provider ?? null,
              confidence: payload.confidence ?? null,
              capability: payload.capability ?? null
            }
          });
        }

        const output = payload?.output?.trim() ?? "";
        if (!output) {
          throw createCodexError("UNKNOWN", "CoCreate Web respondió sin texto.", {
            safeMessage: "El modelo no devolvió texto útil. Inténtalo de nuevo.",
            retriable: true
          });
        }

        await observer({
          type: "execution.output",
          executionId,
          timestamp: createTimestamp(),
          stage: "running",
          stream: "stdout",
          chunk: output
        });

        const event = {
          type: "execution.completed" as const,
          executionId,
          timestamp: createTimestamp(),
          stage: "completed" as const,
          output,
          exitCode: 0
        };
        await observer(event);
        resolveCompleted(event);
      } catch (error) {
        if (controller.signal.aborted) {
          const event = {
            type: "execution.cancelled" as const,
            executionId,
            timestamp: createTimestamp(),
            stage: "cancelled" as const,
            reason: "browser-abort"
          };
          await observer(event);
          resolveCompleted(event);
          return;
        }

        const codexError: CodexError =
          error && typeof error === "object" && "safeMessage" in error
            ? (error as CodexError)
            : createCodexError("UNKNOWN", error instanceof Error ? error.message : "Unknown browser execution error.", {
                safeMessage: "CoCreate Web no pudo completar la ejecución."
              });
        const event = {
          type: "execution.failed" as const,
          executionId,
          timestamp: createTimestamp(),
          stage: "failed" as const,
          error: codexError
        };
        await observer(event);
        resolveCompleted(event);
      } finally {
        this.controllers.delete(executionId);
      }
    })();

    return {
      executionId,
      completed,
      cancel: async (reason?: string) => this.cancelExecution({ executionId, reason })
    };
  }

  async cancelExecution(request: CancelCodexExecutionRequest) {
    const controller = this.controllers.get(request.executionId);
    if (!controller) {
      return {
        ok: true,
        executionId: request.executionId,
        alreadyTerminated: true
      };
    }

    controller.abort();
    return {
      ok: true,
      executionId: request.executionId,
      alreadyTerminated: false
    };
  }

  async dispose() {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
