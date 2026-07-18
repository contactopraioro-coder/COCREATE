import assert from "node:assert/strict";
import test from "node:test";
import {
  ScreenSharingService,
  type ScreenSharePreference,
  type ScreenSharingGateway
} from "../src/app/services/screen-sharing-service.js";

type FakeTrack = MediaStreamTrack & { stopped: boolean; enabled: boolean; end: () => void };

function fakeStream(label = "Pantalla principal") {
  let ended: (() => void) | null = null;
  const track = {
    label,
    enabled: true,
    stopped: false,
    getSettings: () => ({ displaySurface: "monitor", width: 1440, height: 900 }),
    addEventListener: (event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === "ended") ended = typeof listener === "function" ? () => listener(new Event("ended")) : () => listener.handleEvent(new Event("ended"));
    },
    removeEventListener: () => { ended = null; },
    stop: () => { track.stopped = true; },
    end() { ended?.(); }
  } as unknown as FakeTrack;
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track]
  } as unknown as MediaStream;
  return { stream, track };
}

function gateway(request: (preference: ScreenSharePreference) => Promise<MediaStream>): ScreenSharingGateway {
  return {
    isSupported: () => true,
    getPermissionStatus: async () => "not-determined",
    request,
    openPermissionSettings: async () => true
  };
}

test("screen sharing starts only after the explicit gateway request and never stores the stream in the snapshot", async () => {
  const selected = fakeStream();
  const service = new ScreenSharingService(gateway(async (preference) => {
    assert.equal(preference, "screen");
    return selected.stream;
  }));

  await service.initialize();
  const snapshot = await service.start("screen");

  assert.equal(snapshot.status, "sharing");
  assert.equal(snapshot.permission, "granted");
  assert.equal(snapshot.surface?.label, "Pantalla principal");
  assert.equal(service.getStream(), selected.stream);
  assert.equal("stream" in snapshot, false);
});

test("cancelling Change screen keeps the previously authorized surface", async () => {
  const selected = fakeStream("Ventana inicial");
  let calls = 0;
  const service = new ScreenSharingService(gateway(async () => {
    calls += 1;
    if (calls === 1) return selected.stream;
    throw new DOMException("cancelled", "AbortError");
  }));

  await service.start("window");
  const snapshot = await service.change("screen");

  assert.equal(snapshot.status, "sharing");
  assert.equal(snapshot.surface?.label, "Ventana inicial");
  assert.equal(service.getStream(), selected.stream);
  assert.equal(selected.track.stopped, false);
});

test("pause, stop and native track ending clean up capture deterministically", async () => {
  const first = fakeStream();
  const service = new ScreenSharingService(gateway(async () => first.stream));
  await service.start("screen");

  assert.equal(service.togglePause().status, "paused");
  assert.equal(first.track.enabled, false);
  assert.equal(service.togglePause().status, "sharing");
  assert.equal(first.track.enabled, true);
  service.stop("user");
  assert.equal(first.track.stopped, true);
  assert.equal(service.getStream(), null);
  assert.equal(service.getSnapshot().status, "ended");

  const second = fakeStream("Pestaña");
  const secondService = new ScreenSharingService(gateway(async () => second.stream));
  await secondService.start("tab");
  second.track.end();
  assert.equal(secondService.getSnapshot().status, "ended");
  assert.equal(secondService.getSnapshot().surface, null);
});

test("permission denial remains recoverable through the platform settings action", async () => {
  let settingsOpened = false;
  const deniedGateway = gateway(async () => {
    throw new DOMException("denied", "NotAllowedError");
  });
  deniedGateway.openPermissionSettings = async () => {
    settingsOpened = true;
    return true;
  };
  const service = new ScreenSharingService(deniedGateway);

  const snapshot = await service.start("screen");
  assert.equal(snapshot.status, "permission-denied");
  assert.equal(snapshot.permission, "denied");
  assert.equal(await service.openPermissionSettings(), true);
  assert.equal(settingsOpened, true);
});

test("unsupported browsers remain honest and never attempt a request", async () => {
  let requested = false;
  const service = new ScreenSharingService({
    isSupported: () => false,
    getPermissionStatus: async () => "unknown",
    request: async () => { requested = true; return fakeStream().stream; },
    openPermissionSettings: async () => false
  });

  const snapshot = await service.start("screen");
  assert.equal(snapshot.status, "unsupported");
  assert.equal(snapshot.supported, false);
  assert.equal(requested, false);
});
