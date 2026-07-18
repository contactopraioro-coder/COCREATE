import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ATTACHMENT_IPC_CHANNELS, createAttachmentBroker } from "../electron/attachment-broker.mjs";

function harness(filePaths, canceled = false) {
  const handlers = new Map();
  const removed = new Set();
  const sender = new EventEmitter();
  const broker = createAttachmentBroker({
    ipcMain: {
      handle(channel, callback) { handlers.set(channel, callback); },
      removeHandler(channel) { removed.add(channel); }
    },
    dialog: { showOpenDialog: async () => ({ canceled, filePaths }) },
    browserWindow: { fromWebContents: () => ({ id: 7 }) }
  });
  return { broker, handlers, removed, event: { sender } };
}

test("Attachment broker validates picker files and resolves opaque tokens once for their owner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocreate-attachments-"));
  const allowed = path.join(root, "context.txt");
  const duplicate = allowed;
  const empty = path.join(root, "empty.md");
  const dangerous = path.join(root, "payload.exe");
  const oversized = path.join(root, "large.md");
  const missing = path.join(root, "missing.ts");
  const link = path.join(root, "context-link.txt");
  await writeFile(allowed, "trusted context");
  await writeFile(empty, "");
  await writeFile(dangerous, "not allowed");
  await writeFile(oversized, "");
  await truncate(oversized, 20 * 1024 * 1024 + 1);
  await symlink(allowed, link);
  const fixture = harness([allowed, duplicate, empty, dangerous, oversized, missing, link]);

  try {
    const selected = await fixture.handlers.get(ATTACHMENT_IPC_CHANNELS.select)(fixture.event, { kind: "file" });
    assert.equal(selected.length, 1);
    assert.equal(selected[0].name, "context.txt");
    assert.equal("path" in selected[0], false);
    assert.deepEqual(fixture.broker.resolve([selected[0].token], 99), []);
    assert.deepEqual(fixture.broker.resolve([selected[0].token], 7), [{ type: "mention", name: "context.txt", path: allowed }]);
    assert.deepEqual(fixture.broker.resolve([selected[0].token], 7), []);
  } finally {
    fixture.broker.dispose();
    await rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(new Set(Object.values(ATTACHMENT_IPC_CHANNELS)), fixture.removed);
});

test("Attachment broker supports safe drop, multiple selection, removal and cancellation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cocreate-attachment-drop-"));
  const image = path.join(root, "preview.png");
  const source = path.join(root, "app.ts");
  await writeFile(image, "image-bytes");
  await writeFile(source, "export {};");
  const fixture = harness([]);

  try {
    const dropped = await fixture.handlers.get(ATTACHMENT_IPC_CHANNELS.prepareDropped)(fixture.event, {
      paths: [image, source, image]
    });
    assert.deepEqual(dropped.map((entry) => entry.kind), ["image", "file"]);
    assert.ok(dropped.every((entry) => !("path" in entry)));
    const release = await fixture.handlers.get(ATTACHMENT_IPC_CHANNELS.release)(fixture.event, {
      tokens: [dropped[0].token]
    });
    assert.deepEqual(release, { ok: true, released: 1 });
    assert.deepEqual(fixture.broker.resolve([dropped[0].token], 7), []);
    assert.equal(fixture.broker.resolve([dropped[1].token], 7)[0].name, "app.ts");

    const cancelled = harness([], true);
    assert.deepEqual(await cancelled.handlers.get(ATTACHMENT_IPC_CHANNELS.select)(cancelled.event, { kind: "file" }), []);
    cancelled.broker.dispose();
  } finally {
    fixture.broker.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
