import test from "node:test";
import assert from "node:assert/strict";
import { resolveCodexStatus } from "../shared/codex-runner.js";

test("Codex runner integration status probe", { skip: !process.env.RUN_CODEX_INTEGRATION }, async () => {
  const status = await resolveCodexStatus({
    binary: process.env.CODEX_BINARY ?? "codex"
  });

  assert.equal(typeof status.available, "boolean");
  assert.equal(typeof status.binary, "string");
});
