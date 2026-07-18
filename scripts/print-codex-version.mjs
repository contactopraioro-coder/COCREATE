import { resolveCodexStatus } from "../shared/codex-runner.js";

const status = await resolveCodexStatus({
  binary: process.env.CODEX_BINARY ?? "codex"
});

console.log(JSON.stringify(status, null, 2));
