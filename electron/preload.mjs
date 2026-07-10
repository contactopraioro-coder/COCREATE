import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overlayBridge", {
  getConfig() {
    return ipcRenderer.invoke("app:get-config");
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
