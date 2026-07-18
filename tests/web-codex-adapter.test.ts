import assert from "node:assert/strict";
import test from "node:test";
import type { CodexExecutionEvent } from "../shared/codex-contracts.js";
import { WebCodexAdapter } from "../src/infrastructure/codex/web-codex-adapter.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("WebCodexAdapter accepts a complete trusted response", async () => {
  let requestBody: any = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        ok: true,
        output: "Hola desde el modelo",
        provider: "openai",
        confidence: "Estimated",
        capability: "model"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const adapter = new WebCodexAdapter();
  const events: CodexExecutionEvent[] = [];
  const handle = await adapter.execute(
    {
      prompt: "hola",
      origin: "test",
      metadata: {
        webAttachments: [{
          token: "web-token",
          name: "captura.png",
          kind: "image",
          size: 3,
          type: "image/png",
          source: "web",
          dataBase64: "YWJj"
        }]
      }
    },
    async (event) => {
      events.push(event);
    }
  );

  const terminal = await handle.completed;
  assert.equal(terminal.type, "execution.completed");
  assert.ok(events.some((event) => event.type === "execution.output" && event.chunk === "Hola desde el modelo"));
  assert.equal(typeof requestBody.context.timezone, "string");
  assert.equal(typeof requestBody.context.locale, "string");
  assert.equal(requestBody.attachments[0].name, "captura.png");
  assert.equal(requestBody.attachments[0].dataBase64, "YWJj");
  assert.equal("path" in requestBody.attachments[0], false);
});

test("WebCodexAdapter preserves a trusted model failure", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        output: "No pude conectar con el modelo. Revisa la conexión e inténtalo de nuevo.",
        provider: "openai",
        confidence: "Unavailable",
        capability: "model"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  const adapter = new WebCodexAdapter();
  const handle = await adapter.execute({ prompt: "hola", origin: "test" }, async () => undefined);

  const terminal = await handle.completed;
  assert.equal(terminal.type, "execution.failed");
  if (terminal.type === "execution.failed") {
    assert.match(terminal.error.safeMessage, /No pude conectar con el modelo/);
  }
});
