import assert from "node:assert/strict";
import test from "node:test";
import { createServerDateTimeTool, createServerModelResponder } from "../api/_lib/trusted-assistant-tools.js";

const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

test.beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
});

test.after(() => {
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
  if (originalGeminiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalGeminiKey;
  }
});

test("Server model responder parses a complete OpenAI response", async () => {
  const responder = createServerModelResponder({
    fetchImpl: async () =>
      new Response(JSON.stringify({ output_text: "Respuesta completa" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  });

  const result = await responder.respond({ prompt: "hola" });
  assert.deepEqual(result, {
    output: "Respuesta completa",
    provider: "openai"
  });
});

test("Server model responder parses a streamed HTTP response body", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"output_'));
      controller.enqueue(encoder.encode('text":"Respuesta por fragmentos"}'));
      controller.close();
    }
  });
  const responder = createServerModelResponder({
    fetchImpl: async () =>
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  });

  const result = await responder.respond({ prompt: "hola" });
  assert.equal(result.output, "Respuesta por fragmentos");
});

test("Server model responder normalizes provider errors", async () => {
  const responder = createServerModelResponder({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    responder.respond({ prompt: "hola" }),
    (error: any) => error.code === "PROVIDER_UPSTREAM_ERROR" && error.provider === "openai" && error.retriable
  );
});

test("Server model responder normalizes an inaccessible provider", async () => {
  const responder = createServerModelResponder({
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND api.openai.com");
    }
  });

  await assert.rejects(
    responder.respond({ prompt: "hola" }),
    (error: any) => error.code === "PROVIDER_NETWORK_ERROR" && error.kind === "network"
  );
});

test("Server model responder aborts and normalizes timeouts", async () => {
  const responder = createServerModelResponder({
    timeoutMs: 5,
    fetchImpl: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true
        });
      })
  });

  await assert.rejects(
    responder.respond({ prompt: "hola" }),
    (error: any) => error.code === "PROVIDER_TIMEOUT" && error.kind === "timeout" && error.retriable
  );
});

test("Server model responder rejects an empty provider payload", async () => {
  const responder = createServerModelResponder({
    fetchImpl: async () =>
      new Response(JSON.stringify({ output: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    responder.respond({ prompt: "hola" }),
    (error: any) => error.code === "PROVIDER_EMPTY_RESPONSE" && error.kind === "parsing"
  );
});

test("Server DateTimeTool validates browser timezone context and records its source", async () => {
  const snapshot = await createServerDateTimeTool({
    timezone: "America/Bogota",
    locale: "es-CO",
    timezoneSource: "browser"
  }).getCurrentDateTime();

  assert.equal(snapshot.timezone, "America/Bogota");
  assert.equal(snapshot.timezoneSource, "browser");
  assert.equal(snapshot.locale, "es-CO");
  assert.equal(snapshot.resolvedAt, snapshot.iso);
  assert.ok(snapshot.dayOfWeek);
  assert.ok(snapshot.monthName);
});
