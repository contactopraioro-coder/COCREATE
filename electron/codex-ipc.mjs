import { BrowserWindow } from "electron";
import { CODEX_IPC_CHANNELS, assertCancelCodexExecutionRequest, assertStartCodexExecutionRequest } from "../shared/codex-ipc.js";

export function registerCodexIpcHandlers({
  ipcMain,
  codexAdapter,
  onExecutionEvent,
  onStatusResolved,
  resolveExecutionContext,
  resolveAttachments,
  resolveSkills,
  resolveProposalWorkspace
}) {
  const executionOwners = new Map();
  const cleanupWindowHooks = new Map();

  const sendToWindow = (windowId, event) => {
    const window = BrowserWindow.fromId(windowId);
    if (window && !window.isDestroyed()) {
      window.webContents.send(CODEX_IPC_CHANNELS.events, event);
    }
  };

  const broadcastEvent = (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(CODEX_IPC_CHANNELS.events, event);
      }
    }
  };

  const detachWindowCleanup = (windowId) => {
    const cleanup = cleanupWindowHooks.get(windowId);
    if (cleanup) {
      cleanup();
      cleanupWindowHooks.delete(windowId);
    }
  };

  const attachWindowCleanup = (windowId, webContents) => {
    if (cleanupWindowHooks.has(windowId)) {
      return;
    }

    const onDestroyed = async () => {
      detachWindowCleanup(windowId);
      const ownedExecutions = Array.from(executionOwners.entries())
        .filter(([, ownerWindowId]) => ownerWindowId === windowId)
        .map(([executionId]) => executionId);

      for (const executionId of ownedExecutions) {
        executionOwners.delete(executionId);
        await codexAdapter.cancelExecution({
          executionId,
          reason: "window-destroyed"
        }).catch(() => undefined);
      }
    };

    webContents.once("destroyed", onDestroyed);
    cleanupWindowHooks.set(windowId, () => {
      webContents.removeListener("destroyed", onDestroyed);
    });
  };

  const emitStatusChanged = async () => {
    const status = await codexAdapter.getStatus();
    const event = {
      type: "codex.statusChanged",
      timestamp: new Date().toISOString(),
      status
    };
    broadcastEvent(event);
    await onStatusResolved?.(status);
    return status;
  };

  ipcMain.handle(CODEX_IPC_CHANNELS.getStatus, async () => {
    return emitStatusChanged();
  });

  ipcMain.handle(CODEX_IPC_CHANNELS.listModels, async () => {
    if (typeof codexAdapter.listModels !== "function") return { data: [], unavailableReason: "Model discovery no está disponible." };
    return codexAdapter.listModels();
  });

  ipcMain.handle(CODEX_IPC_CHANNELS.execute, async (event, payload) => {
    assertStartCodexExecutionRequest(payload);
    const ownerWindowId = BrowserWindow.fromWebContents(event.sender)?.id;
    if (!ownerWindowId) {
      throw new Error("No pude resolver la ventana propietaria de la ejecución.");
    }

    attachWindowCleanup(ownerWindowId, event.sender);

    const workspaceContext = await resolveExecutionContext?.();
    const proposalWorkspaceId = typeof payload.metadata?.proposalWorkspaceId === "string"
      ? payload.metadata.proposalWorkspaceId
      : null;
    const proposalWorkspace = proposalWorkspaceId
      ? await resolveProposalWorkspace?.(proposalWorkspaceId, ownerWindowId)
      : null;
    if (proposalWorkspaceId && !proposalWorkspace) {
      throw new Error("El Proposal Workspace solicitado no está disponible.");
    }
    const executionContext = proposalWorkspace
      ? {
          ...(workspaceContext ?? {}),
          rootPath: proposalWorkspace.rootPath,
          codexThreadId: null,
          proposalWorkspaceId: proposalWorkspace.id,
          proposalWorkspace: true
        }
      : workspaceContext;
    const upstreamInputs = [
      ...(resolveAttachments?.(payload.metadata?.attachmentTokens, ownerWindowId) ?? []),
      ...(resolveSkills?.(payload.metadata?.skillTokens, ownerWindowId) ?? [])
    ];
    const enrichedPayload = {
      ...payload,
      cwd: proposalWorkspace?.rootPath ?? workspaceContext?.rootPath ?? undefined,
      ownerId: String(ownerWindowId),
      metadata: {
        ...(payload.metadata ?? {}),
        interactionMode: proposalWorkspace ? "proposal" : payload.metadata?.interactionMode,
        workspaceContext: executionContext ?? null,
        upstreamInputs
      }
    };

    const handle = await codexAdapter.execute(
      enrichedPayload,
      async (executionEvent) => {
        sendToWindow(ownerWindowId, executionEvent);
        await onExecutionEvent?.(executionEvent, enrichedPayload);
        if (
          executionEvent.type === "execution.completed" ||
          executionEvent.type === "execution.cancelled" ||
          executionEvent.type === "execution.failed"
        ) {
          executionOwners.delete(executionEvent.executionId);
          await emitStatusChanged();
        }
      }
    );

    executionOwners.set(handle.executionId, ownerWindowId);
    return {
      ok: true,
      executionId: handle.executionId
    };
  });

  ipcMain.handle(CODEX_IPC_CHANNELS.cancel, async (event, payload) => {
    assertCancelCodexExecutionRequest(payload);
    const ownerWindowId = executionOwners.get(payload.executionId);
    const requestWindowId = BrowserWindow.fromWebContents(event.sender)?.id ?? null;

    if (ownerWindowId && requestWindowId && ownerWindowId !== requestWindowId) {
      throw new Error("La ejecución no pertenece a esta ventana.");
    }

    return codexAdapter.cancelExecution(payload);
  });

  return () => {
    ipcMain.removeHandler(CODEX_IPC_CHANNELS.getStatus);
    ipcMain.removeHandler(CODEX_IPC_CHANNELS.listModels);
    ipcMain.removeHandler(CODEX_IPC_CHANNELS.execute);
    ipcMain.removeHandler(CODEX_IPC_CHANNELS.cancel);
    for (const windowId of cleanupWindowHooks.keys()) {
      detachWindowCleanup(windowId);
    }
    executionOwners.clear();
  };
}
