import assert from "node:assert/strict";
import test from "node:test";

import { createTrustedWebProviderAdapter } from "../infrastructure/trusted-web/create-trusted-web-provider-adapter.js";
import { ProviderRegistry, ProviderRuntime } from "../shared/provider-runtime.js";

const now = new Date().toISOString();

test("Trusted Web adapter executes through Provider Runtime and records metrics", async () => {
  const adapter = createTrustedWebProviderAdapter({
    searchProvider: {
      id: "test-search",
      async getHealth() { return { status: "Healthy" }; },
      async search(input) {
        return {
          query: input.query,
          provider: "test-search",
          searchedAt: now,
          status: "completed",
          warnings: [],
          items: [{ id: "official", title: "Official", url: "https://example.gov/current", domain: "example.gov", retrievedAt: now, rank: 1, sourceType: "official" }]
        };
      }
    },
    fetcher: {
      async fetch(input) {
        return { url: input.url, finalUrl: input.url, title: "Official", contentType: "text/plain", text: "Official current fact.", retrievedAt: now, statusCode: 200, truncated: false, warnings: [] };
      }
    },
    synthesizer: {
      model: "test-grounded-model",
      async synthesize() { return { answer: "Hecho verificado. [official]", sourceIds: ["official"], conflicts: [] }; }
    }
  });
  const runtime = new ProviderRuntime({ registry: new ProviderRegistry([adapter]) });
  const result = await runtime.execute({ capability: "web", operation: "search", input: { query: "current fact" } });
  assert.equal(result.provider, "web-tool");
  assert.equal(result.value.confidence, "Verified");
  assert.equal(result.value.citations.length, 1);
  assert.equal(result.model, "test-grounded-model");
  assert.ok(runtime.getMetrics().some((metric) => metric.provider === "web-tool" && metric.durationMs >= 0));
});

test("Trusted Web adapter reports Misconfigured without exposing credentials", async () => {
  const adapter = createTrustedWebProviderAdapter({ braveApiKey: "", openAIApiKey: "" });
  const health = await adapter.getHealth();
  assert.equal(health.status, "Misconfigured");
  assert.doesNotMatch(JSON.stringify(health), /subscription|bearer|api[_-]?key=/i);
});
