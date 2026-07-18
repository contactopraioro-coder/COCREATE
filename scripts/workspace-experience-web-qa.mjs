import { writeFile } from "node:fs/promises";
import { app, BrowserWindow } from "electron";

const targetUrl = process.argv[2] ?? "http://127.0.0.1:5173";
const desktopShot = process.argv[3] ?? "/tmp/cocreate-workspace-desktop.png";
const mobileShot = process.argv[4] ?? "/tmp/cocreate-workspace-mobile.png";
const loadTimeoutMs = 15_000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(`(${source})()`, true);
}

async function fillAndSubmit(window, label, value) {
  return evaluate(window, `() => {
    const input = document.querySelector('input[aria-label="${label}"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form?.requestSubmit();
    return true;
  }`);
}

app.commandLine.appendSwitch("disable-gpu");

async function main() {
  const consoleErrors = [];
  let step = "load";
  const window = new BrowserWindow({
  show: false,
  width: 1440,
  height: 960,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    partition: `cocreate-web-qa-${process.pid}`,
    backgroundThrottling: false
  }
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2 && !message.includes("Electron Security Warning (Insecure Content-Security-Policy)")) {
      consoleErrors.push({ level, message, line, sourceId });
    }
  });

  try {
  await Promise.race([
    window.loadURL(targetUrl),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out loading ${targetUrl}`)), loadTimeoutMs))
  ]);
  await wait(1_000);

  step = "initial-render";
  const initial = await evaluate(window, `() => ({
    hasContent: document.body.innerText.trim().length > 200,
    hasWorkspace: Boolean(document.querySelector('.workspace-context[aria-label="Conversación actual"]')),
    hasProject: Boolean(document.querySelector('.workspace-context-copy > span')?.textContent?.trim()),
    diagnosticsHidden: !document.body.innerText.includes("Codex App Server está disponible en Desktop"),
    errorOverlay: Boolean(document.querySelector("vite-error-overlay, .vite-error-overlay, [data-nextjs-dialog]")),
    viewport: { width: innerWidth, height: innerHeight },
    overflow: document.documentElement.scrollWidth > innerWidth
  })`);

  step = "workspace-context";
  const opened = await evaluate(window, `() => {
    const button = document.querySelector('button[aria-label="Administrar proyecto y tarea"]');
    button?.click();
    return Boolean(button);
  }`);
  await wait(150);

  const projectSubmitted = await fillAndSubmit(window, "Nombre del nuevo proyecto", "Project QA Web");
  await wait(250);
  const taskSubmitted = await fillAndSubmit(window, "Título de la nueva tarea", "Task QA Workspace");
  await wait(250);
  const conversationAdded = await evaluate(window, `() => {
    const button = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent?.trim().includes("Nueva conversación"));
    button?.click();
    return Boolean(button);
  }`);
  await wait(300);

  step = "workspace-state";
  const desktop = await evaluate(window, `() => {
    const raw = localStorage.getItem("cocreate-browser-workspace-v2");
    const state = raw ? JSON.parse(raw) : null;
    const activeTaskId = state?.task?.id ?? null;
    const contextButton = document.querySelector('button[aria-label="Administrar proyecto y tarea"]');
    contextButton?.focus();
    return {
      project: state?.project?.name ?? null,
      task: state?.task?.title ?? null,
      activeTaskConversationCount: state?.conversations?.filter((entry) => entry.taskId === activeTaskId).length ?? 0,
      activeProjectTaskCount: state?.tasks?.filter((entry) => entry.projectId === state?.project?.id).length ?? 0,
      rootPath: state?.project?.rootPath ?? null,
      contextVisible: Boolean(document.querySelector(".workspace-context-drawer")),
      workPanelVisible: Boolean(document.querySelector(".workspace-work-panel")),
      desktopOnlyVisible: document.body.innerText.includes("filesystem y Codex Thread local"),
      overflow: document.documentElement.scrollWidth > innerWidth,
      keyboardFocusVisible: document.activeElement === contextButton
    };
  }`);
  await evaluate(window, `() => {
    const button = document.querySelector('button[aria-label="Administrar proyecto y tarea"]');
    if (button?.getAttribute("aria-expanded") === "true") button.click();
    return true;
  }`);
  await wait(150);

  step = "live-mode";
  const liveOpened = await evaluate(window, `() => {
    const button = Array.from(document.querySelectorAll(".workspace-mode-switch button"))
      .find((entry) => entry.textContent?.trim() === "Live");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  }`);
  await wait(250);
  step = "proposal-mode";
  const proposalOpened = await evaluate(window, `() => {
    const button = Array.from(document.querySelectorAll(".visual-comparison-switch button"))
      .find((entry) => entry.textContent?.trim() === "Propuesta");
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  }`);
  await wait(250);
  step = "proposal-assertions";
  const proposalWeb = await evaluate(window, `() => ({
    liveVisible: Boolean(document.querySelector(".workspace-mode-layout.mode-live")),
    proposalVisible: Boolean(document.querySelector(".proposal-runtime-panel .proposal-unavailable")),
    desktopExplanation: document.querySelector(".proposal-unavailable")?.textContent?.includes("Desktop") ?? false,
    fakePreviewVisible: Boolean(document.querySelector(".proposal-live-preview iframe")),
    applyVisible: Array.from(document.querySelectorAll(".proposal-runtime-actions button"))
      .some((entry) => entry.textContent?.includes("Aplicar a Current")),
    localActivityVisible: Boolean(document.querySelector(".live-activity-panel")),
    overflow: document.documentElement.scrollWidth > innerWidth
  })`);
  await writeFile(desktopShot, (await window.webContents.capturePage()).toPNG());

  step = "mobile-render";
  window.setBounds({ width: 390, height: 844 });
  await wait(400);
  const mobile = await evaluate(window, `() => ({
    viewport: { width: innerWidth, height: innerHeight },
    overflow: document.documentElement.scrollWidth > innerWidth,
    contextVisible: Boolean(document.querySelector(".workspace-context")),
    workPanelVisible: Boolean(document.querySelector(".workspace-work-panel")),
    approvalActionsStackable: getComputedStyle(document.querySelector(".approval-actions") ?? document.body).display
  })`);
  await writeFile(mobileShot, (await window.webContents.capturePage()).toPNG());

  const result = {
    ok: initial.hasContent && initial.hasWorkspace && initial.hasProject && initial.diagnosticsHidden && !initial.errorOverlay &&
      opened && projectSubmitted && taskSubmitted && conversationAdded && desktop.project === "Project QA Web" &&
      desktop.task === "Task QA Workspace" && desktop.activeProjectTaskCount === 1 &&
      desktop.activeTaskConversationCount === 2 && desktop.rootPath === null && !desktop.overflow && !mobile.overflow &&
      desktop.keyboardFocusVisible && liveOpened && proposalOpened && proposalWeb.liveVisible && proposalWeb.proposalVisible &&
      proposalWeb.desktopExplanation && !proposalWeb.fakePreviewVisible && !proposalWeb.applyVisible &&
      !proposalWeb.localActivityVisible && !proposalWeb.overflow && consoleErrors.length === 0,
    initial,
    interactions: { opened, projectSubmitted, taskSubmitted, conversationAdded, liveOpened, proposalOpened },
    desktop,
    proposalWeb,
    mobile,
    consoleErrors,
    screenshots: { desktopShot, mobileShot }
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`[web-qa:${step}] ${error?.stack ?? error}\nConsole: ${JSON.stringify(consoleErrors.slice(-10))}\n`);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.exit(process.exitCode ?? 0);
  }
}

app.whenReady().then(main).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
});
