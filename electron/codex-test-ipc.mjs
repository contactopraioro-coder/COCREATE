import { BrowserWindow, shell, app } from "electron";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat, cp, mkdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectTaskBoundary } from "./live-organizer-ipc.mjs";

const LIVE_PRELOAD_PATH = fileURLToPath(new URL("./probe-live-preload.cjs", import.meta.url));

function buildLivePrompt(improvement, cursorContext, isFollowUp) {
  const parts = [improvement.body];
  if (cursorContext) parts.push(`\n\nContexto visual: el usuario señalaba ${cursorContext}.`);
  if (isFollowUp) parts.push("\n\n(Es un ajuste sobre un cambio previo de esta misma sección; no rehagas lo demás.)");
  return parts.join("");
}

const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s"']*/i;
const DEV_SCRIPTS = ["dev", "start", "preview", "serve"];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function resolvePackageScript(root) {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const scripts = pkg?.scripts ?? {};
    return DEV_SCRIPTS.find((name) => typeof scripts[name] === "string") ?? null;
  } catch {
    return null;
  }
}

// Spawn the project's dev server and resolve with the URL it prints. Framework
// agnostic: watches stdout/stderr for the first localhost URL it announces.
function startDevServer(root, script, onProc) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", script], {
      cwd: root,
      shell: true,
      windowsHide: true,
      env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" }
    });
    onProc(child);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const scan = (chunk) => {
      const match = String(chunk).match(URL_PATTERN);
      if (match) finish(resolve, match[0].replace(/[).,]+$/, ""));
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (!settled) finish(reject, new Error(`El servidor de desarrollo terminó (código ${code}) antes de anunciar una URL.`));
    });
    const timer = setTimeout(
      () => finish(reject, new Error("El servidor de desarrollo no anunció una URL en 90s.")),
      90_000
    );
  });
}

// The split-view wrapper: left = frozen snapshot, right = live version.
const SPLIT_WRAPPER_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>CoCreate · Probar</title>
<style>
  html,body{margin:0;height:100%;background:#0b0b0f;overflow:hidden}
  .cc-split{display:flex;height:100vh;width:100vw}
  .cc-pane{flex:1;height:100%;position:relative}
  .cc-pane.left{border-right:1px solid rgba(255,255,255,0.14)}
  .cc-pane iframe{width:100%;height:100%;border:0;display:block;background:#fff}
  .cc-pane-label{position:absolute;top:10px;left:10px;z-index:5;font:600 11px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,0.55);padding:3px 10px;border-radius:999px;pointer-events:none}
</style></head>
<body>
  <div class="cc-split">
    <div class="cc-pane left"><span class="cc-pane-label">Original</span><iframe id="cc-left" src="/__snapshot__/"></iframe></div>
    <div class="cc-pane right"><span class="cc-pane-label">En edición</span><iframe id="cc-right" src="/"></iframe></div>
  </div>
</body></html>`;

// Static file server. Serves the live folder at "/", the frozen snapshot at
// "/__snapshot__/", and the split-view wrapper at "/__split__" — all same-origin
// so the Live preload can track the left pane.
function startStaticServer(root, snapshotDir) {
  const serveFile = (baseDir, relative, res) => {
    const resolved = path.join(baseDir, relative || "index.html");
    if (!resolved.startsWith(path.resolve(baseDir))) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    const stream = createReadStream(resolved);
    stream.on("error", () => res.writeHead(404).end("Not found"));
    stream.pipe(res);
  };
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
        if (requestPath === "/__split__" || requestPath === "/__split__/") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(SPLIT_WRAPPER_HTML);
          return;
        }
        if (requestPath.startsWith("/__snapshot__")) {
          const rel = requestPath.replace(/^\/__snapshot__\/?/, "") || "index.html";
          serveFile(snapshotDir || root, rel, res);
          return;
        }
        const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
        serveFile(root, relative, res);
      } catch {
        res.writeHead(500).end("Server error");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

/**
 * Registers the "Probar" (test) IPC: launches the developed web app and shows it
 * in a dedicated native window. If the window is already open it hard-reloads and
 * refocuses it. Reuses a single window and a single server across launches.
 */
export function registerCodexTestIpcHandlers({ ipcMain, resolveProjectRoot, runLiveCodex, organizer, deepgram }) {
  let testWindow = null;
  let devProc = null;
  let staticServer = null;
  let livePointer = null;
  let servedRoot = null;

  // ---- Live-coding session: ONE task at a time, ONE prompt per task ----
  // A task is anchored to the cursor point where the user began describing it
  // (the white dot). It stays in "recording" until an EXPLICIT boundary (or the
  // user clicks its checkmark), then runs as a single Codex prompt.
  // Live-coding tasks are scoped PER WORKSPACE (the served folder), so each app /
  // conversation shows only its own edit markers.
  const sessionsByRoot = new Map(); // root -> { tasks: Map, currentTaskId }
  const sess = (root = servedRoot) => {
    const key = root || "__none__";
    let s = sessionsByRoot.get(key);
    if (!s) {
      s = { tasks: new Map(), currentTaskId: null };
      sessionsByRoot.set(key, s);
    }
    return s;
  };
  let liveSeq = 0;
  const dispatchQueue = [];
  let dispatchRunning = false;

  const pushTasks = () => {
    if (testWindow && !testWindow.isDestroyed()) {
      testWindow.webContents.send("cocreate:live:tasks", { tasks: [...sess().tasks.values()] });
    }
  };

  const enqueueDispatch = (taskId) => {
    dispatchQueue.push({ root: servedRoot, id: taskId });
    void runDispatchQueue();
  };

  const runDispatchQueue = async () => {
    if (dispatchRunning) return;
    dispatchRunning = true;
    while (dispatchQueue.length) {
      const job = dispatchQueue.shift();
      const task = sess(job.root).tasks.get(job.id);
      if (!task || !task.prompt) continue;
      const onCurrent = () => job.root === servedRoot;
      task.status = "executing";
      task.progress = "Iniciando Codex…";
      if (onCurrent()) pushTasks();
      try {
        console.log("[Live:main] Codex RUN start in", job.root, "| prompt:", JSON.stringify(task.prompt.slice(0, 160)));
        const result = await runLiveCodex(task.prompt, job.root, (event) => {
          if (event?.type === "execution.progress" && typeof event.message === "string") {
            const m = /^codex\r?\n([\s\S]+)$/.exec(event.message);
            if (m && m[1].trim()) {
              task.progress = m[1].trim();
              if (onCurrent()) pushTasks();
            }
          }
        });
        console.log("[Live:main] Codex RUN done ok=", result?.ok);
        task.status = result?.ok ? "done" : "failed";
        task.summary = typeof result?.output === "string" ? result.output : "";
        task.progress = "";
        if (onCurrent()) {
          pushTasks();
          // Show the applied change. The preload reloads only the right pane in
          // split view (keeping the frozen snapshot + dots stable), or the whole
          // page in single view.
          if (testWindow && !testWindow.isDestroyed()) testWindow.webContents.send("cocreate:live:refresh");
        }
      } catch (error) {
        console.error("[Live:main] Codex RUN error:", error);
        task.status = "failed";
        task.summary = error instanceof Error ? error.message : "Falló la ejecución.";
        task.progress = "";
        if (onCurrent()) pushTasks();
      }
    }
    dispatchRunning = false;
  };

  const dispatchTask = (taskId) => {
    const s = sess();
    const task = s.tasks.get(taskId);
    if (!task || !task.prompt || task.status !== "recording") return;
    if (s.currentTaskId === taskId) s.currentTaskId = null;
    console.log("[Live:main] DISPATCH task", taskId, "| prompt:", JSON.stringify(task.prompt.slice(0, 160)));
    enqueueDispatch(taskId);
  };

  const stopServers = () => {
    if (devProc) {
      try {
        devProc.kill();
      } catch {
        /* ignore */
      }
      devProc = null;
    }
    if (staticServer) {
      try {
        staticServer.close();
      } catch {
        /* ignore */
      }
      staticServer = null;
    }
  };

  const showWindow = (url) => {
    if (testWindow && !testWindow.isDestroyed()) {
      testWindow.loadURL(url); // hard reload of the already-open window
      if (testWindow.isMinimized()) testWindow.restore();
      testWindow.focus();
      return;
    }
    testWindow = new BrowserWindow({
      width: 1100,
      height: 820,
      title: "CoCreate · Probar",
      backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      // The Live-coding "living surface": a preload injects cursor + real-DOM
      // tracking and the blur-halo feedback into the user's rendered app.
      webPreferences: { preload: LIVE_PRELOAD_PATH, sandbox: false, contextIsolation: true, nodeIntegration: false }
    });
    testWindow.on("closed", () => {
      testWindow = null;
    });
    // Repopulate the Live task markers after each (post-edit) reload.
    testWindow.webContents.on("did-finish-load", () => pushTasks());
    // Allow microphone for the in-window Live voice capture.
    testWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media" || permission === "audioCapture");
    });
    // Open DevTools for the Live surface so its console logs are visible while
    // we polish the interaction (this window is separate from the main app).
    testWindow.webContents.openDevTools({ mode: "detach" });
    testWindow.loadURL(url);
  };

  // Resolve which folder to serve. A `target` (a file or folder path Codex just
  // reported) wins, since the app is often created in a subfolder rather than the
  // project root; otherwise fall back to the project root.
  const resolveRoot = async (target) => {
    if (target) {
      const stats = await stat(target).catch(() => null);
      if (stats?.isFile()) return { root: path.dirname(target), entry: path.basename(target) };
      if (stats?.isDirectory()) return { root: target, entry: null };
    }
    const projectRoot = await resolveProjectRoot();
    return { root: projectRoot, entry: null };
  };

  ipcMain.handle("cocreate:test:launch", async (_event, payload) => {
    const target = typeof payload?.target === "string" && payload.target.trim() ? payload.target.trim() : null;
    const { root, entry } = await resolveRoot(target);
    if (!root) {
      throw new Error("No hay una carpeta de proyecto asociada para probar.");
    }
    servedRoot = root; // Codex Live edits run in the same folder we're serving.

    const script = await resolvePackageScript(root);
    if (script) {
      stopServers();
      const url = await startDevServer(root, script, (child) => {
        devProc = child;
      });
      showWindow(url);
      return { ok: true, url, mode: "dev-server", script };
    }

    const entryFile = entry ?? "index.html";
    if (await exists(path.join(root, entryFile))) {
      stopServers();
      // Snapshot the CURRENT state as the frozen "before" pane for split view.
      let snapshotDir = null;
      try {
        snapshotDir = path.join(
          app.getPath("userData"),
          "probe-snapshots",
          encodeURIComponent(root).replace(/[^a-z0-9]/gi, "_").slice(0, 80)
        );
        await rm(snapshotDir, { recursive: true, force: true });
        await mkdir(path.dirname(snapshotDir), { recursive: true });
        await cp(root, snapshotDir, {
          recursive: true,
          filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src)
        });
      } catch (error) {
        console.error("[Live] snapshot failed:", error?.message ?? error);
        snapshotDir = null;
      }
      const { server, url } = await startStaticServer(root, snapshotDir);
      staticServer = server;
      let finalUrl = entryFile === "index.html" ? url : `${url}${entryFile}`;
      if (snapshotDir) finalUrl += (finalUrl.includes("?") ? "&" : "?") + "__ccsplit=1";
      showWindow(finalUrl);
      return { ok: true, url: finalUrl, mode: "static", canSplit: Boolean(snapshotDir) };
    }

    throw new Error("No encontré una app web para probar (falta un script dev/start o un index.html en la carpeta).");
  });

  // Opens the folder holding the developed files in the OS file explorer. If the
  // target is a file, reveals it; if a folder, opens it; otherwise opens the root.
  ipcMain.handle("cocreate:test:open-folder", async (_event, payload) => {
    const target = typeof payload?.target === "string" && payload.target.trim() ? payload.target.trim() : null;
    if (target) {
      const stats = await stat(target).catch(() => null);
      if (stats?.isFile()) {
        shell.showItemInFolder(target);
        return { ok: true };
      }
      if (stats?.isDirectory()) {
        await shell.openPath(target);
        return { ok: true };
      }
    }
    const root = await resolveProjectRoot();
    if (!root) {
      throw new Error("No hay una carpeta que abrir.");
    }
    await shell.openPath(root);
    return { ok: true };
  });

  // Latest pointer + surrounding-element context streamed from the Live surface.
  // Phase 1 just retains it; Phase 2 will cross it with the streaming transcript
  // to generate prompts. Exposed via getLivePointer() for later wiring.
  const onLivePointer = (_event, data) => {
    livePointer = data ?? null;
  };
  ipcMain.on("cocreate:live:pointer", onLivePointer);

  // Surface the Live surface's logs in the main process output for debugging.
  const onLiveLog = (_event, msg) => console.log("[Live:surface]", msg);
  ipcMain.on("cocreate:live:log", onLiveLog);

  const startTask = (pointer, seedTranscript, anchor, anchorText, anchorTag) => {
    const id = `task-${liveSeq++}`;
    const task = {
      id,
      x: pointer?.x ?? 0.5,
      y: pointer?.y ?? 0.5,
      anchor: anchor || "",
      anchorText: anchorText || "",
      anchorTag: anchorTag || "",
      status: "recording",
      prompt: "",
      transcript: seedTranscript || "",
      summary: "",
      progress: ""
    };
    const s = sess();
    s.tasks.set(id, task);
    s.currentTaskId = id;
    console.log("[Live:main] NEW task", id, "at", task.x.toFixed(2), task.y.toFixed(2), "anchor:", anchor || "(none)");
    return task;
  };

  // Live voice transcription via Deepgram (accepts webm/opus directly). Chunked
  // REST for now; true word-by-word streaming (WebSocket) is a later upgrade.
  ipcMain.handle("cocreate:live:transcribe", async (_event, payload) => {
    const key = (deepgram?.apiKey || "").replace(/﻿/g, "").trim();
    if (!key) throw new Error("Falta DEEPGRAM_API_KEY para la transcripción de Live coding.");
    const b64 = typeof payload?.audioBase64 === "string" ? payload.audioBase64 : "";
    if (!b64) return { text: "" };
    const buffer = Buffer.from(b64, "base64");
    const response = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true&punctuate=true",
      {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": payload?.mimeType || "audio/webm" },
        body: buffer
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[Live:deepgram] error", response.status, text.slice(0, 200));
      throw new Error(`Deepgram HTTP ${response.status}`);
    }
    const data = await response.json();
    const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    return { text };
  });

  // Deepgram token for the in-window streaming WebSocket (real-time transcript).
  ipcMain.handle("cocreate:live:deepgram-token", async () => {
    return { token: (deepgram?.apiKey || "").replace(/﻿/g, "").trim() };
  });

  // Live session reset — clears ONLY the current workspace's tasks.
  ipcMain.handle("cocreate:live:reset", async () => {
    const s = sess();
    s.tasks.clear();
    s.currentTaskId = null;
    pushTasks();
    return { ok: true };
  });

  // A (final) transcript segment. Everything is accumulated into the CURRENT task
  // (one white dot). We only dispatch when the analyzer detects an EXPLICIT
  // boundary — one objective becomes exactly one prompt.
  ipcMain.handle("cocreate:live:segment", async (_event, payload) => {
    const segment = typeof payload?.segment === "string" ? payload.segment.trim() : "";
    const cursorContext = typeof payload?.cursorContext === "string" ? payload.cursorContext : "";
    const pointer = payload?.pointer || livePointer || { x: 0.5, y: 0.5 };
    const anchor = typeof payload?.anchor === "string" ? payload.anchor : "";
    const anchorText = typeof payload?.anchorText === "string" ? payload.anchorText : "";
    const anchorTag = typeof payload?.anchorTag === "string" ? payload.anchorTag : "";
    const s = sess();
    if (!segment) return { tasks: [...s.tasks.values()] };

    // First speech of a new task anchors the white dot at the current cursor.
    let task = s.currentTaskId ? s.tasks.get(s.currentTaskId) : null;
    if (!task) task = startTask(pointer, segment, anchor, anchorText, anchorTag);
    else task.transcript = `${task.transcript} ${segment}`.trim();
    pushTasks();
    console.log("[Live:main] segment:", JSON.stringify(segment), "| task", task.id, "transcript:", JSON.stringify(task.transcript));

    let analysis;
    try {
      analysis = await detectTaskBoundary({
        apiKey: organizer?.apiKey,
        model: organizer?.model,
        baseUrl: organizer?.baseUrl,
        transcript: task.transcript,
        cursorContext
      });
      console.log("[Live:main] boundary:", analysis.boundary, "| prompt:", JSON.stringify(analysis.prompt.slice(0, 160)));
    } catch (error) {
      console.error("[Live:main] analyzer ERROR:", error instanceof Error ? error.message : error);
      return { tasks: [...s.tasks.values()], error: error instanceof Error ? error.message : "analyzer-failed" };
    }

    task.prompt = analysis.prompt || task.prompt;
    if (analysis.boundary && task.prompt && typeof runLiveCodex === "function") {
      dispatchTask(task.id);
      // A new improvement may already have started in the same breath.
      if (analysis.nextSeed) startTask(pointer, analysis.nextSeed, anchor, anchorText, anchorTag);
    }
    pushTasks();
    return { tasks: [...s.tasks.values()] };
  });

  // The user clicked a task's checkmark: dispatch it NOW. If no boundary was
  // detected yet, consolidate its transcript into a single prompt first so the
  // click always executes (no need to start talking about another task).
  ipcMain.handle("cocreate:live:dispatch-task", async (_event, payload) => {
    const s = sess();
    const id = typeof payload?.id === "string" ? payload.id : s.currentTaskId;
    const task = id ? s.tasks.get(id) : null;
    console.log("[Live:main] dispatch-task CLICK id=", id, "found=", Boolean(task), "status=", task?.status);
    if (!task || task.status !== "recording") return { ok: true, ignored: true };
    if (s.currentTaskId === id) s.currentTaskId = null;
    // Instant feedback: flip to executing right away (the surface already showed a
    // spinner optimistically), then consolidate + run.
    task.status = "executing";
    task.progress = "Preparando…";
    pushTasks();
    if (!task.prompt && task.transcript) {
      try {
        const analysis = await detectTaskBoundary({
          apiKey: organizer?.apiKey,
          model: organizer?.model,
          baseUrl: organizer?.baseUrl,
          transcript: task.transcript,
          cursorContext: ""
        });
        task.prompt = analysis.prompt || task.transcript;
      } catch {
        task.prompt = task.transcript;
      }
    }
    if (!task.prompt) {
      task.status = "failed";
      task.summary = "No había nada que ejecutar.";
      task.progress = "";
      pushTasks();
      return { ok: true };
    }
    enqueueDispatch(id);
    return { ok: true };
  });

  ipcMain.handle("cocreate:live:flush", async () => {
    const s = sess();
    if (s.currentTaskId) dispatchTask(s.currentTaskId);
    return { ok: true };
  });

  // Retry a failed task (the user clicked its red marker).
  ipcMain.handle("cocreate:live:retry-task", async (_event, payload) => {
    const id = typeof payload?.id === "string" ? payload.id : null;
    const task = id ? sess().tasks.get(id) : null;
    if (!task) return { ok: true };
    if (!task.prompt) task.prompt = task.transcript;
    if (!task.prompt) return { ok: true };
    console.log("[Live:main] RETRY task", id);
    task.status = "executing";
    task.progress = "Reintentando…";
    task.summary = "";
    pushTasks();
    enqueueDispatch(id);
    return { ok: true };
  });

  // Dismiss a finished task marker (the user clicked its green check).
  ipcMain.handle("cocreate:live:dismiss-task", async (_event, payload) => {
    const id = typeof payload?.id === "string" ? payload.id : null;
    const s = sess();
    if (id && s.tasks.has(id)) {
      s.tasks.delete(id);
      if (s.currentTaskId === id) s.currentTaskId = null;
      console.log("[Live:main] dismissed task", id);
      pushTasks();
    }
    return { ok: true };
  });

  return () => {
    ipcMain.removeHandler("cocreate:test:launch");
    ipcMain.removeHandler("cocreate:test:open-folder");
    ipcMain.removeHandler("cocreate:live:transcribe");
    ipcMain.removeHandler("cocreate:live:deepgram-token");
    ipcMain.removeHandler("cocreate:live:reset");
    ipcMain.removeHandler("cocreate:live:segment");
    ipcMain.removeHandler("cocreate:live:dispatch-task");
    ipcMain.removeHandler("cocreate:live:flush");
    ipcMain.removeHandler("cocreate:live:retry-task");
    ipcMain.removeHandler("cocreate:live:dismiss-task");
    ipcMain.removeListener("cocreate:live:pointer", onLivePointer);
    ipcMain.removeListener("cocreate:live:log", onLiveLog);
    stopServers();
    if (testWindow && !testWindow.isDestroyed()) {
      testWindow.close();
    }
    testWindow = null;
  };
}
