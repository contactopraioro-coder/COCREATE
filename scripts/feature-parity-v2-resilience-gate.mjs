import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCodexAppServerProcessManager } from "../infrastructure/codex-app-server/process-manager.js";
import { createCodexAppServerAdapter } from "../infrastructure/codex-app-server/app-server-adapter.js";

const root = await mkdtemp(path.join(tmpdir(), "cocreate-resilience-gate-"));
const evidencePath = "/tmp/cocreate-feature-parity-v2-resilience.json";
let mapping = null;
const lifecycle = [];

const manager = createCodexAppServerProcessManager({
  binary: process.env.CODEX_BINARY ?? "codex",
  cwd: root,
  clientVersion: "feature-parity-v2-certification",
  restartLimit: 1,
  restartBaseDelayMs: 100
});
const unsubscribe = manager.subscribeLifecycle((event) => {
  lifecycle.push({ type: event.type, state: event.state ?? null });
});
const adapter = createCodexAppServerAdapter({
  processManager: manager,
  cwd: root,
  requestApproval: async () => false,
  persistThreadMapping: async (next) => { mapping = next.codexThreadId; }
});

async function execute(prompt) {
  const upstreamTypes = [];
  let streamed = false;
  const handle = await adapter.execute({
    prompt,
    origin: "desktop-renderer",
    timeoutMs: 120_000,
    metadata: {
      workspaceContext: {
        workspaceId: "certification-workspace",
        projectId: "certification-project",
        taskId: "certification-task",
        conversationId: "certification-conversation",
        codexThreadId: mapping,
        rootPath: root
      }
    }
  }, (event) => {
    if (event.type === "execution.output") streamed = true;
    if (event.type === "codex.upstream") upstreamTypes.push(event.event.type);
  });
  const terminal = await handle.completed;
  return {
    terminal: terminal.type,
    outputVerified: terminal.type === "execution.completed" && Boolean(terminal.output?.trim()),
    streamed,
    upstreamTypes: [...new Set(upstreamTypes)]
  };
}

try {
  const initial = await manager.start();
  const before = await execute("Responde solamente: BEFORE RESTART OK. No uses herramientas ni modifiques archivos.");
  const threadBeforeRestart = mapping;
  const restarted = await manager.restart();
  const mcp = await manager.getClient().request("mcpServerStatus/list", { cursor: null, limit: 100 }, { timeoutMs: 20_000 });
  const after = await execute("Responde solamente: AFTER RESTART OK. No uses herramientas ni modifiques archivos.");
  const webSearch = await execute("Usa busqueda web real para identificar el dominio oficial de la documentacion de Codex y responde solo con el dominio verificado.");
  const webSearchObserved = webSearch.upstreamTypes.some((type) => type.startsWith("webSearch."));
  const result = {
    ok: initial.available && restarted.available && restarted.restartCount >= 1 &&
      before.terminal === "execution.completed" && after.terminal === "execution.completed" &&
      webSearch.terminal === "execution.completed" && webSearchObserved &&
      Boolean(threadBeforeRestart) && mapping === threadBeforeRestart && after.upstreamTypes.includes("thread.resumed"),
    initial: { state: initial.processState, authenticated: initial.authenticated, version: initial.codexVersion },
    restart: { state: restarted.processState, available: restarted.available, restartCount: restarted.restartCount },
    continuity: { sameThread: mapping === threadBeforeRestart, before, after },
    webSearch: { ...webSearch, observed: webSearchObserved },
    mcpAfterRestart: { count: Array.isArray(mcp?.data) ? mcp.data.length : null },
    lifecycle
  };
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  unsubscribe();
  await adapter.dispose().catch(() => manager.stop());
  await rm(root, { recursive: true, force: true });
}
