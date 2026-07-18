import { randomUUID } from "node:crypto";
import channels from "../shared/upstream-capabilities-ipc-channels.json" with { type: "json" };
import { redactCodexDiagnostic } from "../shared/codex-upstream-contracts.js";

const skillTokenTtlMs = 30 * 60 * 1_000;

function safeFailure(cause, fallback) {
  return {
    ok: false,
    error: cause instanceof Error && cause.message ? redactCodexDiagnostic(cause.message, 500) : fallback
  };
}

export function registerUpstreamCapabilitiesIpc({ ipcMain, browserWindow, adapter }) {
  const skillTokens = new Map();
  const cleanupHooks = new Map();

  const ownerFor = (event) => browserWindow.fromWebContents(event.sender)?.id ?? null;
  const prune = () => {
    const now = Date.now();
    for (const [token, entry] of skillTokens) {
      if (entry.expiresAt <= now) skillTokens.delete(token);
    }
  };
  const cleanupOwner = (ownerWindowId) => {
    for (const [token, entry] of skillTokens) {
      if (entry.ownerWindowId === ownerWindowId) skillTokens.delete(token);
    }
  };
  const attachCleanup = (event, ownerWindowId) => {
    if (cleanupHooks.has(ownerWindowId)) return;
    const cleanup = () => {
      cleanupOwner(ownerWindowId);
      cleanupHooks.delete(ownerWindowId);
    };
    event.sender.once("destroyed", cleanup);
    cleanupHooks.set(ownerWindowId, () => event.sender.removeListener("destroyed", cleanup));
  };
  const broadcast = (event) => {
    for (const window of browserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channels.changed, event);
    }
  };

  ipcMain.handle(channels.snapshot, () => adapter.snapshot());
  ipcMain.handle(channels.plans, async () => {
    try {
      return { ok: true, ...(await adapter.listPlanModes()) };
    } catch (cause) {
      return safeFailure(cause, "Plan Mode no esta disponible.");
    }
  });
  ipcMain.handle(channels.extensions, async (event) => {
    const ownerWindowId = ownerFor(event);
    if (!ownerWindowId) return safeFailure(null, "No pude resolver la ventana propietaria.");
    attachCleanup(event, ownerWindowId);
    prune();
    const [skillsResult, pluginsResult, mcpResult] = await Promise.allSettled([
      adapter.listSkills(),
      adapter.listPlugins(),
      adapter.listMcpServers()
    ]);
    const skillsPayload = skillsResult.status === "fulfilled" ? skillsResult.value : { data: [], errors: [safeFailure(skillsResult.reason, "Skills no disponible.")] };
    const skills = skillsPayload.data.map((skill) => {
      const token = randomUUID();
      if (skill.privatePath) {
        skillTokens.set(token, {
          ownerWindowId,
          path: skill.privatePath,
          name: skill.name,
          expiresAt: Date.now() + skillTokenTtlMs
        });
      }
      return {
        token: skill.privatePath ? token : null,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        enabled: skill.enabled,
        source: skill.source,
        stability: "experimental"
      };
    });
    return {
      ok: true,
      skills: { data: skills, errors: skillsPayload.errors ?? [], stability: "experimental" },
      plugins: pluginsResult.status === "fulfilled"
        ? pluginsResult.value
        : { data: [], errors: [safeFailure(pluginsResult.reason, "Plugins no disponible.")], stability: "experimental", readOnly: true },
      mcp: mcpResult.status === "fulfilled"
        ? mcpResult.value
        : { data: [], errors: [safeFailure(mcpResult.reason, "MCP no disponible.")], stability: "stable" },
      updatedAt: new Date().toISOString()
    };
  });
  ipcMain.handle(channels.refresh, async () => {
    const result = await adapter.snapshot();
    broadcast({ type: "manual.refresh", timestamp: new Date().toISOString() });
    return result;
  });

  const unsubscribe = adapter.subscribe(broadcast);
  return {
    resolveSkillInputs(tokens, ownerWindowId) {
      prune();
      return (Array.isArray(tokens) ? tokens : []).slice(0, 8).flatMap((token) => {
        const entry = skillTokens.get(token);
        if (!entry || entry.ownerWindowId !== ownerWindowId) return [];
        skillTokens.delete(token);
        return [{ type: "skill", name: entry.name, path: entry.path }];
      });
    },
    dispose() {
      unsubscribe();
      adapter.dispose();
      ipcMain.removeHandler(channels.snapshot);
      ipcMain.removeHandler(channels.plans);
      ipcMain.removeHandler(channels.extensions);
      ipcMain.removeHandler(channels.refresh);
      for (const cleanup of cleanupHooks.values()) cleanup();
      cleanupHooks.clear();
      skillTokens.clear();
    }
  };
}
