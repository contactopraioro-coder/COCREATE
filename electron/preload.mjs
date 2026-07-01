import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overlayBridge", {
  onState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("overlay:state", listener);
    return () => ipcRenderer.removeListener("overlay:state", listener);
  },
  toggleCollapse() {
    return ipcRenderer.invoke("overlay:collapse");
  },
  closeApp() {
    return ipcRenderer.invoke("overlay:close");
  }
});
