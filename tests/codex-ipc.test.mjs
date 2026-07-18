import test from "node:test";
import assert from "node:assert/strict";
import { assertCancelCodexExecutionRequest, assertStartCodexExecutionRequest } from "../shared/codex-ipc.js";

test("IPC guards reject invalid execute payloads", () => {
  assert.throws(
    () => assertStartCodexExecutionRequest({ prompt: "", origin: "desktop-renderer" }),
    (error) => error?.message === "Invalid execute payload."
  );
  assert.throws(
    () => assertStartCodexExecutionRequest(null),
    (error) => error?.message === "Invalid execute payload."
  );
});

test("IPC guards reject invalid cancel payloads", () => {
  assert.throws(
    () => assertCancelCodexExecutionRequest({}),
    (error) => error?.message === "Invalid cancel payload."
  );
  assert.throws(
    () => assertCancelCodexExecutionRequest({ executionId: "" }),
    (error) => error?.message === "Invalid cancel payload."
  );
});
