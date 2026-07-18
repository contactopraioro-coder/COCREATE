import assert from "node:assert/strict";
import test from "node:test";

import {
  TRUSTED_WEB_IPC_CHANNELS,
  assertTrustedWebCancelRequest,
  assertTrustedWebExecuteRequest
} from "../shared/trusted-web-ipc.js";

test("Trusted Web IPC expone canales dedicados y valida execute", () => {
  assert.equal(TRUSTED_WEB_IPC_CHANNELS.execute, "trusted-web:execute");
  assert.doesNotThrow(() => assertTrustedWebExecuteRequest({ requestId: "web-1", input: { query: "noticias actuales" } }));
  for (const payload of [null, {}, { requestId: "", input: { query: "x" } }, { requestId: "web", input: { query: "" } }]) {
    assert.throws(() => assertTrustedWebExecuteRequest(payload));
  }
});

test("Trusted Web IPC valida cancelación por request owner id", () => {
  assert.doesNotThrow(() => assertTrustedWebCancelRequest({ requestId: "web-1", reason: "user" }));
  assert.throws(() => assertTrustedWebCancelRequest({ requestId: "" }));
  assert.throws(() => assertTrustedWebCancelRequest(null));
});
