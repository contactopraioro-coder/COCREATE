import {
  ProviderFactory,
  ProviderRegistry,
  ProviderRuntime,
  createFunctionProviderAdapter,
  createPlaceholderProvider,
  type ProviderCapabilities
} from "../../../shared/provider-runtime.js";
import type { CodexConversationService } from "../../app/services/codex-conversation-service.js";
import { createCodexProviderAdapter, createOpenAIWebGatewayAdapter } from "./codex-provider-adapter.js";
import { createTrustedWebGatewayAdapter } from "./trusted-web-gateway-adapter.js";

type AssistantTools = {
  dateTimeTool: { getCurrentDateTime: () => Promise<unknown> };
  workspaceTool: { getCurrentWorkspaceContext: () => Promise<unknown> };
  identityTool: { getCurrentIdentityContext: () => Promise<unknown> };
  systemTool: { getCurrentSystemContext: () => Promise<unknown> };
};

function capabilities(operation: string, domain: string, flags: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    operations: [operation],
    domains: [domain],
    streaming: false,
    tools: false,
    reasoning: false,
    multimodal: false,
    embeddings: false,
    ...flags
  };
}

function toolAdapter(id: string, name: string, domain: string, query: () => Promise<unknown>) {
  return createFunctionProviderAdapter({
    id,
    name,
    capabilities: capabilities("query", domain),
    metadata: { kind: "internal-tool" },
    async execute() {
      return { value: await query() };
    }
  });
}

export function createRendererProviderRuntime(options: {
  tools: AssistantTools;
  codexConversationService: CodexConversationService;
  origin: "desktop-renderer" | "web-renderer";
  clientId?: string;
  development?: boolean;
}) {
  const registry = new ProviderRegistry([
    toolAdapter("datetime-tool", "DateTime Tool", "datetime", () => options.tools.dateTimeTool.getCurrentDateTime()),
    toolAdapter("workspace-tool", "Workspace Tool", "workspace", () => options.tools.workspaceTool.getCurrentWorkspaceContext()),
    toolAdapter("identity-tool", "Identity Tool", "identity", () => options.tools.identityTool.getCurrentIdentityContext()),
    toolAdapter("system-tool", "System Tool", "system", () => options.tools.systemTool.getCurrentSystemContext())
  ]);
  const factory = new ProviderFactory().register("codex", () =>
    createCodexProviderAdapter({
      conversationService: options.codexConversationService,
      origin: options.origin,
      clientId: options.clientId
    })
  );
  registry.register(factory.create("codex"));
  registry.register(createTrustedWebGatewayAdapter({ origin: options.origin }));
  if (options.origin === "web-renderer") {
    registry.register(createOpenAIWebGatewayAdapter({
      conversationService: options.codexConversationService,
      origin: options.origin,
      clientId: options.clientId
    }));
  } else {
    registry.register(createPlaceholderProvider({
      id: "openai",
      name: "OpenAI Server Gateway",
      capabilities: capabilities("chat", "chat", { tools: true, reasoning: true })
    }));
  }
  registry.register(createPlaceholderProvider({
    id: "claude",
    name: "Future Claude",
    capabilities: capabilities("chat", "chat", { tools: true, reasoning: true })
  }));
  registry.register(createPlaceholderProvider({
    id: "gemini",
    name: "Future Gemini",
    capabilities: capabilities("chat", "chat", { tools: true, multimodal: true })
  }));
  registry.register(createPlaceholderProvider({
    id: "local-model",
    name: "Future Local Model",
    capabilities: capabilities("chat", "chat")
  }));
  registry.register(createPlaceholderProvider({
    id: "memory-engine",
    name: "Future Memory Engine",
    capabilities: capabilities("query", "memory", { tools: true })
  }));

  return new ProviderRuntime({
    registry,
    observer: options.development
      ? (event) => {
          const logger = event.type === "provider.failed" ? console.error : console.debug;
          logger("[ProviderRuntime]", event);
        }
      : undefined
  });
}
