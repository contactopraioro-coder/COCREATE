import { BrowserWindow } from "electron";

export async function createMainWindow({
  rendererUrl,
  distIndexPath,
  preloadPath,
  show = true
}) {
  const mainWindow = new BrowserWindow({
    show,
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 700,
    title: "CoCreate",
    backgroundColor: "#f7f7f5",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    visualEffectState: "active",
    webPreferences: {
      preload: preloadPath,
      // The desktop preload imports shared runtime modules from the packaged app bundle.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(distIndexPath);
  }

  return mainWindow;
}
