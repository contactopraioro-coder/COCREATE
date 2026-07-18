import { resolveCodexRuntimeMode } from "../../shared/codex-upstream-contracts.js";

export function createCodexRuntimeAdapter(options = {}) {
  if (!options.appServerAdapter || !options.execAdapter) {
    throw new TypeError("Codex runtime selector requires app-server and exec adapters.");
  }
  const configuredMode = resolveCodexRuntimeMode(options.mode ?? process.env.CODEX_RUNTIME_MODE);
  const owners = new Map();
  let fallback = null;

  const selected = configuredMode === "exec" ? options.execAdapter : options.appServerAdapter;

  async function getStatus() {
    if (configuredMode === "exec") {
      const status = await options.execAdapter.getStatus();
      return { ...status, runtimeMode: "exec", configuredMode, fallback: null };
    }
    const appStatus = await options.appServerAdapter.getStatus();
    if (configuredMode === "app-server" || appStatus.available) {
      return { ...appStatus, runtimeMode: "app-server", configuredMode, fallback };
    }
    const execStatus = await options.execAdapter.getStatus();
    return {
      ...execStatus,
      runtimeMode: "exec",
      configuredMode,
      fallback: {
        active: true,
        reason: appStatus.error ?? "Codex App Server is unavailable.",
        selectedAt: new Date().toISOString()
      },
      appServer: appStatus.appServer ?? null
    };
  }

  async function execute(request, observer) {
    let adapter = selected;
    if (configuredMode === "auto") {
      const status = await options.appServerAdapter.getStatus();
      if (!status.available) {
        adapter = options.execAdapter;
        fallback = {
          active: true,
          reason: status.error ?? "Codex App Server is unavailable.",
          selectedAt: new Date().toISOString()
        };
      } else {
        fallback = null;
      }
    }
    const handle = await adapter.execute(request, observer);
    owners.set(handle.executionId, adapter);
    void handle.completed.finally(() => owners.delete(handle.executionId));
    return handle;
  }

  async function cancelExecution(request) {
    const adapter = owners.get(request.executionId) ?? selected;
    return adapter.cancelExecution(request);
  }

  async function dispose() {
    await Promise.allSettled([options.appServerAdapter.dispose(), options.execAdapter.dispose()]);
    owners.clear();
  }

  async function listModels() {
    const status = await options.appServerAdapter.getStatus();
    if (!status.available || typeof options.appServerAdapter.listModels !== "function") {
      return { data: [], unavailableReason: status.error ?? "Codex App Server no está disponible." };
    }
    return options.appServerAdapter.listModels();
  }

  return { getStatus, execute, cancelExecution, listModels, dispose };
}
