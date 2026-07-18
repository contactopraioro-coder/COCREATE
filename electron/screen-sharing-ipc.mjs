import { shell, systemPreferences } from "electron";

const permissionChannel = "cocreate:screen-sharing:permission";
const settingsChannel = "cocreate:screen-sharing:open-settings";

function permissionStatus() {
  if (process.platform !== "darwin") return "unknown";
  const status = systemPreferences.getMediaAccessStatus("screen");
  return ["granted", "denied", "not-determined", "restricted"].includes(status) ? status : "unknown";
}

export function registerScreenSharingIpc({ ipcMain }) {
  ipcMain.handle(permissionChannel, () => permissionStatus());
  ipcMain.handle(settingsChannel, async () => {
    if (process.platform !== "darwin") return false;
    await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    return true;
  });
  return () => {
    ipcMain.removeHandler(permissionChannel);
    ipcMain.removeHandler(settingsChannel);
  };
}
