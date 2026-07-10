import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overlayBridge", {
  getConfig() {
    return ipcRenderer.invoke("app:get-config");
  },
  getAppState() {
    return ipcRenderer.invoke("app-state:get");
  },
  saveRendererState(payload) {
    return ipcRenderer.invoke("app-state:save-renderer", payload);
  },
  appendAppEvent(payload) {
    return ipcRenderer.invoke("app-state:append-event", payload);
  },
  getCodexStatus() {
    return ipcRenderer.invoke("codex:status");
  },
  runCodex(payload) {
    return ipcRenderer.invoke("codex:run", payload);
  },
  saveRecording(payload) {
    return ipcRenderer.invoke("recording:save", payload);
  },
  analyzeRecording(payload) {
    return ipcRenderer.invoke("analysis:run", payload);
  },
  copyText(value) {
    return ipcRenderer.invoke("clipboard:write-text", value);
  },
  closeApp() {
    return ipcRenderer.invoke("app:close");
  }
});
