import { buildUpstreamStabilitySnapshot } from "../../shared/upstream-stability.js";
import { redactCodexDiagnostic } from "../../shared/codex-upstream-contracts.js";

function safeText(value, max = 500) {
  return typeof value === "string" ? redactCodexDiagnostic(value, max) : "";
}

function safeEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function authLabel(value) {
  if (typeof value === "string") return safeText(value, 80) || "unknown";
  if (!value || typeof value !== "object") return "unknown";
  return safeText(value.status ?? value.type ?? value.kind, 80) || "unknown";
}

function pluginSource(value) {
  if (typeof value === "string") return safeText(value, 80) || "unknown";
  if (!value || typeof value !== "object") return "unknown";
  return safeText(value.type ?? value.kind ?? value.name, 80) || "unknown";
}

export function createUpstreamStabilityAdapter(options = {}) {
  if (!options.processManager) throw new TypeError("Upstream Stability Adapter requires a process manager.");
  const processManager = options.processManager;
  const cwd = options.cwd ?? process.cwd();
  const startupStates = new Map();
  const listeners = new Set();
  let lastError = null;

  const notify = (event) => {
    for (const listener of listeners) listener(event);
  };

  const unsubscribeNotifications = processManager.subscribe((notification) => {
    if (notification?.method === "mcpServer/startupStatus/updated") {
      const name = safeText(notification.params?.name, 160);
      if (name) {
        startupStates.set(name, {
          state: safeEnum(notification.params?.status, ["starting", "ready", "failed", "cancelled"], "failed"),
          error: notification.params?.error ? safeText(notification.params.error, 500) : null,
          updatedAt: new Date().toISOString()
        });
      }
      notify({ type: "mcp.updated", name, timestamp: new Date().toISOString() });
    }
    if (notification?.method === "skills/changed") {
      notify({ type: "skills.updated", timestamp: new Date().toISOString() });
    }
  });
  const unsubscribeLifecycle = processManager.subscribeLifecycle((event) => {
    notify({ type: "runtime.updated", state: event?.state ?? "unknown", timestamp: new Date().toISOString() });
  });

  async function snapshot() {
    let status = processManager.getStatus();
    if (status.processState !== "ready") {
      try {
        status = await processManager.ensureReady();
      } catch (cause) {
        lastError = safeText(cause?.safeMessage ?? cause?.message ?? "Codex App Server no esta disponible.", 500);
        status = processManager.getStatus();
      }
    }
    const result = buildUpstreamStabilitySnapshot({
      environment: "desktop",
      upstreamVersion: status.codexVersion,
      compatible: status.compatibility === "compatible",
      overrides: options.featureFlagOverrides
    });
    return {
      ...result,
      runtime: {
        available: status.available === true,
        authenticated: status.authenticated === true,
        processState: status.processState,
        restartCount: status.restartCount ?? 0
      },
      lastError
    };
  }

  async function assertEnabled(capabilityId) {
    const current = await snapshot();
    const descriptor = current.descriptors.find((entry) => entry.id === capabilityId);
    if (!descriptor?.enabled || !current.runtime.available) {
      const error = new Error(descriptor?.reason ?? "La capability upstream no esta disponible.");
      error.code = descriptor?.state === "Disabled" ? "CAPABILITY_DISABLED" : "CAPABILITY_UNAVAILABLE";
      throw error;
    }
    return current;
  }

  async function listPlanModes() {
    await assertEnabled("plan-mode");
    try {
      const response = await processManager.getClient().request("collaborationMode/list", {}, { timeoutMs: 10_000 });
      lastError = null;
      return {
        stability: "experimental",
        data: Array.isArray(response?.data)
          ? response.data.flatMap((entry) => {
              const mode = safeEnum(entry?.mode, ["plan", "default"], null);
              if (!mode || typeof entry?.name !== "string") return [];
              return [{
                id: mode,
                name: safeText(entry.name, 80),
                mode,
                model: typeof entry.model === "string" ? safeText(entry.model, 160) : null,
                reasoningEffort: typeof entry.reasoning_effort === "string" ? safeText(entry.reasoning_effort, 40) : null
              }];
            })
          : []
      };
    } catch (cause) {
      lastError = safeText(cause?.safeMessage ?? cause?.message ?? "Plan Mode no respondio.", 500);
      throw new Error(lastError);
    }
  }

  async function listSkills() {
    await assertEnabled("skills");
    try {
      const response = await processManager.getClient().request("skills/list", { cwds: [cwd], forceReload: false }, { timeoutMs: 20_000 });
      const seen = new Set();
      const skills = [];
      const errors = [];
      for (const group of Array.isArray(response?.data) ? response.data : []) {
        for (const skill of Array.isArray(group?.skills) ? group.skills : []) {
          const name = safeText(skill?.name, 160);
          const scope = safeEnum(skill?.scope, ["user", "repo", "system", "admin"], "user");
          const key = `${scope}:${name}`;
          if (!name || seen.has(key)) continue;
          seen.add(key);
          skills.push({
            name,
            description: safeText(skill?.shortDescription ?? skill?.description, 500),
            scope,
            enabled: skill?.enabled === true,
            source: "codex-skill",
            privatePath: typeof skill?.path === "string" ? skill.path : null
          });
        }
        for (const error of Array.isArray(group?.errors) ? group.errors : []) {
          errors.push({ message: safeText(error?.message, 500) || "Codex no pudo cargar una skill." });
        }
      }
      lastError = null;
      return { stability: "experimental", data: skills, errors: errors.slice(0, 20) };
    } catch (cause) {
      lastError = safeText(cause?.safeMessage ?? cause?.message ?? "Skills no respondio.", 500);
      throw new Error(lastError);
    }
  }

  async function listPlugins() {
    await assertEnabled("plugins");
    try {
      const response = await processManager.getClient().request("plugin/list", { cwds: [cwd], marketplaceKinds: [] }, { timeoutMs: 20_000 });
      const seen = new Set();
      const plugins = [];
      for (const marketplace of Array.isArray(response?.marketplaces) ? response.marketplaces : []) {
        const provider = safeText(marketplace?.name, 120) || "Codex";
        for (const plugin of Array.isArray(marketplace?.plugins) ? marketplace.plugins : []) {
          const id = safeText(plugin?.id, 160);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          plugins.push({
            id,
            name: safeText(plugin?.name, 160) || id,
            provider,
            source: pluginSource(plugin?.source),
            version: typeof plugin?.localVersion === "string" ? safeText(plugin.localVersion, 80) : null,
            installed: plugin?.installed === true,
            enabled: plugin?.enabled === true,
            availability: safeText(plugin?.availability, 80) || "unknown",
            auth: safeText(plugin?.authPolicy, 80) || "unknown",
            capabilities: Array.isArray(plugin?.keywords) ? plugin.keywords.filter((value) => typeof value === "string").map((value) => safeText(value, 80)).slice(0, 20) : []
          });
        }
      }
      const errors = Array.isArray(response?.marketplaceLoadErrors)
        ? response.marketplaceLoadErrors.map((entry) => ({ message: safeText(entry?.message ?? entry?.error, 500) || "Marketplace no disponible." })).slice(0, 20)
        : [];
      lastError = null;
      return { stability: "experimental", readOnly: true, data: plugins, errors };
    } catch (cause) {
      lastError = safeText(cause?.safeMessage ?? cause?.message ?? "Plugins no respondio.", 500);
      throw new Error(lastError);
    }
  }

  async function listMcpServers() {
    await assertEnabled("mcp");
    try {
      const response = await processManager.getClient().request("mcpServerStatus/list", {
        cursor: null,
        limit: 100,
        detail: "toolsAndAuthOnly"
      }, { timeoutMs: 20_000 });
      const seen = new Set();
      const servers = [];
      for (const server of Array.isArray(response?.data) ? response.data : []) {
        const name = safeText(server?.name, 160);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const tools = Array.from(new Set(Object.keys(server?.tools ?? {}).map((value) => safeText(value, 160)).filter(Boolean))).sort();
        const startup = startupStates.get(name);
        servers.push({
          id: name,
          name,
          type: "mcp-server",
          provider: "Codex App Server",
          status: startup?.state ?? "ready",
          error: startup?.error ?? null,
          auth: authLabel(server?.authStatus),
          toolCount: tools.length,
          tools,
          lastCheckedAt: new Date().toISOString()
        });
      }
      lastError = null;
      return { stability: "stable", data: servers, nextCursor: response?.nextCursor ?? null };
    } catch (cause) {
      lastError = safeText(cause?.safeMessage ?? cause?.message ?? "MCP no respondio.", 500);
      throw new Error(lastError);
    }
  }

  return {
    snapshot,
    listPlanModes,
    listSkills,
    listPlugins,
    listMcpServers,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeNotifications();
      unsubscribeLifecycle();
      listeners.clear();
      startupStates.clear();
    }
  };
}
