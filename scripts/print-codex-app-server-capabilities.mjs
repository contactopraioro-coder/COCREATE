import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CODEX_APP_SERVER_PROTOCOL_MANIFEST } from "../infrastructure/codex-app-server/protocol-manifest.js";
import { normalizeCodexVersion } from "../shared/codex-upstream-contracts.js";

const execFileAsync = promisify(execFile);
const binary = process.env.CODEX_BINARY ?? "codex";
const versionResult = await execFileAsync(binary, ["--version"], { timeout: 5_000 });
const version = normalizeCodexVersion(versionResult.stdout || versionResult.stderr);

console.log(JSON.stringify({
  binary,
  installedVersion: version,
  validatedVersion: CODEX_APP_SERVER_PROTOCOL_MANIFEST.codexVersion,
  compatible: version === CODEX_APP_SERVER_PROTOCOL_MANIFEST.codexVersion,
  protocolVersion: CODEX_APP_SERVER_PROTOCOL_MANIFEST.protocolVersion,
  transport: "stdio JSONL",
  capabilities: CODEX_APP_SERVER_PROTOCOL_MANIFEST.capabilities,
  counts: {
    clientRequests: CODEX_APP_SERVER_PROTOCOL_MANIFEST.clientRequests.length,
    clientNotifications: CODEX_APP_SERVER_PROTOCOL_MANIFEST.clientNotifications.length,
    serverRequests: CODEX_APP_SERVER_PROTOCOL_MANIFEST.serverRequests.length,
    serverNotifications: CODEX_APP_SERVER_PROTOCOL_MANIFEST.serverNotifications.length,
    experimentalClientRequests: CODEX_APP_SERVER_PROTOCOL_MANIFEST.experimental.clientRequests.length,
    experimentalServerNotifications: CODEX_APP_SERVER_PROTOCOL_MANIFEST.experimental.serverNotifications.length
  },
  experimental: CODEX_APP_SERVER_PROTOCOL_MANIFEST.experimental
}, null, 2));
