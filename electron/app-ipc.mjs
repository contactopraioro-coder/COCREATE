export function registerAppIpcHandlers({
  ipcMain,
  app,
  clipboard,
  featureFlags,
  getConfig,
  appStateStore,
  foundationStore,
  analysisService
}) {
  ipcMain.handle("app:get-config", async () => {
    return getConfig();
  });

  ipcMain.handle("app-state:get", async () => {
    const state = await appStateStore.load();
    const session = appStateStore.ensureActiveSession(state);
    await appStateStore.save(state);
    return {
      state,
      session,
      featureFlags
    };
  });

  ipcMain.handle("app-state:save-renderer", async (_event, payload) => {
    const result = await appStateStore.update(async (state, session) => {
      const title = payload?.title;
      if (typeof title === "string" && title.trim()) {
        session.title = title.trim().slice(0, 120);
      }

      session.renderer = {
        ...session.renderer,
        workbench: payload?.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null
      };
      appStateStore.appendSessionEvent(session, {
        type: "renderer.snapshot.saved",
        source: "renderer",
        payload: {
          mode: payload?.snapshot?.activeMode ?? null
        }
      });
      state.activeSessionId = session.id;
    });

    await foundationStore.updatePreferencesFromSnapshot(payload?.snapshot ?? null);

    return {
      ok: true,
      sessionId: result.session?.id ?? null,
      updatedAt: result.state.updatedAt
    };
  });

  ipcMain.handle("app-state:append-event", async (_event, payload) => {
    const result = await appStateStore.update(async (_state, session) => {
      appStateStore.appendSessionEvent(session, payload);
    });

    return {
      ok: true,
      sessionId: result.session?.id ?? null
    };
  });

  ipcMain.handle("recording:save", async (_event, payload) => analysisService.saveRecording(payload));
  ipcMain.handle("analysis:run", async (_event, payload) => analysisService.analyzeRecording(payload));

  ipcMain.handle("clipboard:write-text", async (_event, value) => {
    clipboard.writeText(typeof value === "string" ? value : "");
    return { ok: true };
  });

  ipcMain.handle("app:close", () => {
    app.quit();
  });

  return () => {
    ipcMain.removeHandler("app:get-config");
    ipcMain.removeHandler("app-state:get");
    ipcMain.removeHandler("app-state:save-renderer");
    ipcMain.removeHandler("app-state:append-event");
    ipcMain.removeHandler("recording:save");
    ipcMain.removeHandler("analysis:run");
    ipcMain.removeHandler("clipboard:write-text");
    ipcMain.removeHandler("app:close");
  };
}
