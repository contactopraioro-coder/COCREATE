import { app, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";

const targetUrl = process.argv[2] ?? "http://127.0.0.1:5173";
const evidencePath = "/tmp/cocreate-feature-parity-v2-navigation.json";
const mobileScreenshotPath = "/tmp/cocreate-feature-parity-v2-navigation-mobile.png";

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(`(${source})()`, true);
}

async function waitFor(check, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check().catch(() => null);
    if (value) return value;
    await delay(150);
  }
  throw new Error(message);
}

async function clickRoute(window, label) {
  const clicked = await evaluate(window, `() => {
    const labelNode = Array.from(document.querySelectorAll('button span')).find((entry) => entry.textContent?.trim() === ${JSON.stringify(label)});
    const button = labelNode?.closest('button') ?? document.querySelector('button[title=${JSON.stringify(label)}]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.focus();
    button.click();
    return true;
  }`);
  if (!clicked) throw new Error(`No pude abrir ${label}.`);
  await delay(200);
  return evaluate(window, `() => ({
    active: Boolean(Array.from(document.querySelectorAll('button[aria-current="page"]')).find((entry) => entry.textContent?.includes(${JSON.stringify(label)}) || entry.title === ${JSON.stringify(label)})),
    heading: document.querySelector('.feature-route h1')?.textContent?.trim() ?? null,
    hasComposer: Boolean(document.querySelector('.composer-shell')),
    body: document.body.innerText
  })`);
}

app.commandLine.appendSwitch("disable-gpu");

async function run() {
  const consoleErrors = [];
  const window = new BrowserWindow({
    show: true,
    width: 1440,
    height: 960,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2 && !message.includes("Electron Security Warning")) consoleErrors.push(message.slice(0, 500));
  });
  try {
    await window.loadURL(targetUrl);
    await waitFor(() => evaluate(window, `() => Boolean(document.querySelector('.workspace-primary-nav, .workspace-sidebar-mini'))`), 15_000, "La navegacion Web no cargo");
    const labels = ["Nueva tarea", "Programados", "Complementos", "Sitios", "Pull requests", "Chat"];
    const routes = {};
    for (const label of labels) routes[label] = await clickRoute(window, label);

    await clickRoute(window, "Sitios");
    await clickRoute(window, "Pull requests");
    await evaluate(window, `() => { history.back(); return true; }`);
    const back = await waitFor(() => evaluate(window, `() => document.querySelector('.feature-route h1')?.textContent?.trim() === 'Sitios'`), 5_000, "Back no restauro Sitios");
    await evaluate(window, `() => { history.forward(); return true; }`);
    const forward = await waitFor(() => evaluate(window, `() => document.querySelector('.feature-route h1')?.textContent?.trim() === 'Pull requests'`), 5_000, "Forward no restauro Pull requests");
    await window.webContents.reload();
    const refresh = await waitFor(() => evaluate(window, `() => document.querySelector('.feature-route h1')?.textContent?.trim() === 'Pull requests'`), 10_000, "Refresh no restauro la ruta");

    await clickRoute(window, "Programados");
    const keyboardTarget = await evaluate(window, `() => {
      const node = Array.from(document.querySelectorAll('button span')).find((entry) => entry.textContent?.trim() === 'Complementos');
      const button = node?.closest('button');
      button?.focus();
      return button instanceof HTMLButtonElement;
    }`);
    if (keyboardTarget) {
      window.focus();
      window.webContents.focus();
      await delay(150);
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    }
    const keyboard = await waitFor(
      () => evaluate(window, `() => document.querySelector('.feature-route h1')?.textContent?.trim() === 'Complementos'`),
      5_000,
      "Enter no activo Complementos"
    ).catch(() => false);

    await clickRoute(window, "Chat");
    const composer = await evaluate(window, `() => ({
      modelAvailable: Boolean(document.querySelector('.composer-context-actions .model-selector select')),
      modelFallback: Boolean(document.querySelector('.model-unavailable')),
      plus: Boolean(document.querySelector('button[aria-label="Agregar contexto"]')),
      start: Boolean(Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === 'Start')),
      planHonest: document.body.innerText.includes('Plan no disponible'),
      contextText: document.querySelector('.workspace-context')?.innerText ?? '',
      exposesHierarchy: ['Workspace', 'Project', 'Task', 'Conversation', 'Thread', 'Capability'].every((label) => document.querySelector('.workspace-context')?.innerText.includes(label))
    })`);

    const dateTimeStarted = await evaluate(window, `() => {
      const input = document.querySelector('textarea');
      if (!(input instanceof HTMLTextAreaElement)) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, '¿Qué hora es?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const button = Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === 'Start');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    }`);
    const dateTime = dateTimeStarted ? await waitFor(() => evaluate(window, `() => {
      const messages = Array.from(document.querySelectorAll('.message-card, article')).map((entry) => entry.textContent?.trim()).filter(Boolean);
      const last = messages.at(-1) ?? '';
      return last.toLowerCase().includes('hora local verificada') ? last.slice(0, 500) : null;
    }`), 15_000, "DateTime no produjo una respuesta local verificable").catch(async () => ({
      unverified: true,
      diagnostic: await evaluate(window, `() => ({
        articles: Array.from(document.querySelectorAll('article')).slice(-4).map((entry) => entry.textContent?.trim().slice(0, 500)),
        bodyTail: document.body.innerText.slice(-1200)
      })`)
    })) : null;

    window.setBounds({ width: 390, height: 844 });
    await delay(350);
    const mobile = await evaluate(window, `() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      composer: Boolean(document.querySelector('.composer-shell')),
      context: Boolean(document.querySelector('.workspace-context'))
    })`);
    await writeFile(mobileScreenshotPath, (await window.webContents.capturePage()).toPNG());

    const honestStates = routes.Programados.body.includes("Unsupported") &&
      routes.Complementos.body.includes("Desktop only") && routes.Sitios.body.includes("Deferred") &&
      routes["Pull requests"].body.includes("Authentication required");
    const result = {
      ok: labels.every((label) => routes[label].active) && routes["Nueva tarea"].heading === "Nueva tarea" &&
        routes.Chat.hasComposer && honestStates && back && forward && refresh && keyboard &&
        (composer.modelAvailable || composer.modelFallback) && composer.plus && composer.start && composer.planHonest && !composer.exposesHierarchy &&
        typeof dateTime === "string" && !mobile.overflow && mobile.composer && consoleErrors.length === 0,
      routes: Object.fromEntries(labels.map((label) => [label, { active: routes[label].active, heading: routes[label].heading, composer: routes[label].hasComposer }])),
      history: { back, forward, refresh },
      keyboard,
      honestStates,
      composer,
      dateTime: { started: dateTimeStarted, verifiedLocalResponse: typeof dateTime === "string", ...(typeof dateTime === "object" ? dateTime : {}) },
      mobile,
      mobileScreenshotPath,
      consoleErrors
    };
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } finally {
    window.destroy();
    app.exit(process.exitCode ?? 0);
  }
}

app.whenReady().then(run).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  app.exit(1);
});
