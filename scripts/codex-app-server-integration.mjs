import { createCodexAppServerProcessManager } from "../infrastructure/codex-app-server/process-manager.js";

const manager = createCodexAppServerProcessManager({
  binary: process.env.CODEX_BINARY ?? "codex",
  cwd: process.cwd(),
  clientVersion: "contract-test",
  restartLimit: 0
});

try {
  const status = await manager.start();
  if (!status.available) {
    throw new Error(
      status.authenticated
        ? "Codex App Server handshake completed but runtime health is unavailable."
        : "Codex App Server requires a valid Codex login."
    );
  }
  console.log(JSON.stringify({
    ok: true,
    processState: status.processState,
    codexVersion: status.codexVersion,
    protocolVersion: status.protocolVersion,
    authenticated: status.authenticated,
    authMode: status.authMode,
    configuredMcpServers: status.mcp.configuredServers,
    webSearch: status.webSearch
  }, null, 2));
} finally {
  await manager.stop();
}
