import "dotenv/config";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rendererUrl = process.env.ELECTRON_RENDERER_URL;

const targetAppName = process.env.TARGET_APP_NAME ?? "Codex";
const sidebarWidth = Number(process.env.SIDEBAR_WIDTH ?? 392);
const sidebarRightMargin = Number(process.env.SIDEBAR_RIGHT_MARGIN ?? 14);
const sidebarTopMargin = Number(process.env.SIDEBAR_TOP_MARGIN ?? 52);
const sidebarBottomMargin = Number(process.env.SIDEBAR_BOTTOM_MARGIN ?? 18);
const sidebarPollMs = Number(process.env.SIDEBAR_POLL_MS ?? 120);
const collapsedWidth = 132;

let overlayWindow = null;
let syncTimer = null;
let lastVisibilityState = "detached";
let lastOverlaySignature = "";
let isCollapsed = false;
let targetWindowState = null;
let trackerProcess = null;

function fallbackBounds() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const currentWidth = isCollapsed ? collapsedWidth : sidebarWidth;
  return {
    x: Math.round(primaryDisplay.workArea.x + primaryDisplay.workArea.width - currentWidth - 40),
    y: Math.round(primaryDisplay.workArea.y + 100),
    width: currentWidth,
    height: 760
  };
}

function emitOverlayState(payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send("overlay:state", payload);
}

async function readTargetWindowBounds() {
  const script = `
    tell application "System Events"
      if not (exists process "${targetAppName}") then
        return "APP_MISSING"
      end if

      tell process "${targetAppName}"
        if (count of windows) is 0 then
          return "WINDOW_MISSING"
        end if

        set frontWindow to window 1
        set isFrontmost to frontmost
        set {xPos, yPos} to position of frontWindow
        set {winWidth, winHeight} to size of frontWindow
        set isMinimized to value of attribute "AXMinimized" of attribute "AXMainWindow" of application process "${targetAppName}"
        return (xPos as text) & "," & (yPos as text) & "," & (winWidth as text) & "," & (winHeight as text) & "," & (isFrontmost as text) & "," & (isMinimized as text)
      end tell
    end tell
  `;

  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const output = stdout.trim();

  if (output === "APP_MISSING" || output === "WINDOW_MISSING") {
    return null;
  }

  const [rawX, rawY, rawWidth, rawHeight, rawFrontmost, rawMinimized] = output
    .split(",")
    .map((value) => value.trim());
  const [x, y, width, height] = [rawX, rawY, rawWidth, rawHeight].map((value) =>
    Number(value)
  );
  if ([x, y, width, height].some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    isFrontmost: rawFrontmost === "true",
    isMinimized: rawMinimized === "true"
  };
}

function startNativeTracker() {
  const trackerPath = path.join(__dirname, "window_tracker.swift");
  trackerProcess = spawn("swift", [trackerPath, targetAppName], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const lines = readline.createInterface({ input: trackerProcess.stdout });
  lines.on("line", (line) => {
    try {
      const payload = JSON.parse(line);
      targetWindowState = payload;
    } catch {
      targetWindowState = null;
    }
  });

  trackerProcess.stderr.on("data", () => {
    // Keep the app running even if the tracker logs warnings.
  });

  trackerProcess.on("exit", () => {
    trackerProcess = null;
    targetWindowState = null;
  });
}

function currentTrackedBounds() {
  if (!targetWindowState?.found) {
    return null;
  }

  return {
    x: targetWindowState.x,
    y: targetWindowState.y,
    width: targetWindowState.width,
    height: targetWindowState.height,
    isFrontmost: targetWindowState.isFrontmost,
    isMinimized: targetWindowState.isMinimized
  };
}

function computeOverlayBounds(targetBounds) {
  const display = screen.getDisplayNearestPoint({
    x: targetBounds.x,
    y: targetBounds.y
  });
  const visibleArea = display.workArea;

  const width = isCollapsed ? collapsedWidth : sidebarWidth;
  const height = Math.max(360, targetBounds.height - sidebarTopMargin - sidebarBottomMargin);
  const x = Math.round(targetBounds.x + targetBounds.width - width - sidebarRightMargin);
  const y = Math.round(targetBounds.y + sidebarTopMargin);

  return {
    x: Math.max(visibleArea.x, x),
    y: Math.max(visibleArea.y, y),
    width,
    height
  };
}

async function syncOverlayToTarget() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  try {
    const targetBounds = currentTrackedBounds() ?? (await readTargetWindowBounds());
    if (!targetBounds) {
      overlayWindow.hide();
      lastOverlaySignature = "";
      if (lastVisibilityState !== "detached") {
        emitOverlayState({
          attached: false,
          appName: targetAppName,
          boundsLabel: "sin ventana",
          message:
            "No encuentro una ventana activa de Codex. Abrela y da permiso de Accessibility a Electron."
        });
        lastVisibilityState = "detached";
      }
      return;
    }

    const overlayOwnsFocus = overlayWindow.isFocused();
    if (targetBounds.isMinimized || (!targetBounds.isFrontmost && !overlayOwnsFocus)) {
      overlayWindow.hide();
      lastOverlaySignature = "";
      if (lastVisibilityState !== "detached") {
        emitOverlayState({
          attached: false,
          appName: targetAppName,
          boundsLabel: `${targetBounds.x}, ${targetBounds.y} · ${targetBounds.width}x${targetBounds.height}`,
          message: `Overlay en pausa mientras ${targetAppName} no este al frente.`
        });
        lastVisibilityState = "detached";
      }
      return;
    }

    const nextBounds = computeOverlayBounds(targetBounds);
    const nextSignature = `${nextBounds.x}:${nextBounds.y}:${nextBounds.width}:${nextBounds.height}`;
    if (nextSignature !== lastOverlaySignature) {
      overlayWindow.setBounds(nextBounds, false);
      lastOverlaySignature = nextSignature;
    }
    if (!overlayWindow.isVisible()) {
      overlayWindow.showInactive();
    }
    overlayWindow.moveTop();
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    emitOverlayState({
      attached: true,
      appName: targetAppName,
      boundsLabel: `${targetBounds.x}, ${targetBounds.y} · ${targetBounds.width}x${targetBounds.height}`,
      message: "Overlay ligado a la ventana de Codex."
    });
    lastVisibilityState = "attached";
  } catch {
    overlayWindow.setBounds(fallbackBounds(), false);
    overlayWindow.showInactive();
    lastOverlaySignature = "";
    emitOverlayState({
      attached: false,
      appName: targetAppName,
      boundsLabel: "permiso pendiente",
      message:
        "No pude leer la posicion de Codex. En macOS activa Accessibility para esta app en Privacy & Security."
    });
    lastVisibilityState = "detached";
  }
}

async function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: sidebarWidth,
    height: 760,
    x: 80,
    y: 80,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: true,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    roundedCorners: false,
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setFullScreenable(false);
  overlayWindow.setFocusable(true);

  if (rendererUrl) {
    await overlayWindow.loadURL(rendererUrl);
  } else {
    await overlayWindow.loadFile(path.join(rootDir, "overlay-dist", "overlay.html"));
  }

  startNativeTracker();
  await syncOverlayToTarget();
  syncTimer = setInterval(syncOverlayToTarget, sidebarPollMs);
}

ipcMain.handle("overlay:collapse", async () => {
  isCollapsed = !isCollapsed;
  lastOverlaySignature = "";
  await syncOverlayToTarget();
  return { collapsed: isCollapsed };
});

ipcMain.handle("overlay:close", () => {
  app.quit();
});

app.whenReady().then(createOverlayWindow);

app.on("window-all-closed", () => {
  if (syncTimer) {
    clearInterval(syncTimer);
  }
  if (trackerProcess) {
    trackerProcess.kill();
  }
  app.quit();
});
