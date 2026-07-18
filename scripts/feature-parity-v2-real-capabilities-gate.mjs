import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const appExecutable = path.resolve("release/mac-arm64/CoCreate.app/Contents/MacOS/CoCreate");
const timeoutMs = 300_000;
const evidencePath = "/tmp/cocreate-feature-parity-v2-capabilities.json";

function checkpoint(label) {
  process.stderr.write(`[capability-gate] ${label}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("El target CDP se cerro."));
      this.pending.clear();
    });
    return this;
  }

  call(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("El target CDP no esta conectado."));
    }
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
      COCREATE_FEATURE_EXPERIMENTAL_UPSTREAM: "true",
      COCREATE_FEATURE_PLAN_MODE: "true",
      COCREATE_FEATURE_SKILLS: "true",
      COCREATE_FEATURE_PLUGINS: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  let exit = null;
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  child.once("exit", (code, signal) => { exit = { code, signal }; });
  return { child, stderr: () => stderr, exit: () => exit };
}

async function connectToRenderer(port) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl) ?? null;
  }, 30_000, "La ventana Desktop no expuso un target de QA");
  const session = await new CdpSession(target.webSocketDebuggerUrl).connect();
  await session.call("Runtime.enable");
  await waitFor(
    () => session.evaluate("Boolean(window.overlayBridge && document.body.innerText.trim().length)"),
    30_000,
    "El renderer Desktop no termino de cargar"
  );
  return session;
}

async function closeApp(session, processHandle) {
  await session.evaluate("void window.overlayBridge.closeApp(); true").catch(() => undefined);
  session.close();
  await Promise.race([
    new Promise((resolve) => processHandle.child.once("exit", resolve)),
    delay(10_000).then(() => processHandle.child.kill("SIGTERM"))
  ]);
}

async function createTaskFromUi(session, title) {
  await session.evaluate(`(() => {
    const existing = document.querySelector('input[aria-label="Titulo de la nueva Task"], input[aria-label="Título de la nueva Task"]');
    if (existing instanceof HTMLInputElement) return true;
    const button = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.includes("Contexto"));
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(
    () => session.evaluate("Boolean(document.querySelector('input[aria-label=\"Titulo de la nueva Task\"], input[aria-label=\"Título de la nueva Task\"]'))"),
    10_000,
    "El formulario de Task no aparecio"
  );
  const submitted = await session.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Titulo de la nueva Task"], input[aria-label="Título de la nueva Task"]');
    if (!(input instanceof HTMLInputElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form?.requestSubmit();
    return true;
  })()`);
  if (!submitted) throw new Error("No pude crear la Task desde la UI.");
  return waitFor(async () => {
    const bootstrap = await session.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
    return bootstrap?.task?.title === title && bootstrap?.conversation?.id ? bootstrap : null;
  }, 20_000, "La Task no quedo activa");
}

async function chooseSelect(session, selector, value) {
  const changed = await session.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    if (!(select instanceof HTMLSelectElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === ${JSON.stringify(value)};
  })()`);
  if (!changed) throw new Error(`No pude seleccionar ${value} en ${selector}.`);
  await delay(500);
}

async function navigate(session, label) {
  const clicked = await session.evaluate(`(() => {
    const labelNode = Array.from(document.querySelectorAll("button span")).find((entry) => entry.textContent?.trim() === ${JSON.stringify(label)});
    const button = labelNode?.closest("button") ?? Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.includes(${JSON.stringify(label)}));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No pude navegar a ${label}.`);
  await delay(350);
}

async function installRecorder(session) {
  await session.evaluate(`(() => {
    window.__capabilityGateEvents = [];
    window.__capabilityGateDispose?.();
    window.__capabilityGateDispose = window.overlayBridge.onCodexEvent((event) => {
      window.__capabilityGateEvents.push({
        type: event.type,
        executionId: event.executionId ?? null,
        upstreamType: event.type === "codex.upstream" ? event.event?.type ?? null : null
      });
      window.__capabilityGateEvents = window.__capabilityGateEvents.slice(-1000);
    });
    return true;
  })()`);
}

async function submitPrompt(session, prompt) {
  await session.evaluate("window.__capabilityGateEvents = []; true");
  const submitted = await session.evaluate(`(() => {
    const input = document.querySelector("textarea");
    if (!(input instanceof HTMLTextAreaElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, ${JSON.stringify(prompt)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const button = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === "Start");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!submitted) throw new Error("No pude enviar el Turn desde el composer.");
  return waitFor(async () => {
    const events = await session.evaluate("window.__capabilityGateEvents ?? []");
    const terminal = events.findLast((event) => ["execution.completed", "execution.failed", "execution.cancelled"].includes(event.type));
    if (!terminal) return null;
    return {
      terminal: terminal.type,
      eventTypes: [...new Set(events.map((event) => event.type))],
      upstreamTypes: [...new Set(events.map((event) => event.upstreamType).filter(Boolean))]
    };
  }, timeoutMs, "El Turn real excedio el timeout");
}

async function run() {
  await access(appExecutable);
  const root = await mkdtemp(path.join(homedir(), ".cocreate-capability-gate-"));
  const projectDir = path.join(root, "project");
  const userDataDir = path.join(root, "user-data");
  await Promise.all([mkdir(projectDir, { recursive: true }), mkdir(userDataDir, { recursive: true })]);
  await writeFile(path.join(projectDir, "README.md"), "# Capability Gate\n");
  let processHandle = null;
  let session = null;
  let restartHandle = null;
  let restartSession = null;
  try {
    const port = 9700 + Math.floor(Math.random() * 150);
    processHandle = launchApp(userDataDir, port);
    session = await connectToRenderer(port);
    checkpoint("desktop-connected");
    const status = await waitFor(async () => {
      const current = await session.evaluate("window.overlayBridge.getCodexStatus()");
      return current?.available && current?.runtimeMode === "app-server" ? current : null;
    }, 60_000, "App Server no quedo ready");

    const discovery = await session.evaluate(`Promise.all([
      window.overlayBridge.getUpstreamCapabilities(),
      window.overlayBridge.listUpstreamPlanModes(),
      window.overlayBridge.listUpstreamExtensions(),
      window.overlayBridge.listCodexModels()
    ]).then(([snapshot, plans, extensions, models]) => ({ snapshot, plans, extensions, models }))`);
    if (!discovery.plans?.ok || !discovery.plans.data?.some((entry) => entry.mode === "plan")) {
      throw new Error(`Plan Mode no esta disponible: ${discovery.plans?.error ?? "sin preset plan"}`);
    }
    if (!discovery.extensions?.ok) throw new Error(discovery.extensions?.error ?? "No pude listar extensiones.");
    const skill = discovery.extensions.skills.data.find((entry) => entry.enabled && entry.token);
    if (!skill) throw new Error("No hay una Skill real habilitada y seleccionable.");
    checkpoint("upstream-discovery-completed");

    await session.evaluate(`window.overlayBridge.createWorkspaceProject(${JSON.stringify({ name: "Capability Gate Project", rootPath: projectDir })})`);
    await session.evaluate("location.reload(); true");
    await waitFor(() => session.evaluate("Boolean(window.overlayBridge && document.querySelector('.workspace-context'))"), 30_000, "La UI no restauro el Project");
    const primary = await createTaskFromUi(session, "Plan and Skill Gate");
    checkpoint("primary-task-created");

    await chooseSelect(session, "label.plan-selector select", "plan");
    await navigate(session, "Complementos");
    await waitFor(() => session.evaluate("Boolean(document.querySelector('.extension-card.selectable:not(:disabled)'))"), 20_000, "El catalogo no mostro Skills seleccionables");
    const selectedSkill = await session.evaluate(`(() => {
      const card = document.querySelector('.extension-card.selectable:not(:disabled)');
      if (!(card instanceof HTMLButtonElement)) return null;
      const name = card.querySelector("strong")?.textContent?.trim() ?? null;
      card.click();
      return name;
    })()`);
    await navigate(session, "Chat");
    await waitFor(() => session.evaluate("Boolean(document.querySelector('[aria-label=\"Skills preparadas para el siguiente Turn\"]'))"), 10_000, "La Skill no aparecio en el composer");
    checkpoint("plan-and-skill-selected");
    await installRecorder(session);
    const planTurn = await submitPrompt(session, "En modo Plan, crea un plan breve de tres pasos para mejorar este README. No edites archivos ni ejecutes comandos.");
    checkpoint("plan-turn-completed");
    let afterPlan;
    try {
      afterPlan = await session.evaluate(`(async () => ({
        bootstrap: await window.overlayBridge.getWorkspaceBootstrap(),
        selectedSkills: document.querySelectorAll('[aria-label="Skills preparadas para el siguiente Turn"] .attachment-chip').length,
        planValue: document.querySelector('label.plan-selector select')?.value ?? null
      }))()`);
    } catch (error) {
      throw new Error(`${error.message} Desktop exit=${JSON.stringify(processHandle.exit())} stderr=${processHandle.stderr().slice(-1200)}`);
    }

    const secondary = await createTaskFromUi(session, "Secondary Capability Gate");
    checkpoint("secondary-task-created");
    const secondaryPlan = await waitFor(
      () => session.evaluate("document.querySelector('label.plan-selector select')?.value === 'default' ? 'default' : null"),
      20_000,
      "La Task secundaria no convergio a Default"
    );
    await session.evaluate(`window.overlayBridge.openWorkspaceTask(${JSON.stringify({ taskId: primary.task.id })})`);
    await session.evaluate("location.reload(); true");
    await waitFor(async () => (await session.evaluate("window.overlayBridge.getWorkspaceBootstrap()"))?.task?.id === primary.task.id, 20_000, "No pude volver a la Task primaria");
    const restoredBeforeRestart = await waitFor(() => session.evaluate("document.querySelector('label.plan-selector select')?.value === 'plan'"), 20_000, "Plan no se restauro despues del cambio de Task");
    checkpoint("primary-task-restored");

    await closeApp(session, processHandle);
    session = null;
    processHandle = null;
    restartHandle = launchApp(userDataDir, port + 200);
    restartSession = await connectToRenderer(port + 200);
    await waitFor(async () => (await restartSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()"))?.task?.id === primary.task.id, 30_000, "La Task primaria no se restauro al reiniciar");
    const planAfterRestart = await waitFor(() => restartSession.evaluate("document.querySelector('label.plan-selector select')?.value"), 20_000, "El selector Plan no cargo al reiniciar");
    checkpoint("desktop-restarted");
    await chooseSelect(restartSession, "label.plan-selector select", "default");
    await installRecorder(restartSession);
    const defaultTurn = await submitPrompt(restartSession, "Responde solamente: DEFAULT MODE OK. No uses herramientas ni modifiques archivos.");
    checkpoint("default-turn-completed");
    let finalBootstrap;
    try {
      finalBootstrap = await waitFor(async () => {
        const bootstrap = await restartSession.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
        return bootstrap?.task?.metadata?.assistantPreferences?.planModeEnabled === false ? bootstrap : null;
      }, 20_000, "La preferencia Default no convergio despues del Turn");
    } catch (error) {
      const diagnostics = await restartSession.evaluate(`(async () => ({
        selectValue: document.querySelector('label.plan-selector select')?.value ?? null,
        bootstrap: await window.overlayBridge.getWorkspaceBootstrap(),
        bodyTail: document.body.innerText.slice(-2400)
      }))()`);
      await writeFile(evidencePath, `${JSON.stringify({ ok: false, error: error.message, diagnostics }, null, 2)}\n`);
      throw new Error(`${error.message} Diagnostics=${JSON.stringify(diagnostics)}`);
    }

    const mcp = discovery.extensions.mcp.data;
    const result = {
      ok: planTurn.terminal === "execution.completed" && defaultTurn.terminal === "execution.completed" &&
        afterPlan.planValue === "plan" && afterPlan.selectedSkills === 0 && secondaryPlan === "default" &&
        restoredBeforeRestart === true && planAfterRestart === "plan" &&
        finalBootstrap.task?.metadata?.assistantPreferences?.planModeEnabled === false && mcp.length > 0,
      codex: { version: status.version, runtimeMode: status.runtimeMode, available: status.available },
      plan: {
        catalogModes: discovery.plans.data.map((entry) => entry.mode),
        firstTurn: planTurn,
        restoredAfterTaskSwitch: restoredBeforeRestart === true,
        secondaryTaskDefault: secondaryPlan === "default",
        restoredAfterRestart: planAfterRestart === "plan",
        disabledForNextTurn: finalBootstrap.task?.metadata?.assistantPreferences?.planModeEnabled === false,
        defaultTurn
      },
      skills: {
        discovered: discovery.extensions.skills.data.length,
        selectedName: selectedSkill,
        tokenOpaque: typeof skill.token === "string" && !skill.token.includes("/") && !skill.token.includes("\\"),
        consumedAfterTurn: afterPlan.selectedSkills === 0
      },
      mcp: {
        count: mcp.length,
        ready: mcp.filter((entry) => entry.status === "ready").length,
        failed: mcp.filter((entry) => entry.status === "failed").length,
        unique: new Set(mcp.map((entry) => entry.id)).size === mcp.length,
        tools: mcp.reduce((total, entry) => total + entry.toolCount, 0),
        sanitized: mcp.every((entry) => !JSON.stringify(entry).match(/API_KEY|TOKEN=|SECRET=|\/Users\//i))
      },
      taskScope: { primaryTaskId: primary.task.id, secondaryTaskId: secondary.task.id },
      cleaned: true
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(evidencePath, serialized);
    process.stdout.write(serialized);
    checkpoint("evidence-written");
    if (!result.ok) process.exitCode = 1;
  } finally {
    if (session && processHandle) await closeApp(session, processHandle).catch(() => processHandle.child.kill("SIGTERM"));
    if (restartSession && restartHandle) await closeApp(restartSession, restartHandle).catch(() => restartHandle.child.kill("SIGTERM"));
    await rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
