import { lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const ATTACHMENT_IPC_CHANNELS = Object.freeze({
  select: "cocreate:attachments:select",
  prepareDropped: "cocreate:attachments:prepare-dropped",
  release: "cocreate:attachments:release"
});

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const allowedExtensions = new Set([
  ...imageExtensions,
  ".txt", ".md", ".json", ".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".yml", ".yaml", ".toml", ".py", ".rs", ".go", ".java", ".swift", ".kt", ".sh"
]);
const maxFileSize = 20 * 1024 * 1024;
const tokenTtlMs = 30 * 60 * 1_000;

export function createAttachmentBroker({ ipcMain, dialog, browserWindow }) {
  const entries = new Map();
  const ownerHooks = new Map();

  const prune = () => {
    const timestamp = Date.now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(token);
    }
  };

  const cleanupOwner = (ownerWindowId) => {
    for (const [token, entry] of entries) {
      if (entry.ownerWindowId === ownerWindowId) entries.delete(token);
    }
  };

  const ownerFor = (event) => {
    const ownerWindow = browserWindow?.fromWebContents(event.sender);
    if (!ownerWindow) throw new Error("No pude resolver la ventana para seleccionar adjuntos.");
    if (!ownerHooks.has(ownerWindow.id) && typeof event.sender?.once === "function") {
      const cleanup = () => {
        cleanupOwner(ownerWindow.id);
        ownerHooks.delete(ownerWindow.id);
      };
      event.sender.once("destroyed", cleanup);
      ownerHooks.set(ownerWindow.id, () => event.sender.removeListener?.("destroyed", cleanup));
    }
    return ownerWindow;
  };

  const preparePaths = async (ownerWindow, filePaths) => {
    prune();
    const attachments = [];
    const seen = new Set();
    for (const rawPath of Array.isArray(filePaths) ? filePaths.slice(0, 16) : []) {
      if (typeof rawPath !== "string" || !rawPath.trim()) continue;
      const filePath = path.resolve(rawPath);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      try {
        const details = await lstat(filePath);
        if (details.isSymbolicLink()) continue;
        const extension = path.extname(filePath).toLowerCase();
        if (!details.isDirectory() && (!allowedExtensions.has(extension) || details.size === 0 || details.size > maxFileSize)) continue;
        const token = randomUUID();
        const kind = details.isDirectory() ? "folder" : imageExtensions.has(extension) ? "image" : "file";
        entries.set(token, {
          ownerWindowId: ownerWindow.id,
          filePath,
          kind,
          name: path.basename(filePath),
          expiresAt: Date.now() + tokenTtlMs
        });
        attachments.push({ token, name: path.basename(filePath), kind, size: details.size, type: extension || "folder" });
        if (attachments.length >= 8) break;
      } catch {
        continue;
      }
    }
    return attachments;
  };

  ipcMain.handle(ATTACHMENT_IPC_CHANNELS.select, async (event, payload = {}) => {
    const ownerWindow = ownerFor(event);
    const directory = payload.kind === "folder";
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: directory ? "Seleccionar carpeta como contexto" : "Adjuntar archivos a Codex",
      properties: directory ? ["openDirectory"] : ["openFile", "multiSelections"],
      ...(directory ? {} : { filters: [{ name: "Archivos de proyecto e imágenes", extensions: Array.from(allowedExtensions, (value) => value.slice(1)) }] })
    });
    if (result.canceled) return [];

    return preparePaths(ownerWindow, result.filePaths);
  });

  ipcMain.handle(ATTACHMENT_IPC_CHANNELS.prepareDropped, async (event, payload = {}) => {
    return preparePaths(ownerFor(event), payload.paths);
  });

  ipcMain.handle(ATTACHMENT_IPC_CHANNELS.release, (event, payload = {}) => {
    const ownerWindow = ownerFor(event);
    let released = 0;
    for (const token of Array.isArray(payload.tokens) ? payload.tokens.slice(0, 8) : []) {
      const entry = entries.get(token);
      if (entry?.ownerWindowId === ownerWindow.id) {
        entries.delete(token);
        released += 1;
      }
    }
    return { ok: true, released };
  });

  return {
    resolve(tokens, ownerWindowId) {
      prune();
      return (Array.isArray(tokens) ? tokens : []).slice(0, 8).flatMap((token) => {
        const entry = entries.get(token);
        if (!entry || entry.ownerWindowId !== ownerWindowId) return [];
        entries.delete(token);
        return entry.kind === "image"
          ? [{ type: "localImage", path: entry.filePath }]
          : [{ type: "mention", name: entry.name, path: entry.filePath }];
      });
    },
    dispose() {
      ipcMain.removeHandler(ATTACHMENT_IPC_CHANNELS.select);
      ipcMain.removeHandler(ATTACHMENT_IPC_CHANNELS.prepareDropped);
      ipcMain.removeHandler(ATTACHMENT_IPC_CHANNELS.release);
      for (const cleanup of ownerHooks.values()) cleanup();
      ownerHooks.clear();
      entries.clear();
    }
  };
}
