import {
  ProviderFactory,
  ProviderRegistry,
  ProviderRuntime,
  createFunctionProviderAdapter,
  createPlaceholderProvider,
  type ProviderAdapter,
  type ProviderCapabilities
} from "../../shared/provider-runtime.js";
import { createTrustedWebProviderAdapter } from "../../infrastructure/trusted-web/create-trusted-web-provider-adapter.js";
import { createOpenAIProviderAdapter } from "./providers/openai-provider-adapter.js";

type ToolSuite = {
  dateTimeTool?: { getCurrentDateTime: () => Promise<unknown> | unknown };
  workspaceTool?: { getCurrentWorkspaceContext: () => Promise<unknown> | unknown };
  identityTool?: { getCurrentIdentityContext: () => Promise<unknown> | unknown };
  systemTool?: { getCurrentSystemContext: () => Promise<unknown> | unknown };
};

type ServerProviderRuntimeOptions = ToolSuite & {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  observer?: (event: Record<string, unknown>) => void;
  trustedWebAdapter?: ProviderAdapter;
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

function createToolAdapter(id: string, name: string, domain: string, query: () => Promise<unknown> | unknown) {
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

function registerFutureProviders(registry: ProviderRegistry) {
  const futureProviders: ProviderAdapter[] = [
    createPlaceholderProvider({
      id: "codex",
      name: "Codex",
      capabilities: capabilities("chat", "coding", { reasoning: true, tools: true })
    }),
    createPlaceholderProvider({
      id: "claude",
      name: "Future Claude",
      capabilities: capabilities("chat", "chat", { reasoning: true, tools: true })
    }),
    createPlaceholderProvider({
      id: "gemini",
      name: "Future Gemini",
      capabilities: capabilities("chat", "chat", { multimodal: true, tools: true })
    }),
    createPlaceholderProvider({
      id: "local-model",
      name: "Future Local Model",
      capabilities: capabilities("chat", "chat")
    }),
    createPlaceholderProvider({
      id: "memory-engine",
      name: "Future Memory Engine",
      capabilities: capabilities("query", "memory", { tools: true })
    })
  ];
  for (const provider of futureProviders) {
    registry.register(provider);
  }
}

export function createServerProviderRuntime(options: ServerProviderRuntimeOptions = {}) {
  const registry = new ProviderRegistry();
  const factory = new ProviderFactory().register("openai", (factoryOptions) =>
    createOpenAIProviderAdapter(factoryOptions)
  );
  registry.register(factory.create("openai", { fetchImpl: options.fetchImpl }));
  registry.register(options.trustedWebAdapter ?? createTrustedWebProviderAdapter({ fetchImpl: options.fetchImpl }));

  if (options.dateTimeTool) {
    registry.register(createToolAdapter("datetime-tool", "DateTime Tool", "datetime", () => options.dateTimeTool!.getCurrentDateTime()));
  }
  if (options.workspaceTool) {
    registry.register(createToolAdapter("workspace-tool", "Workspace Tool", "workspace", () => options.workspaceTool!.getCurrentWorkspaceContext()));
  }
  if (options.identityTool) {
    registry.register(createToolAdapter("identity-tool", "Identity Tool", "identity", () => options.identityTool!.getCurrentIdentityContext()));
  }
  if (options.systemTool) {
    registry.register(createToolAdapter("system-tool", "System Tool", "system", () => options.systemTool!.getCurrentSystemContext()));
  }
  registerFutureProviders(registry);

  return new ProviderRuntime({
    registry,
    timeoutMs: options.timeoutMs ?? (Number(process.env.ASSISTANT_MODEL_TIMEOUT_MS) || 30_000),
    observer:
      options.observer ??
      (process.env.NODE_ENV !== "production"
        ? (event) => {
            const logger = event.type === "provider.failed" ? console.error : console.debug;
            logger("[ProviderRuntime]", event);
          }
        : undefined)
  });
}
