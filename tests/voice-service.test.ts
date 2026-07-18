import assert from "node:assert/strict";
import test from "node:test";
import { VoiceService, type VoiceGateway, type VoiceRecordingHandle } from "../src/app/services/voice-service.js";

function deferredHandle() {
  let ended: () => void = () => undefined;
  let transcriptListener: ((event: { transcript: string; interimTranscript: string }) => void) | null = null;
  let cancelled = 0;
  let stopped = 0;
  const handle: VoiceRecordingHandle = {
    async stop() { stopped += 1; return { audioBase64: "YXVkaW8=", mimeType: "audio/webm" }; },
    async cancel() { cancelled += 1; },
    onDeviceEnded(listener) { ended = listener; return () => { ended = () => undefined; }; },
    onTranscript(listener) { transcriptListener = listener; return () => { transcriptListener = null; }; }
  };
  return {
    handle,
    end: () => ended(),
    emitTranscript: (event: { transcript: string; interimTranscript: string }) => transcriptListener?.(event),
    get cancelled() { return cancelled; },
    get stopped() { return stopped; }
  };
}

test("Voice requests permission only on explicit start and releases recording after transcription", async () => {
  const recording = deferredHandle();
  let starts = 0;
  const gateway: VoiceGateway = {
    inspect: async () => ({ supported: true, permission: "prompt", devices: [{ id: "mic-1", label: "Studio" }, { id: "mic-2", label: "USB" }] }),
    start: async (deviceId) => { starts += 1; assert.equal(deviceId, "mic-2"); return recording.handle; },
    transcribe: async (input) => { assert.equal(input.audioBase64, "YXVkaW8="); return { text: "  texto revisable  " }; }
  };
  const service = new VoiceService(gateway);
  await service.initialize();
  assert.equal(starts, 0);
  service.selectDevice("mic-2");
  await service.start();
  assert.equal(service.getSnapshot().status, "recording");
  recording.emitTranscript({ transcript: "quiero mover", interimTranscript: "el boton" });
  assert.equal(service.getSnapshot().transcript, "quiero mover");
  assert.equal(service.getSnapshot().interimTranscript, "el boton");
  assert.equal(await service.stopAndTranscribe(), "texto revisable");
  assert.equal(recording.stopped, 1);
  assert.equal(service.getSnapshot().status, "idle");
  assert.equal(service.getSnapshot().transcript, "texto revisable");
  assert.equal(service.getSnapshot().interimTranscript, "");
  await service.dispose();
});

test("Voice handles denied permission, device disconnect, cancellation and retry without blocking", async () => {
  let shouldDeny = true;
  let recording = deferredHandle();
  const gateway: VoiceGateway = {
    inspect: async () => ({ supported: true, permission: "prompt", devices: [{ id: "mic", label: "Mic" }] }),
    start: async () => {
      if (shouldDeny) throw new Error("Permission denied");
      return recording.handle;
    },
    transcribe: async () => ({ text: "ok" })
  };
  const service = new VoiceService(gateway);
  await service.initialize();
  await assert.rejects(service.start(), /Permission denied/);
  assert.equal(service.getSnapshot().status, "denied");

  shouldDeny = false;
  await service.start();
  recording.end();
  assert.equal(service.getSnapshot().status, "unavailable");

  recording = deferredHandle();
  await service.start();
  await service.cancel();
  assert.equal(recording.cancelled, 1);
  assert.equal(service.getSnapshot().status, "idle");
  await service.dispose();
});

test("Voice timeout cancels and cleans up the active microphone", async () => {
  const recording = deferredHandle();
  const service = new VoiceService({
    inspect: async () => ({ supported: true, permission: "granted", devices: [] }),
    start: async () => recording.handle,
    transcribe: async () => ({ text: "unused" })
  }, 5);
  await service.initialize();
  await service.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(recording.cancelled, 1);
  assert.equal(service.getSnapshot().status, "error");
  assert.match(service.getSnapshot().error ?? "", /limite de tiempo/);
  await service.dispose();
});

test("Voice permission timeout exits requesting state and cleans up a late microphone", async () => {
  const recording = deferredHandle();
  const service = new VoiceService({
    inspect: async () => ({ supported: true, permission: "prompt", devices: [] }),
    start: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return recording.handle;
    },
    transcribe: async () => ({ text: "unused" })
  }, 120_000, 5);

  await service.initialize();
  await assert.rejects(service.start(), /solicitud del micrófono/);
  assert.equal(service.getSnapshot().status, "error");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(recording.cancelled, 1);
  await service.dispose();
});
