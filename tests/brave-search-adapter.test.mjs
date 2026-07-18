import assert from "node:assert/strict";
import test from "node:test";

import { createBraveSearchAdapter } from "../infrastructure/trusted-web/brave-search-adapter.js";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

test("normaliza resultados reales del contrato Brave sin filtrar la key", async () => {
  let observedUrl = "";
  let observedHeaders;
  const adapter = createBraveSearchAdapter({
    apiKey: "server-secret",
    fetchImpl: async (url, init) => {
      observedUrl = String(url);
      observedHeaders = init.headers;
      return jsonResponse({ web: { results: [{
        title: "Node.js Releases",
        url: "https://nodejs.org/releases?utm_source=search",
        description: "Official releases",
        page_age: "2026-07-16T10:00:00Z"
      }] } }, 200, { "x-request-id": "brave-1" });
    }
  });
  const result = await adapter.search({ query: "latest Node.js", freshness: "week", locale: "es-CO" });
  assert.equal(result.status, "completed");
  assert.equal(result.items[0].url, "https://nodejs.org/releases");
  assert.equal(result.items[0].snippet, "Official releases");
  assert.equal(result.requestId, "brave-1");
  assert.match(observedUrl, /freshness=pw/);
  assert.equal(observedHeaders["X-Subscription-Token"], "server-secret");
  assert.doesNotMatch(JSON.stringify(result), /server-secret/);
});

test("distingue configuracion, auth, rate limit, payload invalido y cero resultados", async () => {
  const missing = createBraveSearchAdapter({ apiKey: "" });
  assert.equal((await missing.getHealth()).status, "Misconfigured");
  await assert.rejects(missing.search({ query: "test" }), (error) => error.code === "WEB_TOOL_NOT_CONFIGURED");

  for (const [status, code] of [[401, "WEB_SEARCH_AUTH_ERROR"], [429, "WEB_SEARCH_RATE_LIMITED"]]) {
    const adapter = createBraveSearchAdapter({ apiKey: "key", fetchImpl: async () => jsonResponse({ message: "failed" }, status) });
    await assert.rejects(adapter.search({ query: "test" }), (error) => error.code === code);
  }
  const invalid = createBraveSearchAdapter({ apiKey: "key", fetchImpl: async () => jsonResponse({ nope: true }) });
  await assert.rejects(invalid.search({ query: "test" }), (error) => error.code === "WEB_SEARCH_INVALID_RESPONSE");
  const empty = createBraveSearchAdapter({ apiKey: "key", fetchImpl: async () => jsonResponse({ web: { results: [] } }) });
  assert.deepEqual((await empty.search({ query: "test" })).items, []);
});

test("propaga timeout y cancelacion", async () => {
  const pending = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })), { once: true });
  });
  const timeout = createBraveSearchAdapter({ apiKey: "key", timeoutMs: 500, fetchImpl: pending });
  await assert.rejects(timeout.search({ query: "test" }), (error) => error.code === "WEB_SEARCH_TIMEOUT");

  const controller = new AbortController();
  const cancelled = createBraveSearchAdapter({ apiKey: "key", fetchImpl: pending });
  const operation = cancelled.search({ query: "test" }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(operation, (error) => error.code === "WEB_CANCELLED");
});
