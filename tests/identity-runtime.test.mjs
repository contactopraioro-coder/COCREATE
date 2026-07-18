import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createIdentityStore } from "../electron/identity-store.mjs";
import { createIdentityRuntime } from "../shared/identity-runtime.js";

async function createTestIdentityRuntime() {
  const directory = await mkdtemp(path.join(tmpdir(), "cocreate-identity-"));
  const filePath = path.join(directory, "identity-store.json");
  const store = createIdentityStore({ filePath });
  const runtime = createIdentityRuntime({ store });
  return {
    filePath,
    store,
    runtime
  };
}

test("Identity runtime creates a stable local identity, profile and device", async () => {
  const { filePath, runtime } = await createTestIdentityRuntime();
  await runtime.initialize({
    locale: "es-CO",
    timezone: "America/Bogota",
    platform: "darwin",
    architecture: "arm64",
    appVersion: "0.0.1"
  });

  const first = await runtime.getSnapshot();
  assert.equal(first.identity?.type, "local");
  assert.equal(first.identity?.status, "active");
  assert.equal(first.profile?.identityId, first.identity?.id);
  assert.equal(first.device?.identityId, first.identity?.id);

  const secondStore = createIdentityStore({ filePath });
  const secondRuntime = createIdentityRuntime({ store: secondStore });
  await secondRuntime.initialize({
    locale: "es-CO",
    timezone: "America/Bogota",
    platform: "darwin",
    architecture: "arm64",
    appVersion: "0.0.1"
  });

  const second = await secondRuntime.getSnapshot();
  assert.equal(second.identity?.id, first.identity?.id);
  assert.equal(second.profile?.id, first.profile?.id);
  assert.equal(second.device?.id, first.device?.id);
});

test("Identity runtime updates profile safely and rejects secrets", async () => {
  const { runtime, store } = await createTestIdentityRuntime();
  await runtime.initialize();

  const updated = await runtime.updateUserProfile({
    displayName: "Martin",
    technicalLevel: "advanced",
    communicationPreferences: {
      style: "direct"
    }
  });

  assert.equal(updated.displayName, "Martin");
  assert.equal(updated.technicalLevel, "advanced");
  assert.equal(updated.communicationPreferences.style, "direct");

  await assert.rejects(
    () =>
      runtime.updateUserProfile({
        apiKey: "secret-value"
      }),
    /no puede almacenar secretos/i
  );

  const raw = JSON.parse(await readFile(store.filePath, "utf8"));
  assert.equal(JSON.stringify(raw).includes("secret-value"), false);
});

test("Identity runtime recovers from corrupted or unsupported identity store data", async () => {
  const { filePath } = await createTestIdentityRuntime();
  await writeFile(filePath, JSON.stringify({ version: 99, broken: true }), "utf8");

  const unsupportedStore = createIdentityStore({ filePath });
  const unsupportedState = await unsupportedStore.load();
  assert.equal(unsupportedState.version, 1);
  assert.equal(unsupportedState.metadata.recoveredFromUnsupportedVersion, 99);

  await writeFile(filePath, "{not-json", "utf8");
  const corruptedStore = createIdentityStore({ filePath });
  const corruptedState = await corruptedStore.load();
  assert.equal(corruptedState.version, 1);
  assert.equal(corruptedState.identity, null);
});

test("Identity runtime updates device lastSeenAt without duplicating the device", async () => {
  const { filePath, runtime } = await createTestIdentityRuntime();
  await runtime.initialize({
    platform: "darwin",
    architecture: "arm64",
    appVersion: "0.0.1"
  });

  const before = await runtime.getSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const device = await runtime.touchCurrentDevice({
    appVersion: "0.0.2"
  });

  assert.equal(device.id, before.device.id);
  assert.equal(device.appVersion, "0.0.2");
  assert.notEqual(device.lastSeenAt, before.device.lastSeenAt);

  const secondStore = createIdentityStore({ filePath });
  const secondRuntime = createIdentityRuntime({ store: secondStore });
  await secondRuntime.initialize({
    platform: "darwin",
    architecture: "arm64",
    appVersion: "0.0.2"
  });
  const second = await secondRuntime.getSnapshot();
  assert.equal(second.device.id, before.device.id);
});

test("Identity runtime prepares account linking without creating fake authentication", async () => {
  const { runtime } = await createTestIdentityRuntime();
  await runtime.initialize();

  const prepared = await runtime.prepareAccountLink({
    provider: "future-auth"
  });
  assert.equal(prepared.status, "prepared");

  const snapshot = await runtime.getSnapshot();
  assert.equal(snapshot.identity.linkedAccountId, null);
  assert.equal(snapshot.preparedLink.id, prepared.id);

  await assert.rejects(() => runtime.prepareAccountLink({ provider: "again" }), /solicitud local de vínculo preparada/i);
});
