export function registerIdentityIpcHandlers({ ipcMain, identityRuntime }) {
  ipcMain.handle("identity:get-bootstrap", async () => identityRuntime.getSnapshot());
  ipcMain.handle("identity:update-profile", async (_event, payload) => identityRuntime.updateUserProfile(payload ?? {}));
  ipcMain.handle("identity:prepare-link", async (_event, payload) => identityRuntime.prepareAccountLink(payload ?? {}));

  return () => {
    ipcMain.removeHandler("identity:get-bootstrap");
    ipcMain.removeHandler("identity:update-profile");
    ipcMain.removeHandler("identity:prepare-link");
  };
}
