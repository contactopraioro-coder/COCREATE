import assert from "node:assert/strict";
import test from "node:test";

import { createChatRequestGuard } from "../api/_lib/web-request-guard.js";

test("chat request guard limita tamaño, historial y abuso", () => {
  const guard = createChatRequestGuard({
    maxRequests: 2,
    windowMs: 60_000,
    maxBodyBytes: 2_000,
    maxPromptChars: 500,
    maxHistoryItems: 2
  });
  const base = { headers: { "x-forwarded-for": "203.0.113.8" }, body: { prompt: "hola" } };
  assert.equal(guard(base, 1_000).ok, true);
  assert.equal(guard(base, 1_001).ok, true);
  const limited = guard(base, 1_002);
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.status, 429);

  const invalidHistory = guard({ headers: {}, body: { prompt: "hola", history: [{}, {}, {}] } }, 1_000);
  assert.equal(invalidHistory.ok, false);
  const oversized = guard({ headers: {}, body: { prompt: "x".repeat(2_100) } }, 1_000);
  assert.equal(oversized.ok, false);
  const invalidAttachment = guard({ headers: {}, body: {
    prompt: "revisa",
    attachments: [{ name: "payload.exe", size: 3, type: "application/x-msdownload", dataBase64: "cnVu" }]
  } }, 1_000);
  assert.equal(invalidAttachment.ok, false);
  if (!invalidAttachment.ok) assert.equal(invalidAttachment.code, "INVALID_ATTACHMENTS");
});
