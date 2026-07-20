import { BrowserWindow, app } from "electron";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CODEX_AUTH_CHANNELS = require("../shared/codex-auth-ipc-channels.cjs");

// Strip a leading UTF-8 BOM (U+FEFF) that some editors persist into .env values.
// A BOM smuggled into an API key silently breaks every upstream call.
function clean(value) {
  return (value ?? "").replace(/﻿/g, "").trim();
}

function envApiKey() {
  return clean(process.env.OPENAI_API_KEY);
}

function maskKey(key) {
  const clean_ = clean(key);
  if (!clean_) return null;
  if (clean_.length <= 12) return `${clean_.slice(0, 3)}***`;
  return `${clean_.slice(0, 6)}***${clean_.slice(-4)}`;
}

/**
 * Registers the Codex authentication IPC surface.
 *
 * Auth is delegated entirely to the upstream Codex binary (`codex login ...`),
 * so OpenAI owns the credential handling; we only orchestrate which key is used
 * and surface the resulting state to the renderer.
 *
 * Key resolution: a user-provided custom key (persisted in userData) takes
 * precedence; otherwise the project's OPENAI_API_KEY from .env is used.
 */
export function registerCodexAuthIpcHandlers({ ipcMain, binary }) {
  const storePath = path.join(app.getPath("userData"), "codex-auth-store.json");

  const readStore = () => {
    try {
      return JSON.parse(readFileSync(storePath, "utf8"));
    } catch {
      return { customApiKey: null };
    }
  };

  const writeStore = (store) => {
    try {
      mkdirSync(path.dirname(storePath), { recursive: true });
      writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
    } catch (error) {
      console.error("[codex-auth] No pude persistir la key personalizada:", error);
    }
  };

  // Run the codex binary. Any `input` is written straight to stdin as UTF-8
  // (no shell pipe), which is what keeps the API key free of a BOM.
  const runCodex = (args, input) =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn(binary, args, { windowsHide: true });
      } catch (error) {
        resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error) });
        return;
      }
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        resolve({ code: -1, stdout, stderr: stderr || String(error?.message ?? error) });
      });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      if (typeof input === "string" && child.stdin) {
        child.stdin.write(input);
      }
      child.stdin?.end();
    });

  const readStatus = async () => {
    const store = readStore();
    const hasCustomKey = Boolean(clean(store.customApiKey));
    const hasEnvKey = Boolean(envApiKey());
    const { stdout, stderr } = await runCodex(["login", "status"]);
    const text = `${stdout}\n${stderr}`.trim();

    let method = "none";
    let authenticated = false;
    let keyPreview = null;

    if (/not logged in/i.test(text) || !text) {
      method = "none";
    } else if (/api key/i.test(text)) {
      method = "apikey";
      authenticated = true;
      const match = text.match(/sk-[^\s]+/i);
      keyPreview = match ? clean(match[0]) : maskKey(hasCustomKey ? store.customApiKey : envApiKey());
    } else if (/chatgpt/i.test(text)) {
      method = "chatgpt";
      authenticated = true;
    }

    let source = "none";
    if (method === "apikey") source = hasCustomKey ? "custom" : "env";
    else if (method === "chatgpt") source = "chatgpt";

    return { authenticated, method, source, hasCustomKey, hasEnvKey, keyPreview };
  };

  const broadcast = (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(CODEX_AUTH_CHANNELS.changed, status);
      }
    }
  };

  const loginWithKey = async (key) => {
    const value = clean(key);
    if (!value) {
      throw new Error("No hay ninguna API key disponible (ni personalizada ni en el .env).");
    }
    const { code, stderr } = await runCodex(["login", "--with-api-key"], value);
    if (code !== 0) {
      throw new Error(clean(stderr) || "Codex rechazó la API key.");
    }
  };

  // Ensures Codex is authenticated on startup using the resolved key so the
  // project's .env key is the zero-config default. Best-effort, never fatal.
  const ensureDefaultLogin = async () => {
    try {
      const status = await readStatus();
      if (status.authenticated) return;
      const store = readStore();
      const key = clean(store.customApiKey) || envApiKey();
      if (key) {
        await loginWithKey(key);
        broadcast(await readStatus());
      }
    } catch (error) {
      console.error("[codex-auth] Auto-login inicial falló:", error?.message ?? error);
    }
  };

  ipcMain.handle(CODEX_AUTH_CHANNELS.status, async () => readStatus());

  ipcMain.handle(CODEX_AUTH_CHANNELS.loginApiKey, async (_event, payload) => {
    const provided = clean(payload?.apiKey);
    const store = readStore();
    if (provided) {
      // A custom key was entered: persist it and make it the active credential.
      store.customApiKey = provided;
      writeStore(store);
      await loginWithKey(provided);
    } else {
      // Empty submission means "use the project default" (the .env key).
      await loginWithKey(envApiKey());
    }
    const status = await readStatus();
    broadcast(status);
    return status;
  });

  ipcMain.handle(CODEX_AUTH_CHANNELS.useDefault, async () => {
    const store = readStore();
    store.customApiKey = null;
    writeStore(store);
    const key = envApiKey();
    if (key) {
      await loginWithKey(key);
    } else {
      await runCodex(["logout"]);
    }
    const status = await readStatus();
    broadcast(status);
    return status;
  });

  ipcMain.handle(CODEX_AUTH_CHANNELS.loginChatgpt, async () => {
    // `codex login` (no subcommand) runs the ChatGPT OAuth flow and opens the
    // user's browser. It resolves once the flow completes; we cap the wait.
    const result = await Promise.race([
      runCodex(["login"]),
      new Promise((resolve) => setTimeout(() => resolve({ code: -2, stdout: "", stderr: "timeout" }), 180_000))
    ]);
    const status = await readStatus();
    broadcast(status);
    if (!status.authenticated && result.code !== 0) {
      throw new Error(clean(result.stderr) || "No se completó el inicio de sesión con ChatGPT.");
    }
    return status;
  });

  ipcMain.handle(CODEX_AUTH_CHANNELS.logout, async () => {
    const store = readStore();
    store.customApiKey = null;
    writeStore(store);
    await runCodex(["logout"]);
    const status = await readStatus();
    broadcast(status);
    return status;
  });

  void ensureDefaultLogin();

  return () => {
    ipcMain.removeHandler(CODEX_AUTH_CHANNELS.status);
    ipcMain.removeHandler(CODEX_AUTH_CHANNELS.loginApiKey);
    ipcMain.removeHandler(CODEX_AUTH_CHANNELS.useDefault);
    ipcMain.removeHandler(CODEX_AUTH_CHANNELS.loginChatgpt);
    ipcMain.removeHandler(CODEX_AUTH_CHANNELS.logout);
  };
}
