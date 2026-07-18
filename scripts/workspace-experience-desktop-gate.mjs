import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

const appExecutable = path.resolve("release/mac-arm64/CoCreate.app/Contents/MacOS/CoCreate");
const timeoutMs = Number(process.env.COCREATE_WORKSPACE_GATE_TIMEOUT_MS ?? "300000");
const desktopShot = "/tmp/cocreate-workspace-real-turn.png";
const approvalShot = "/tmp/cocreate-workspace-real-approval.png";
const liveShot = "/tmp/cocreate-live-coding-foundation.png";
const visualShot = "/tmp/cocreate-live-visual-collaboration.png";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkpoint(label) {
  process.stderr.write(`[workspace-gate] ${label}\n`);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function startPreviewFixture() {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Desktop Preview</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:42px;background:linear-gradient(135deg,#eef4e8,#d7e8dc);color:#15251b;font-family:Georgia,serif}nav{display:flex;align-items:center;justify-content:space-between}button{border:0;border-radius:999px;background:#163d27;color:#fff;padding:11px 18px}main{max-width:620px;margin:72px auto}h1{margin:0;font-size:68px;line-height:.92}.card{margin-top:30px;padding:24px;border:1px solid rgba(21,37,27,.12);border-radius:24px;background:rgba(255,255,255,.54)}</style></head><body><nav><strong>Atlas</strong><button>Guardar</button></nav><main><h1>Ideas que encuentran forma.</h1><div class="card"><strong>Proyecto principal</strong><p>Selecciona esta tarjeta para describir una mejora.</p><button>Comenzar</button></div></main></body></html>`;
  const server = createServer((request, response) => {
    if (request.url !== "/" && !request.url?.startsWith("/?")) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No pude iniciar la fixture visual local.");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitFor(check, timeout, message) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("No pude conectar con Chromium DevTools.")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("El target CDP se cerró."));
      this.pending.clear();
    });
    return this;
  }

  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result?.value;
  }

  close() {
    this.socket.close();
  }
}

function launchApp(userDataDir, port) {
  const child = spawn(appExecutable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_RUNTIME_MODE: "app-server",
      CODEX_WEB_SEARCH_MODE: "disabled"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  return { child, output: () => ({ stdout, stderr }) };
}

async function connectToRenderer(port) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((entry) =>
      entry.type === "page" &&
      entry.webSocketDebuggerUrl &&
      (/index\.html|localhost|127\.0\.0\.1/.test(entry.url ?? "") || /CoCreate/i.test(entry.title ?? ""))
    ) ?? null;
  }, 30_000, "La ventana Desktop no expuso un target de QA");
  const session = await new CdpSession(target.webSocketDebuggerUrl).connect();
  await session.call("Runtime.enable");
  await session.call("Page.enable");
  try {
    await waitFor(
      () => session.evaluate("Boolean(window.overlayBridge && document.body.innerText.trim().length)"),
      30_000,
      "El renderer Desktop no terminó de cargar"
    );
  } catch (error) {
    const state = await session.evaluate("({ url: location.href, title: document.title, body: document.body.innerText.slice(0, 500), bridge: Boolean(window.overlayBridge) })").catch(() => null);
    throw new Error(`${error.message}. Target: ${JSON.stringify({ url: target.url, title: target.title, state })}`);
  }
  return session;
}

async function capture(session, filePath) {
  await session.call("Page.bringToFront").catch(() => undefined);
  const result = await Promise.race([
    session.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
    delay(15_000).then(() => null)
  ]);
  if (!result?.data) {
    checkpoint(`screenshot-skipped-${path.basename(filePath)}`);
    return false;
  }
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  return true;
}

async function installEventRecorder(session) {
  await session.evaluate(`(() => {
    window.__workspaceGateEvents = [];
    window.__workspaceGateApprovals = [];
    window.__workspaceGateDisposeEvents?.();
    window.__workspaceGateDisposeApprovals?.();
    window.__workspaceGateDisposeEvents = window.overlayBridge.onCodexEvent((event) => {
      window.__workspaceGateEvents.push({
        type: event.type,
        executionId: event.executionId ?? null,
        upstreamType: event.type === "codex.upstream" ? event.event?.type ?? null : null
      });
      window.__workspaceGateEvents = window.__workspaceGateEvents.slice(-500);
    });
    window.__workspaceGateDisposeApprovals = window.overlayBridge.onCodexApprovalRequest((request) => {
      window.__workspaceGateApprovals.push({
        approvalId: request.approvalId,
        category: request.category,
        threadId: request.threadId,
        turnId: request.turnId
      });
    });
    return true;
  })()`);
}

async function submitPrompt(session, prompt) {
  const filled = await session.evaluate(`(() => {
    const input = document.querySelector("textarea");
    if (!(input instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(prompt)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  if (!filled) throw new Error("No encontré el composer Desktop.");
  await delay(120);
  const started = await session.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === "Enviar");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!started) throw new Error("El botón Enviar no estaba disponible.");
}

async function waitForTurn(session, approvalDecision) {
  const handledApprovals = new Set();
  const approvalResults = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await session.evaluate(`(() => ({
      events: window.__workspaceGateEvents ?? [],
      approvals: window.__workspaceGateApprovals ?? [],
      approvalVisible: Boolean(document.querySelector(".approval-card")),
      approvalButtons: Array.from(document.querySelectorAll(".approval-card button")).map((entry) => ({ text: entry.textContent?.trim(), disabled: entry.disabled })),
      bodyTail: document.body.innerText.slice(-1800)
    }))()`);
    const request = snapshot.approvals.at(-1);
    if (snapshot.approvalVisible && request && !handledApprovals.has(request.approvalId)) {
      if (!approvalResults.length) await capture(session, approvalShot);
      const label = approvalDecision === "approve" ? "Aprobar una vez" : "Cancelar";
      const clicked = await session.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll(".approval-card button")).find((entry) => entry.textContent?.trim() === ${JSON.stringify(label)});
        if (!button || button.disabled) return false;
        button.focus();
        button.click();
        return true;
      })()`);
      if (clicked) {
        handledApprovals.add(request.approvalId);
        approvalResults.push({ ...request, decision: approvalDecision });
      }
    }
    const terminal = snapshot.events.findLast((event) => ["execution.completed", "execution.failed", "execution.cancelled"].includes(event.type));
    if (terminal) {
      await delay(700);
      const events = await session.evaluate("window.__workspaceGateEvents ?? []");
      return {
        terminal: terminal.type,
        executionId: terminal.executionId,
        eventTypes: [...new Set(events.map((event) => event.type))],
        upstreamTypes: [...new Set(events.map((event) => event.upstreamType).filter(Boolean))],
        approvals: approvalResults,
        bodyTail: snapshot.bodyTail
      };
    }
    await delay(350);
  }
  throw new Error("El Turn real excedió el timeout controlado.");
}

async function closeApp(session, processHandle) {
  await session.evaluate("void window.overlayBridge.closeApp(); true").catch(() => undefined);
  session.close();
  await Promise.race([
    new Promise((resolve) => processHandle.child.once("exit", resolve)),
    delay(10_000).then(() => {
      processHandle.child.kill("SIGTERM");
      return null;
    })
  ]);
}

async function run() {
  await access(appExecutable);
  const previewFixture = await startPreviewFixture();
  const gateRoot = await mkdtemp(path.join(homedir(), ".cocreate-workspace-gate-"));
  const projectDir = path.join(gateRoot, "project");
  const userDataDir = path.join(gateRoot, "user-data");
  const approvalProbe = path.join(gateRoot, "approval-probe.txt");
  await writeFile(path.join(gateRoot, ".keep"), "workspace gate\n");
  await Promise.all([
    mkdir(projectDir, { recursive: true }),
    mkdir(userDataDir, { recursive: true })
  ]);
  await writeFile(
    path.join(projectDir, "index.html"),
    "<!doctype html>\n<html>\n  <body>\n    <button>Current Proposal Gate</button>\n  </body>\n</html>\n"
  );
  let firstProcess = null;
  let secondProcess = null;
  let firstSession = null;
  let secondSession = null;
  try {
    const firstPort = 9300 + Math.floor(Math.random() * 300);
    firstProcess = launchApp(userDataDir, firstPort);
    firstSession = await connectToRenderer(firstPort);
    let latestStatus = null;
    let status;
    try {
      status = await waitFor(async () => {
        latestStatus = await firstSession.evaluate("window.overlayBridge.getCodexStatus()");
        return latestStatus?.available && latestStatus?.runtimeMode === "app-server" ? latestStatus : null;
      }, 60_000, "Codex App Server no quedó available en Desktop");
    } catch (error) {
      throw new Error(`${error.message}. Status: ${JSON.stringify(latestStatus)}. Process: ${JSON.stringify(firstProcess.output())}`);
    }
    checkpoint("app-server-ready");

    await firstSession.evaluate(`window.overlayBridge.createWorkspaceProject(${JSON.stringify({
      name: "Workspace Gate Project",
      rootPath: projectDir
    })})`);
    await firstSession.evaluate("location.reload(); true").catch(() => undefined);
    await waitFor(() => firstSession.evaluate("Boolean(window.overlayBridge && document.querySelector('.workspace-context'))"), 30_000, "La UI no restauró el Project de prueba");

    await firstSession.evaluate(`(() => {
      const button = document.querySelector('button[aria-label="Administrar proyecto y tarea"]');
      button?.click();
      return Boolean(button);
    })()`);
    await delay(100);
    const taskSubmitted = await firstSession.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Título de la nueva tarea"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Real Workspace Turn");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form?.requestSubmit();
      return true;
    })()`);
    if (!taskSubmitted) throw new Error("No pude crear la Task desde la UI.");
    const created = await waitFor(async () => {
      const bootstrap = await firstSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
      return bootstrap?.task?.title === "Real Workspace Turn" && bootstrap?.conversation?.id ? bootstrap : null;
    }, 20_000, "Task y Conversation no se crearon desde la UI");
    checkpoint("primary-task-created");

    const liveModeOpened = await firstSession.evaluate(`(() => {
      const contextButton = document.querySelector('button[aria-label="Administrar proyecto y tarea"]');
      if (document.querySelector(".workspace-context-drawer")) contextButton?.click();
      const liveButton = Array.from(document.querySelectorAll(".workspace-mode-switch button"))
        .find((entry) => entry.textContent?.trim() === "Live");
      if (!(liveButton instanceof HTMLButtonElement) || liveButton.disabled) return false;
      liveButton.click();
      return true;
    })()`);
    if (!liveModeOpened) throw new Error("Live no estaba disponible en CoCreate Desktop.");
    await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.workspace-mode-layout.mode-live .live-session-card'))"),
      10_000,
      "La experiencia Live no apareció"
    );
    const liveExpanded = await firstSession.evaluate(`(() => ({
      modeButtons: Array.from(document.querySelectorAll(".workspace-mode-switch button")).map((entry) => entry.textContent?.trim()),
      livePressed: document.querySelector('.workspace-mode-switch button[aria-pressed="true"]')?.textContent?.trim(),
      sessionVisible: Boolean(document.querySelector(".live-session-card")),
      timelineVisible: Boolean(document.querySelector(".live-timeline-list")),
      activityVisible: Boolean(document.querySelector(".live-activity-panel:not(.collapsed)")),
      workingChangesVisible: document.body.innerText.includes("Working Changes"),
      conversationCount: document.querySelectorAll(".conversation-strip").length,
      composerCount: document.querySelectorAll(".composer-shell").length,
      diagnosticsVisible: Boolean(document.querySelector(".workspace-work-panel")),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);

    const visualConnected = await firstSession.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Dirección de la aplicación actual"]');
      if (!(input instanceof HTMLInputElement) || !input.form) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, ${JSON.stringify(`${previewFixture.url}?token=not-persisted`)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form.requestSubmit();
      return true;
    })()`);
    if (!visualConnected) throw new Error("No pude conectar el preview local desde Live Desktop.");
    await waitFor(
      () => firstSession.evaluate(`document.querySelector('.visual-preview-stage iframe')?.getAttribute('src') === ${JSON.stringify(previewFixture.url)}`),
      10_000,
      "El preview visual Desktop no abrió la URL sanitizada"
    );
    const selectToolOpened = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.visual-tools button')).find((entry) => entry.textContent?.trim() === "Seleccionar");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    if (!selectToolOpened) throw new Error("La herramienta Seleccionar no estaba disponible.");
    const visualLayer = await firstSession.evaluate(`(() => {
      const layer = document.querySelector('.visual-interaction-layer');
      if (!(layer instanceof HTMLElement)) return null;
      const rect = layer.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    if (!visualLayer?.width || !visualLayer?.height) throw new Error("La capa visual Desktop no tenía dimensiones utilizables.");
    const selectionPoint = { x: visualLayer.x + visualLayer.width * 0.76, y: visualLayer.y + visualLayer.height * 0.18 };
    await firstSession.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...selectionPoint });
    await firstSession.call("Input.dispatchMouseEvent", { type: "mousePressed", ...selectionPoint, button: "left", clickCount: 1 });
    await firstSession.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...selectionPoint, button: "left", clickCount: 1 });
    await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.visual-selection-inspector'))"),
      5_000,
      "La selección visual Desktop no creó contexto"
    );
    const selectionNamed = await firstSession.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Nombre amigable de la selección"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Botón Guardar");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form?.requestSubmit();
      return true;
    })()`);
    if (!selectionNamed) throw new Error("No pude nombrar la selección visual Desktop.");
    const annotationToolOpened = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.visual-tools button')).find((entry) => entry.textContent?.trim() === "Flecha");
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    if (!annotationToolOpened) throw new Error("La herramienta Flecha no estaba disponible.");
    const annotationStart = { x: visualLayer.x + visualLayer.width * 0.42, y: visualLayer.y + visualLayer.height * 0.52 };
    const annotationEnd = { x: visualLayer.x + visualLayer.width * 0.7, y: visualLayer.y + visualLayer.height * 0.24 };
    await firstSession.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...annotationStart });
    await firstSession.call("Input.dispatchMouseEvent", { type: "mousePressed", ...annotationStart, button: "left", clickCount: 1 });
    await firstSession.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...annotationEnd, button: "left" });
    await firstSession.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...annotationEnd, button: "left", clickCount: 1 });
    await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.visual-comparison-switch button')).find((entry) => entry.textContent?.includes("Superpuesta"));
      button?.click();
      return Boolean(button);
    })()`);
    await delay(350);
    const visualCollaboration = await firstSession.evaluate(`(() => ({
      workspaceVisible: Boolean(document.querySelector('.visual-collaboration-workspace')),
      currentVisible: Boolean(document.querySelector('.visual-preview-panel')),
      proposalVisible: Boolean(document.querySelector('.visual-proposal-panel.overlay')),
      selectedLabel: document.querySelector('input[aria-label="Nombre amigable de la selección"]')?.value ?? null,
      previewUrl: document.querySelector('input[aria-label="Dirección de la aplicación actual"]')?.value ?? null,
      annotationCount: document.querySelectorAll('.visual-annotation-layer line').length,
      iframeSandbox: document.querySelector('.visual-preview-stage iframe')?.getAttribute('sandbox') ?? null,
      secretVisible: document.body.innerText.includes("not-persisted") || document.body.innerHTML.includes("not-persisted"),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    await installEventRecorder(firstSession);
    await submitPrompt(firstSession,
      "Implementa esta propuesta visual únicamente en el Proposal Workspace: lee index.html y cambia el texto Current Proposal Gate por Proposal Runtime Ready. Puedes usar herramientas upstream de lectura y apply_patch dentro de esta copia aislada. No instales dependencias, no ejecutes build o tests, no hagas commit y no hagas push."
    );
    const visualTurn = await waitForTurn(firstSession, "approve");
    let visualProposalAvailable;
    try {
      visualProposalAvailable = await waitFor(
        () => firstSession.evaluate(`(() => {
          const panel = document.querySelector('.proposal-runtime-panel');
          const preview = panel?.querySelector('.proposal-live-preview iframe');
          if (!panel?.querySelector('.visual-proposal-badge.status-ready') || !preview) return null;
          return {
            previewSrc: preview.getAttribute('src'),
            target: panel.querySelector('.proposal-runtime-target')?.textContent?.trim() ?? null,
            files: panel.querySelector('.proposal-change-summary')?.textContent?.trim() ?? null,
            historyCount: document.querySelectorAll('.visual-proposal-history > button').length,
            workingChanges: document.querySelectorAll('.live-change-card').length
          };
        })()`),
        45_000,
        "La propuesta funcional no llegó al estado Ready"
      );
    } catch (error) {
      const diagnostics = await firstSession.evaluate(`(async () => ({
        proposals: await window.overlayBridge.listProposals(),
        bodyTail: document.body.innerText.slice(-2400)
      }))()`).catch(() => null);
      throw new Error(`${error.message}. Terminal: ${JSON.stringify(visualTurn)}. Proposal: ${JSON.stringify(diagnostics)}. Process: ${JSON.stringify(firstProcess.output())}`);
    }
    const currentBeforeApply = await readFile(path.join(projectDir, "index.html"), "utf8");
    await capture(firstSession, visualShot);
    const validationRequested = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.proposal-runtime-actions button')).find((entry) => entry.textContent?.includes("Validar"));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    const validationPassed = validationRequested && await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.proposal-validation.status-passed'))"),
      20_000,
      "La Proposal no completó su validación"
    );
    const approvalRequested = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.proposal-runtime-actions button')).find((entry) => entry.textContent?.includes("Aprobar propuesta"));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    const visualProposalApproved = approvalRequested && await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.visual-proposal-badge.status-approved'))"),
      8_000,
      "La Proposal no cambió a aprobada"
    );
    const artifactsAfterVisualApproval = await firstSession.evaluate("document.querySelectorAll('.live-change-card').length");
    const applyRequested = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('.proposal-runtime-actions button')).find((entry) => entry.textContent?.includes("Aplicar a Current"));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    let visualProposalApplied = false;
    if (applyRequested) {
      try {
        visualProposalApplied = await waitFor(
          () => firstSession.evaluate("Boolean(document.querySelector('.visual-proposal-badge.status-applied'))"),
          10_000,
          "La Proposal no se aplicó a Current"
        );
      } catch (error) {
        const diagnostics = await firstSession.evaluate(`(async () => ({
          proposals: await window.overlayBridge.listProposals(),
          bodyTail: document.body.innerText.slice(-1800)
        }))()`).catch(() => null);
        throw new Error(`${error.message}. Proposal: ${JSON.stringify(diagnostics)}`);
      }
    }
    const currentAfterApply = await readFile(path.join(projectDir, "index.html"), "utf8");
    visualCollaboration.proposal = {
      terminal: visualTurn.terminal,
      ...visualProposalAvailable,
      currentUntouchedBeforeApply: currentBeforeApply.includes("Current Proposal Gate"),
      validationPassed,
      approved: visualProposalApproved,
      applied: visualProposalApplied,
      currentUpdatedAfterApply: currentAfterApply.includes("Proposal Runtime Ready"),
      workingChangesAfterApproval: artifactsAfterVisualApproval
    };
    await capture(firstSession, liveShot);
    const livePanelCollapseRequested = await firstSession.evaluate(`(() => {
      const close = document.querySelector('button[aria-label="Cerrar actividad"]');
      if (!(close instanceof HTMLButtonElement)) return false;
      close.click();
      return true;
    })()`);
    const livePanelCollapsed = livePanelCollapseRequested && await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.live-activity-panel.collapsed'))"),
      5_000,
      "El panel Live no se colapsó"
    );
    const livePanelRestoreRequested = await firstSession.evaluate(`(() => {
      const open = document.querySelector('button[aria-label="Abrir actividad"]');
      if (!(open instanceof HTMLButtonElement)) return false;
      open.click();
      return true;
    })()`);
    const livePanelRestored = livePanelRestoreRequested && await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.live-activity-panel:not(.collapsed)'))"),
      5_000,
      "El panel Live no volvió a abrirse"
    );
    const chatModeRestored = await firstSession.evaluate(`(() => {
      const chatButton = Array.from(document.querySelectorAll(".workspace-mode-switch button"))
        .find((entry) => entry.textContent?.trim() === "Chat");
      if (!(chatButton instanceof HTMLButtonElement)) return false;
      chatButton.click();
      return true;
    })()`);
    await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.workspace-mode-layout.mode-chat')) && !document.querySelector('.live-session-card')"),
      10_000,
      "No pude volver de Live a Chat"
    );
    const liveVisualResumed = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".workspace-mode-switch button")).find((entry) => entry.textContent?.trim() === "Live");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    const visualAfterResume = liveVisualResumed ? await waitFor(
      () => firstSession.evaluate(`(() => {
        const selection = document.querySelector('input[aria-label="Nombre amigable de la selección"]');
        if (!(selection instanceof HTMLInputElement)) return null;
        return {
          selectedLabel: selection.value,
          annotationCount: document.querySelectorAll('.visual-annotation-layer line').length
        };
      })()`),
      10_000,
      "La colaboración visual no se restauró al volver a Live"
    ) : null;
    await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".workspace-mode-switch button")).find((entry) => entry.textContent?.trim() === "Chat");
      button?.click();
      return Boolean(button);
    })()`);
    await waitFor(() => firstSession.evaluate("Boolean(document.querySelector('.workspace-mode-layout.mode-chat'))"), 10_000, "No pude regresar a Chat tras restaurar Visual Live");
    const liveFoundation = {
      opened: liveModeOpened,
      ...liveExpanded,
      panelCollapsed: livePanelCollapsed,
      panelRestored: livePanelRestored,
      chatRestored: chatModeRestored,
      visual: visualCollaboration,
      visualResumed: visualAfterResume
    };
    checkpoint("live-foundation-verified");

    await installEventRecorder(firstSession);
    await submitPrompt(firstSession,
      "En este proyecto temporal, crea cocreate-workspace-test.ts con una función add(a, b), crea cocreate-workspace-test.test.ts usando node:test y ejecuta node --test cocreate-workspace-test.test.ts. Usa un plan si lo consideras útil. No instales dependencias, no uses red y no modifiques archivos fuera de este proyecto."
    );
    checkpoint("coding-turn-submitted");
    const codingTurn = await waitForTurn(firstSession, "approve");
    checkpoint("coding-turn-completed");
    await capture(firstSession, desktopShot);
    checkpoint("coding-screenshot-captured");

    const afterCoding = await firstSession.evaluate(`(async () => {
      const bootstrap = await window.overlayBridge.getWorkspaceBootstrap();
      const artifacts = await window.overlayBridge.listWorkspaceArtifacts({ taskId: bootstrap.task?.id });
      const activities = await window.overlayBridge.listWorkspaceActivity({ taskId: bootstrap.task?.id });
      return { bootstrap, artifacts, activities, body: document.body.innerText };
    })()`);
    checkpoint("coding-evidence-loaded");
    await access(path.join(projectDir, "cocreate-workspace-test.ts"));
    await access(path.join(projectDir, "cocreate-workspace-test.test.ts"));

    await firstSession.evaluate(`(() => {
      if (document.querySelector(".workspace-context-drawer")) return true;
      const button = document.querySelector('button[aria-label="Administrar proyecto y tarea"]');
      button?.click();
      return Boolean(button);
    })()`);
    await waitFor(
      () => firstSession.evaluate("Boolean(document.querySelector('.workspace-context-drawer'))"),
      10_000,
      "No pude reabrir la administración del Workspace"
    );
    const secondaryTaskFilled = await firstSession.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Título de la nueva tarea"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Background QA Task");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    if (!secondaryTaskFilled) throw new Error("No pude completar el título de la Task secundaria.");
    await delay(150);
    const secondaryTaskSubmitted = await firstSession.evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Título de la nueva tarea"]');
      if (!(input instanceof HTMLInputElement) || !input.form) return false;
      input.form.requestSubmit();
      return true;
    })()`);
    if (!secondaryTaskSubmitted) throw new Error("No pude crear la Task secundaria desde la UI.");
    const secondary = await waitFor(async () => {
      const bootstrap = await firstSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
      return bootstrap?.task?.title === "Background QA Task" &&
        bootstrap?.conversation?.taskId === bootstrap?.task?.id
        ? bootstrap
        : null;
    }, 20_000, "La UI no abrió la Task secundaria");
    checkpoint("secondary-task-created");
    const secondaryArtifacts = await firstSession.evaluate(
      `window.overlayBridge.listWorkspaceArtifacts(${JSON.stringify({ taskId: secondary.task.id })})`
    );
    await waitFor(() => firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('[aria-label="Tareas disponibles"] button'))
        .find((entry) => entry.textContent?.includes("Real Workspace Turn"));
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`), 20_000, "El selector de Task no quedó listo después de crear la Task secundaria");
    const switchedBack = await firstSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('[aria-label="Tareas disponibles"] button'))
        .find((entry) => entry.textContent?.includes("Real Workspace Turn"));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    if (!switchedBack) throw new Error("No pude volver a la Task original desde la UI.");
    const restoredOriginal = await waitFor(async () => {
      const bootstrap = await firstSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
      return bootstrap?.task?.id === created.task.id && bootstrap?.conversation?.id === created.conversation.id
        ? bootstrap
        : null;
    }, 20_000, "La UI no restauró la Task original después del switch");
    checkpoint("primary-task-restored-after-switch");
    const originalArtifactsAfterSwitch = await firstSession.evaluate(
      `window.overlayBridge.listWorkspaceArtifacts(${JSON.stringify({ taskId: created.task.id })})`
    );
    const taskSwitch = {
      secondaryTaskId: secondary.task.id,
      secondaryConversationId: secondary.conversation.id,
      secondaryArtifacts: secondaryArtifacts.length,
      returnedTaskId: restoredOriginal.task.id,
      returnedConversationId: restoredOriginal.conversation.id,
      returnedThreadId: restoredOriginal.runtime?.codex?.threadId ?? null,
      originalArtifacts: originalArtifactsAfterSwitch.length
    };

    const approvalTurns = [];
    for (const decision of ["reject", "approve"]) {
      await firstSession.evaluate("window.__workspaceGateEvents = []; window.__workspaceGateApprovals = []; true");
      const command = `printf 'approved\\n' > ${JSON.stringify(approvalProbe)}`;
      await submitPrompt(firstSession,
        `Como prueba segura del sandbox, solicita aprobación para ejecutar exactamente este único comando fuera del workspace: ${command}. ` +
        "No cambies el comando, no uses otra herramienta ni una ruta alternativa. Si la aprobación se rechaza, detente."
      );
      const turn = await waitForTurn(firstSession, decision);
      approvalTurns.push({ decision, ...turn });
      if (decision === "reject" && await fileExists(approvalProbe)) {
        throw new Error("El probe se escribió aunque la aprobación fue rechazada.");
      }
      if (decision === "approve") await access(approvalProbe);
      checkpoint(`approval-${decision}-completed`);
    }

    const beforeRestart = await firstSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
    const firstOutput = firstProcess.output();
    await closeApp(firstSession, firstProcess);
    checkpoint("first-app-closed");
    firstSession = null;
    firstProcess = null;

    const secondPort = firstPort + 401;
    secondProcess = launchApp(userDataDir, secondPort);
    secondSession = await connectToRenderer(secondPort);
    const restored = await waitFor(async () => {
      const bootstrap = await secondSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
      return bootstrap?.task?.id === beforeRestart.task?.id ? bootstrap : null;
    }, 30_000, "La UI Desktop no restauró la Task anterior");
    checkpoint("workspace-restored-after-restart");
    const restoredUi = await secondSession.evaluate(`(() => ({
      hasWorkspace: document.body.innerText.includes("Workspace Gate Project"),
      hasTask: document.body.innerText.includes("Real Workspace Turn"),
      overflow: document.documentElement.scrollWidth > innerWidth
    }))()`);
    await waitFor(
      () => secondSession.evaluate(`(() => {
        const button = Array.from(document.querySelectorAll(".workspace-mode-switch button")).find((entry) => entry.textContent?.trim() === "Live");
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`),
      60_000,
      "Live no volvió a estar disponible después del reinicio Desktop"
    );
    const restoredVisualRequested = await secondSession.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".workspace-mode-switch button")).find((entry) => entry.textContent?.trim() === "Live");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    const restoredVisual = restoredVisualRequested ? await waitFor(
      () => secondSession.evaluate(`(() => {
        const selection = document.querySelector('input[aria-label="Nombre amigable de la selección"]');
        const preview = document.querySelector('input[aria-label="Dirección de la aplicación actual"]');
        if (!(selection instanceof HTMLInputElement) || !(preview instanceof HTMLInputElement)) return null;
        return {
          selectedLabel: selection.value,
          previewUrl: preview.value,
          annotationCount: document.querySelectorAll('.visual-annotation-layer line').length,
          activityVisible: Boolean(document.querySelector('.live-activity-panel'))
        };
      })()`),
      15_000,
      "La colaboración visual Desktop no se restauró después del reinicio"
    ) : null;

    const codingEvidence = {
      projectId: created.project.id,
      taskId: created.task.id,
      conversationId: created.conversation.id,
      threadId: afterCoding.bootstrap.runtime?.codex?.threadId ?? null,
      turnId: afterCoding.bootstrap.runtime?.codex?.turnId ?? null,
      executionId: codingTurn.executionId,
      terminal: codingTurn.terminal,
      streaming: codingTurn.eventTypes.includes("execution.output"),
      plan: codingTurn.upstreamTypes.includes("plan.updated"),
      commandOrTool: codingTurn.upstreamTypes.some((type) => type.startsWith("command.") || type.startsWith("mcp.")),
      diffOrPatch: codingTurn.upstreamTypes.some((type) => type.startsWith("diff.") || type.startsWith("fileChange.")),
      artifacts: afterCoding.artifacts.length,
      activities: afterCoding.activities.length,
      approvalsAccepted: codingTurn.approvals.filter((entry) => entry.decision === "approve").length
    };
    const rejectedApproval = approvalTurns.some((turn) => turn.decision === "reject" && turn.approvals.length > 0);
    const acceptedApproval = codingEvidence.approvalsAccepted > 0 || approvalTurns.some((turn) => turn.decision === "approve" && turn.approvals.length > 0);
    const result = {
      ok: codingTurn.terminal === "execution.completed" && codingEvidence.threadId && codingEvidence.turnId &&
        liveFoundation.opened && liveFoundation.livePressed === "Live" && liveFoundation.sessionVisible &&
        liveFoundation.timelineVisible && liveFoundation.activityVisible && liveFoundation.workingChangesVisible &&
        liveFoundation.conversationCount === 1 && liveFoundation.composerCount === 1 && !liveFoundation.diagnosticsVisible &&
        !liveFoundation.overflow && liveFoundation.panelCollapsed && liveFoundation.panelRestored && liveFoundation.chatRestored &&
        liveFoundation.visual.workspaceVisible && liveFoundation.visual.currentVisible && liveFoundation.visual.proposalVisible &&
        liveFoundation.visual.selectedLabel === "Botón Guardar" && liveFoundation.visual.previewUrl === previewFixture.url &&
        liveFoundation.visual.annotationCount > 0 && !liveFoundation.visual.secretVisible && !liveFoundation.visual.overflow &&
        liveFoundation.visual.proposal.terminal === "execution.completed" && liveFoundation.visual.proposal.historyCount > 0 &&
        liveFoundation.visual.proposal.target?.includes("Botón Guardar") && liveFoundation.visual.proposal.files?.includes("1 archivos") &&
        liveFoundation.visual.proposal.currentUntouchedBeforeApply === true && liveFoundation.visual.proposal.validationPassed === true &&
        liveFoundation.visual.proposal.approved === true && liveFoundation.visual.proposal.applied === true &&
        liveFoundation.visual.proposal.currentUpdatedAfterApply === true &&
        liveFoundation.visual.proposal.workingChanges === 0 && liveFoundation.visual.proposal.workingChangesAfterApproval === 0 &&
        !liveFoundation.visual.iframeSandbox?.includes("allow-same-origin") && liveFoundation.visualResumed?.selectedLabel === "Botón Guardar" &&
        liveFoundation.visualResumed?.annotationCount === 0 && restoredVisual?.selectedLabel === "Botón Guardar" &&
        restoredVisual?.previewUrl === previewFixture.url && restoredVisual?.annotationCount === 0 && restoredVisual?.activityVisible === true &&
        codingEvidence.streaming && codingEvidence.commandOrTool && codingEvidence.diffOrPatch && codingEvidence.artifacts > 0 &&
        codingEvidence.activities > 0 && acceptedApproval && rejectedApproval && restored.project?.id === created.project.id &&
        taskSwitch.secondaryArtifacts === 0 && taskSwitch.returnedTaskId === created.task.id &&
        taskSwitch.secondaryConversationId !== created.conversation.id &&
        taskSwitch.returnedConversationId === created.conversation.id &&
        taskSwitch.returnedThreadId === afterCoding.bootstrap.runtime?.codex?.threadId && taskSwitch.originalArtifacts > 0 &&
        restoredUi.hasWorkspace && restoredUi.hasTask && !restoredUi.overflow,
      codex: {
        version: status.version,
        runtimeMode: status.runtimeMode,
        available: status.available
      },
      liveFoundation,
      coding: codingEvidence,
      approval: {
        accepted: acceptedApproval,
        rejected: rejectedApproval,
        probeCreatedAfterApproval: await fileExists(approvalProbe),
        turns: approvalTurns.map((turn) => ({
          decision: turn.decision,
          terminal: turn.terminal,
          requested: turn.approvals.length,
          upstreamApprovalEvent: turn.upstreamTypes.includes("approval.requested")
        }))
      },
      taskSwitch,
      restoration: {
        sessionStatus: restored.session?.status ?? null,
        projectId: restored.project?.id ?? null,
        taskId: restored.task?.id ?? null,
        conversationId: restored.conversation?.id ?? null,
        lastExecutionStatus: restored.runtime?.activeExecution?.status ?? null,
        activeExecutionId: restored.runtime?.codex?.executionId ?? null,
        visible: restoredUi.hasWorkspace && restoredUi.hasTask,
        visual: restoredVisual
      },
      processOutput: {
        stderrTail: firstOutput.stderr.slice(-800)
      },
      screenshots: { desktopShot, approvalShot, liveShot, visualShot },
      cleaned: true
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } finally {
    if (firstSession && firstProcess) await closeApp(firstSession, firstProcess).catch(() => firstProcess.child.kill("SIGTERM"));
    if (secondSession && secondProcess) await closeApp(secondSession, secondProcess).catch(() => secondProcess.child.kill("SIGTERM"));
    await new Promise((resolve) => previewFixture.server.close(resolve));
    await rm(gateRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
