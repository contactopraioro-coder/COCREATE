import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderFactory,
  ProviderMetrics,
  ProviderRegistry,
  ProviderRuntime,
  ProviderSelection,
  createFunctionProviderAdapter,
  createPlaceholderProvider,
  createProviderError,
  type ProviderAdapter,
  type ProviderCapabilities
} from "../shared/provider-runtime.js";

function capabilities(domains: string[], streaming = false): ProviderCapabilities {
  return {
    operations: ["chat"],
    domains,
    streaming,
    tools: false,
    reasoning: true,
    multimodal: false,
    embeddings: false
  };
}

function provider(id: string, domains: string[], options: Partial<ProviderAdapter> = {}) {
  return createFunctionProviderAdapter({
    id,
    capabilities: capabilities(domains, Boolean(options.stream)),
    async execute() {
      return { output: id };
    },
    ...options
  });
}

test("Provider Registry exposes enabled providers, health and capability flags", async () => {
  const registry = new ProviderRegistry([
    provider("openai", ["chat"]),
    provider("codex", ["coding"], {
      stream: async function* () { yield { type: "text-delta", text: "ok" }; }
    })
  ]);
  const providers = await registry.describe();

  assert.deepEqual(providers.map((item) => item.id), ["openai", "codex"]);
  assert.ok(providers.every((item) => item.enabled && item.health.status === "Healthy"));
  assert.equal(providers.find((item) => item.id === "codex")?.capabilities.streaming, true);
});

test("Provider Selection chooses OpenAI for chat and Codex for coding outside Assistant Runtime", async () => {
  const registry = new ProviderRegistry([
    provider("openai", ["chat", "coding"]),
    provider("codex", ["chat", "coding"])
  ]);
  const candidates = await registry.describe();
  const selection = new ProviderSelection();

  assert.equal(selection.select({ operation: "chat", capability: "chat" }, candidates)?.id, "openai");
  assert.equal(selection.select({ operation: "chat", capability: "coding" }, candidates)?.id, "codex");
});

test("Provider Selection never substitutes OpenAI when Codex coding is unavailable", async () => {
  const runtime = new ProviderRuntime({
    registry: new ProviderRegistry([
      provider("openai", ["chat", "coding"]),
      provider("codex", ["coding"], {
        getHealth: async () => ({ status: "Unavailable", message: "Codex unavailable" })
      })
    ]),
    observer: () => undefined
  });

  await assert.rejects(
    runtime.execute({ operation: "chat", capability: "coding" }),
    (error: any) => {
      assert.equal(error.provider, "codex");
      assert.equal(error.routing.requiredProvider, "codex");
      assert.equal(error.routing.selectedProvider, null);
      assert.ok(error.routing.discardedProviders.some((item: any) => item.id === "openai"));
      return error.code === "PROVIDER_UNAVAILABLE";
    }
  );
});

test("Provider Selection never substitutes Codex when OpenAI chat is unavailable", async () => {
  const runtime = new ProviderRuntime({
    registry: new ProviderRegistry([
      provider("openai", ["chat"], {
        getHealth: async () => ({ status: "Unavailable", message: "OpenAI unavailable" })
      }),
      provider("codex", ["chat", "coding"])
    ]),
    observer: () => undefined
  });

  await assert.rejects(
    runtime.execute({ operation: "chat", capability: "chat" }),
    (error: any) => {
      assert.equal(error.provider, "openai");
      assert.equal(error.routing.requiredProvider, "openai");
      assert.equal(error.routing.selectedProvider, null);
      assert.ok(error.routing.discardedProviders.some((item: any) => item.id === "codex"));
      return error.code === "PROVIDER_UNAVAILABLE";
    }
  );
});

test("Provider Health preserves explicit platform states", async () => {
  const states = ["Healthy", "Unavailable", "Misconfigured", "Rate Limited", "Maintenance"] as const;
  const registry = new ProviderRegistry(
    states.map((status, index) => provider(`provider-${index}`, ["chat"], { getHealth: async () => ({ status }) }))
  );

  assert.deepEqual((await registry.describe()).map((item) => item.health.status), states);
});

test("Provider errors preserve rate-limit semantics without ambiguous messages", async () => {
  const runtime = new ProviderRuntime({
    registry: new ProviderRegistry([
      provider("openai", ["chat"], {
        async execute() {
          throw createProviderError("PROVIDER_RATE_LIMITED", "quota", {
            provider: "openai",
            kind: "rate-limit",
            health: "Rate Limited",
            safeMessage: "Límite temporal alcanzado.",
            retriable: true
          });
        }
      })
    ]),
    observer: () => undefined
  });

  await assert.rejects(
    runtime.execute({ operation: "chat", capability: "chat" }),
    (error: any) => error.code === "PROVIDER_RATE_LIMITED" && error.health === "Rate Limited" && error.retriable
  );
});

test("Provider Runtime aborts timed-out requests and records timeout metrics", async () => {
  const runtime = new ProviderRuntime({
    registry: new ProviderRegistry([
      provider("slow", ["chat"], { execute: async () => new Promise(() => undefined) })
    ]),
    selection: new ProviderSelection({ chat: ["slow"] }),
    timeoutMs: 5,
    observer: () => undefined
  });

  await assert.rejects(
    runtime.execute({ operation: "chat", capability: "chat" }),
    (error: any) => error.code === "PROVIDER_TIMEOUT" && error.kind === "timeout"
  );
  assert.equal(runtime.getMetrics()[0]?.timeout, true);
});

test("Provider Runtime streams through the unified AsyncIterable contract", async () => {
  const runtime = new ProviderRuntime({
    registry: new ProviderRegistry([
      provider("streamer", ["chat"], {
        stream: async function* () {
          yield { type: "text-delta", text: "Hola" };
          yield { type: "text-delta", text: " mundo" };
        }
      })
    ]),
    selection: new ProviderSelection({ chat: ["streamer"] }),
    observer: () => undefined
  });
  const chunks: any[] = [];
  for await (const chunk of runtime.stream({ operation: "chat", capability: "chat" })) {
    chunks.push(chunk);
  }

  assert.equal(chunks.map((chunk) => chunk.text).join(""), "Hola mundo");
  assert.equal(runtime.getMetrics()[0]?.streaming, true);
});

test("Provider Factory creates registered adapters and rejects unknown factories", () => {
  const factory = new ProviderFactory().register("fake", () => provider("fake", ["chat"]));
  assert.equal(factory.create("fake").id, "fake");
  assert.throws(() => factory.create("missing"), (error: any) => error.code === "PROVIDER_FACTORY_NOT_FOUND");
});

test("Provider contracts reject incomplete and dishonest streaming adapters", () => {
  assert.throws(
    () => new ProviderRegistry([{ id: "invalid", capabilities: capabilities(["chat"]) } as ProviderAdapter]),
    (error: any) => error.code === "PROVIDER_CONTRACT_INVALID"
  );
  assert.throws(
    () => new ProviderRegistry([{ id: "invalid-stream", capabilities: capabilities(["chat"], true), execute: async () => ({}) }]),
    (error: any) => error.code === "PROVIDER_CONTRACT_INVALID"
  );
});

test("Provider observability records tokens and redacts secrets", () => {
  const metrics = new ProviderMetrics();
  metrics.record({ provider: "openai", tokens: { input: 10, output: 4 }, apiKey: "secret-value" });
  const [metric] = metrics.list();

  assert.deepEqual(metric.tokens, { input: 10, output: 4 });
  assert.equal(metric.apiKey, "[REDACTED]");
});

test("Future providers remain explicit Not Implemented contracts", async () => {
  const placeholder = createPlaceholderProvider({
    id: "gemini",
    name: "Future Gemini",
    capabilities: capabilities(["chat"])
  });
  const registry = new ProviderRegistry([placeholder]);

  assert.equal((await registry.getHealth("gemini")).status, "Unavailable");
  await assert.rejects(Promise.resolve(placeholder.execute({ operation: "chat", capability: "chat" })), (error: any) => {
    return error.code === "PROVIDER_NOT_IMPLEMENTED";
  });
});
