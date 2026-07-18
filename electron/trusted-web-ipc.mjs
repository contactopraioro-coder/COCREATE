import { BrowserWindow } from "electron";

import { normalizeProviderError } from "../shared/provider-runtime.js";
import {
  TRUSTED_WEB_IPC_CHANNELS,
  assertTrustedWebCancelRequest,
  assertTrustedWebExecuteRequest
} from "../shared/trusted-web-ipc.js";

export function registerTrustedWebIpcHandlers({ ipcMain, providerRuntime, onExecutionEvent }) {
  const executions = new Map();
  const cleanupHooks = new Map();

  function detachWindowCleanup(windowId) {
    const cleanup = cleanupHooks.get(windowId);
    cleanup?.();
    cleanupHooks.delete(windowId);
  }

  function attachWindowCleanup(windowId, webContents) {
    if (cleanupHooks.has(windowId)) return;
    const onDestroyed = () => {
      detachWindowCleanup(windowId);
      for (const [requestId, execution] of executions) {
        if (execution.ownerWindowId === windowId) {
          execution.controller.abort("window-destroyed");
          executions.delete(requestId);
        }
      }
    };
    webContents.once("destroyed", onDestroyed);
    cleanupHooks.set(windowId, () => webContents.removeListener("destroyed", onDestroyed));
  }

  ipcMain.handle(TRUSTED_WEB_IPC_CHANNELS.getStatus, async () => {
    const providers = await providerRuntime.getProviders();
    return providers.find((provider) => provider.id === "web-tool")?.health ?? {
      status: "Unavailable",
      message: "Trusted Web Tool no esta registrado."
    };
  });

  ipcMain.handle(TRUSTED_WEB_IPC_CHANNELS.execute, async (event, payload) => {
    assertTrustedWebExecuteRequest(payload);
    const ownerWindowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (!ownerWindowId) throw new Error("No pude resolver la ventana propietaria de Trusted Web.");
    if (executions.has(payload.requestId)) throw new Error("requestId de Trusted Web duplicado.");
    attachWindowCleanup(ownerWindowId, event.sender);
    const controller = new AbortController();
    executions.set(payload.requestId, { ownerWindowId, controller });
    const startedAt = new Date().toISOString();
    await onExecutionEvent?.({
      type: "web.execution.started",
      requestId: payload.requestId,
      timestamp: startedAt,
      queryPreview: payload.input.query.slice(0, 180)
    });
    try {
      const result = await providerRuntime.execute({
        capability: "web",
        operation: "search",
        requestId: payload.requestId,
        signal: controller.signal,
        input: payload.input,
        metadata: { intent: payload.input.intent ?? "current-information", tool: "TrustedWebTool" }
      });
      await onExecutionEvent?.({
        type: "web.execution.completed",
        requestId: payload.requestId,
        timestamp: new Date().toISOString(),
        startedAt,
        provider: result.value?.provider ?? "web-tool",
        sourcesCount: result.value?.sources?.length ?? 0,
        verifiedAt: result.value?.verifiedAt ?? null,
        confidence: result.value?.confidence ?? "Unavailable"
      });
      return {
        ok: true,
        result: {
          output: result.output,
          value: result.value,
          model: result.model ?? null,
          metadata: result.metadata ?? null
        }
      };
    } catch (cause) {
      const error = normalizeProviderError(cause, { provider: "web-tool", requestId: payload.requestId });
      const cancelled = controller.signal.aborted || error.code === "WEB_CANCELLED";
      await onExecutionEvent?.({
        type: cancelled ? "web.execution.cancelled" : "web.execution.failed",
        requestId: payload.requestId,
        timestamp: new Date().toISOString(),
        startedAt,
        provider: error.provider,
        confidence: "Unavailable",
        error: { code: error.code, safeMessage: error.safeMessage }
      });
      return { ok: false, error };
    } finally {
      executions.delete(payload.requestId);
    }
  });

  ipcMain.handle(TRUSTED_WEB_IPC_CHANNELS.cancel, async (event, payload) => {
    assertTrustedWebCancelRequest(payload);
    const execution = executions.get(payload.requestId);
    if (!execution) return { ok: true, requestId: payload.requestId, alreadyTerminated: true };
    const requestWindowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (!requestWindowId || execution.ownerWindowId !== requestWindowId) {
      throw new Error("La consulta web no pertenece a esta ventana.");
    }
    execution.controller.abort(payload.reason ?? "renderer-cancelled");
    return { ok: true, requestId: payload.requestId, alreadyTerminated: false };
  });

  return () => {
    ipcMain.removeHandler(TRUSTED_WEB_IPC_CHANNELS.getStatus);
    ipcMain.removeHandler(TRUSTED_WEB_IPC_CHANNELS.execute);
    ipcMain.removeHandler(TRUSTED_WEB_IPC_CHANNELS.cancel);
    for (const execution of executions.values()) execution.controller.abort("runtime-disposed");
    executions.clear();
    for (const windowId of cleanupHooks.keys()) detachWindowCleanup(windowId);
  };
}
