import assert from "node:assert/strict";
import test from "node:test";

import { createTrustedWebTool } from "../shared/trusted-web-tool.js";

const now = new Date().toISOString();

function searchProvider(items) {
  return {
    id: "test-search",
    async getHealth() { return { status: "Healthy" }; },
    async search(input) {
      return { query: input.query, provider: "test-search", searchedAt: now, status: "completed", items, warnings: [] };
    }
  };
}

test("produce respuesta Verified con fuentes y citas realmente recuperadas", async () => {
  const items = [{
    id: "official",
    title: "Official current office",
    url: "https://example.gov/current-office",
    domain: "example.gov",
    rank: 1,
    retrievedAt: now,
    sourceType: "official"
  }];
  const tool = createTrustedWebTool({
    searchProvider: searchProvider(items),
    fetcher: { async fetch(input) { return {
      url: input.url,
      finalUrl: input.url,
      title: "Official current office",
      contentType: "text/html",
      text: "The official current office holder is Example Person.",
      retrievedAt: now,
      statusCode: 200,
      truncated: false,
      warnings: []
    }; } },
    synthesizer: { async synthesize() { return { answer: "La fuente oficial identifica a Example Person. [official]", sourceIds: ["official"], conflicts: [] }; } }
  });
  const result = await tool.answer({ query: "current office holder" }, { requestId: "web-1" });
  assert.equal(result.confidence, "Verified");
  assert.equal(result.grounded, true);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].url, items[0].url);
  assert.ok(result.verifiedAt);
  assert.equal(result.metadata.searchesCount, 1);
});

test("no marca Verified cuando todas las fuentes fallan", async () => {
  const tool = createTrustedWebTool({
    searchProvider: searchProvider([{ id: "a", title: "A", url: "https://a.example.com", domain: "a.example.com", rank: 1, retrievedAt: now }]),
    fetcher: { async fetch() { throw Object.assign(new Error("failed"), { code: "WEB_FETCH_PARSE_ERROR" }); } }
  });
  const result = await tool.answer({ query: "current fact" });
  assert.equal(result.confidence, "InsufficientEvidence");
  assert.equal(result.grounded, false);
  assert.equal(result.citations.length, 0);
  assert.equal(result.verifiedAt, undefined);
});

test("limita busqueda y fetches y respeta cancelacion", async () => {
  let fetches = 0;
  const items = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index}`,
    title: `S${index}`,
    url: `https://source${index}.example.com/a`,
    domain: `source${index}.example.com`,
    rank: index + 1,
    retrievedAt: now
  }));
  const tool = createTrustedWebTool({
    searchProvider: searchProvider(items),
    maxFetches: 2,
    fetcher: { async fetch(input) { fetches += 1; return {
      url: input.url, finalUrl: input.url, contentType: "text/plain", text: "Relevant public evidence.",
      retrievedAt: now, statusCode: 200, truncated: false, warnings: []
    }; } }
  });
  await tool.answer({ query: "public evidence" });
  assert.equal(fetches, 2);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tool.answer({ query: "cancel" }, { signal: controller.signal }), (error) => error.code === "WEB_CANCELLED");
});
