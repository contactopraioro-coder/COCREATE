import assert from "node:assert/strict";
import test from "node:test";
import { registerVoiceIpc } from "../electron/voice-ipc.mjs";
import { createOpenAITranscriptionProvider } from "../electron/providers/openai-transcription-provider.mjs";

function ipcHarness(options = {}) {
  const handlers = new Map();
  const removed = new Set();
  const dispose = registerVoiceIpc({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { removed.add(channel); }
    },
    ...options
  });
  return { handlers, removed, dispose };
}

test("Voice IPC reports configuration honestly and validates audio before provider execution", async () => {
  const fixture = ipcHarness({ apiKey: "" });
  const health = await fixture.handlers.get("cocreate:voice:status")();
  assert.equal(health.status, "Misconfigured");
  await assert.rejects(
    fixture.handlers.get("cocreate:voice:transcribe")({}, { audioBase64: "not base64!", mimeType: "audio/webm" }),
    /formato o tamano permitido/
  );
  await assert.rejects(
    fixture.handlers.get("cocreate:voice:transcribe")({}, { audioBase64: "YXVkaW8=", mimeType: "audio/wav" }),
    /formato o tamano permitido/
  );
  fixture.dispose();
  assert.deepEqual(fixture.removed, new Set(["cocreate:voice:status", "cocreate:voice:transcribe"]));
});

test("Voice IPC transcribes through Provider Runtime without returning API keys or audio", async () => {
  let request;
  const fixture = ipcHarness({
    apiKey: "server-secret",
    model: "transcribe-model",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ text: "texto verificado" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "req-voice" }
      });
    }
  });
  const result = await fixture.handlers.get("cocreate:voice:transcribe")({}, {
    audioBase64: "YXVkaW8=",
    mimeType: "audio/webm",
    language: "es"
  });
  assert.deepEqual(result, { ok: true, text: "texto verificado", provider: "openai-transcription", model: "transcribe-model" });
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request.init.headers.Authorization, "Bearer server-secret");
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
  assert.equal(JSON.stringify(result).includes("YXVkaW8="), false);
  fixture.dispose();
});

test("Transcription provider preserves a safe rate-limit error", async () => {
  const provider = createOpenAITranscriptionProvider({
    apiKey: "secret",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "upstream private detail" } }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    })
  });
  await assert.rejects(provider.execute({
    operation: "transcription",
    input: { audioBase64: "YXVkaW8=", mimeType: "audio/webm" }
  }), (error) => error.code === "PROVIDER_UPSTREAM_ERROR" && error.health === "Rate Limited" && !error.safeMessage.includes("private"));
});
