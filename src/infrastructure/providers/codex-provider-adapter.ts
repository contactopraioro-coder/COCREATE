import { createFunctionProviderAdapter, type ProviderAdapter } from "../../../shared/provider-runtime.js";
import type { CodexConversationService } from "../../app/services/codex-conversation-service.js";

type CodexProviderOptions = {
  conversationService: CodexConversationService;
  origin: "desktop-renderer" | "web-renderer";
  clientId?: string;
};

function runConversation(
  options: CodexProviderOptions,
  request: any,
  onChunk?: (chunk: string) => void
) {
  return options.conversationService.runPrompt(
    {
      prompt: request.input?.prompt ?? "",
      history: request.input?.history ?? [],
      origin: options.origin,
      clientId: options.clientId,
      model: typeof request.input?.model === "string" ? request.input.model : undefined,
      effort: typeof request.input?.effort === "string" ? request.input.effort : undefined,
      collaborationMode: request.input?.collaborationMode ?? null,
      attachments: Array.isArray(request.input?.attachments) ? request.input.attachments : [],
      skills: Array.isArray(request.input?.skills) ? request.input.skills : [],
      interactionMode: request.input?.interactionMode === "proposal" ? "proposal" : request.input?.interactionMode === "live" ? "live" : "chat",
      visualContext: request.input?.visualContext && typeof request.input.visualContext === "object" ? request.input.visualContext : null,
      proposalWorkspaceId: typeof request.input?.proposalWorkspaceId === "string" ? request.input.proposalWorkspaceId : undefined,
      proposalContext: request.input?.proposalContext && typeof request.input.proposalContext === "object" ? request.input.proposalContext : null,
      signal: request.signal
    },
    onChunk
      ? {
          onEvent(event) {
            if (event.type === "execution.output") {
              onChunk(event.chunk);
            }
          }
        }
      : undefined
  );
}

export function createCodexProviderAdapter(options: CodexProviderOptions): ProviderAdapter {
  return createFunctionProviderAdapter({
    id: "codex",
    name: "Codex",
    capabilities: {
      operations: ["chat"],
      domains: ["coding"],
      streaming: true,
      tools: true,
      reasoning: true,
      multimodal: false,
      embeddings: false
    },
    metadata: { transport: options.origin === "web-renderer" ? "https" : "electron-ipc" },
    async getHealth() {
      if (options.origin === "web-renderer") {
        return { status: "Unavailable" as const, message: "Codex no está disponible en el runtime Web." };
      }
      const status = await options.conversationService.getStatus();
      return status.available && status.compatible
        ? { status: "Healthy" as const, metadata: { version: status.version } }
        : { status: "Unavailable" as const, message: status.error ?? "Codex no está disponible." };
    },
    async execute(request) {
      const result = await runConversation(options, request);
      return { output: result.output, metadata: { transport: options.origin } };
    },
    async *stream(request) {
      const chunks: string[] = [];
      const waiters: Array<() => void> = [];
      let completed = false;
      let failure: unknown = null;
      const wake = () => waiters.splice(0).forEach((resolve) => resolve());
      void runConversation(options, request, (chunk) => {
        chunks.push(chunk);
        wake();
      })
        .catch((error) => {
          failure = error;
        })
        .finally(() => {
          completed = true;
          wake();
        });

      while (!completed || chunks.length) {
        if (!chunks.length) {
          await new Promise<void>((resolve) => waiters.push(resolve));
          continue;
        }
        yield { type: "text-delta", text: chunks.shift() ?? "" };
      }
      if (failure) {
        throw failure;
      }
    }
  });
}

export function createOpenAIWebGatewayAdapter(options: CodexProviderOptions): ProviderAdapter {
  return createFunctionProviderAdapter({
    id: "openai",
    name: "OpenAI Server Gateway",
    capabilities: {
      operations: ["chat"],
      domains: ["chat", "model"],
      streaming: false,
      tools: true,
      reasoning: true,
      multimodal: false,
      embeddings: false
    },
    metadata: { transport: "https", upstream: "/api/chat" },
    async getHealth() {
      return options.origin === "web-renderer"
        ? { status: "Healthy" as const, message: "Gateway server-side disponible." }
        : { status: "Unavailable" as const, message: "Gateway OpenAI no configurado para Desktop." };
    },
    async execute(request) {
      const result = await runConversation(options, request);
      return { output: result.output, metadata: { transport: "https" } };
    }
  });
}
