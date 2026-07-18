import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);
const appExecutable = path.resolve("release/mac-arm64/CoCreate.app/Contents/MacOS/CoCreate");
const evidencePath = "/tmp/cocreate-feature-parity-v2-devices.json";
const skipPicker = process.env.COCREATE_DEVICE_GATE_SKIP_PICKER === "1";

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
      this.socket.addEventListener("error", () => reject(new Error("No pude conectar CDP.")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
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
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  }
  close() { this.socket.close(); }
}

function launchApp(userDataDir, port) {
  const child = spawn(appExecutable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_RUNTIME_MODE: "app-server",
      COCREATE_FEATURE_NATIVE_FILE_PICKER: "true",
      COCREATE_FEATURE_NATIVE_VOICE: "true"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-10_000); });
  return { child, stderr: () => stderr };
}

async function connect(port) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    return (await response.json()).find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl) ?? null;
  }, 30_000, "No aparecio el target Desktop");
  const session = await new CdpSession(target.webSocketDebuggerUrl).connect();
  await session.call("Runtime.enable");
  await waitFor(() => session.evaluate("Boolean(window.overlayBridge && document.querySelector('.composer-shell'))"), 30_000, "El composer no cargo");
  return session;
}

async function closeApp(session, handle) {
  await session.evaluate("void window.overlayBridge.closeApp(); true").catch(() => undefined);
  session.close();
  await Promise.race([
    new Promise((resolve) => handle.child.once("exit", resolve)),
    delay(10_000).then(() => handle.child.kill("SIGTERM"))
  ]);
}

async function runAppleScript(lines) {
  const args = lines.flatMap((line) => ["-e", line]);
  return execFileAsync("osascript", args, { timeout: 20_000 });
}

async function cancelNativeDialog() {
  await delay(900);
  await runAppleScript([
    'tell application "System Events"',
    'tell process "CoCreate"',
    'set frontmost to true',
    'key code 53',
    'end tell',
    'end tell'
  ]);
}

async function selectNativePath(filePath) {
  await delay(900);
  await runAppleScript([
    'tell application "System Events"',
    'tell process "CoCreate"',
    'set frontmost to true',
    'keystroke "g" using {command down, shift down}',
    'delay 0.4',
    `keystroke ${JSON.stringify(filePath)}`,
    'key code 36',
    'delay 0.7',
    'key code 36',
    'end tell',
    'end tell'
  ]);
}

async function clickAttachmentAction(session, label) {
  const opened = await session.evaluate(`(() => {
    const plus = document.querySelector('button[aria-label="Agregar contexto"]');
    if (!(plus instanceof HTMLButtonElement) || plus.disabled) return false;
    plus.click();
    return true;
  })()`);
  if (!opened) throw new Error("El menu de adjuntos no pudo abrirse.");
  await waitFor(() => session.evaluate(`Boolean(Array.from(document.querySelectorAll('[role="menuitem"]')).find((entry) => entry.textContent?.includes(${JSON.stringify(label)})))`), 5_000, "La accion de adjunto no aparecio");
  return session.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[role="menuitem"]')).find((entry) => entry.textContent?.includes(${JSON.stringify(label)}));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

async function attachmentNames(session) {
  return session.evaluate("Array.from(document.querySelectorAll('.attachment-tray .attachment-chip strong')).map((entry) => entry.textContent?.trim()).filter(Boolean)");
}

async function removeAll(session) {
  await session.evaluate(`(() => {
    for (const button of document.querySelectorAll('.attachment-tray .attachment-chip button')) button.click();
    return true;
  })()`);
  await waitFor(async () => (await attachmentNames(session)).length === 0, 5_000, "Los adjuntos no se limpiaron");
}

async function performDrop(session, files) {
  const point = await session.evaluate(`(() => {
    const target = document.querySelector('.composer-shell');
    if (!(target instanceof HTMLElement)) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error("No encontre el drop zone.");
  const data = { items: [{ mimeType: "text/plain", data: "" }], files, dragOperationsMask: 1 };
  await session.call("Input.dispatchDragEvent", { type: "dragEnter", x: point.x, y: point.y, data });
  await session.call("Input.dispatchDragEvent", { type: "dragOver", x: point.x, y: point.y, data });
  await session.call("Input.dispatchDragEvent", { type: "drop", x: point.x, y: point.y, data });
  await delay(800);
}

async function run() {
  await access(appExecutable);
  const root = await mkdtemp(path.join(homedir(), ".cocreate-device-gate-"));
  const projectDir = path.join(root, "project");
  const userDataDir = path.join(root, "user-data");
  await Promise.all([mkdir(projectDir, { recursive: true }), mkdir(userDataDir, { recursive: true })]);
  const validFile = path.join(projectDir, "device-gate.txt");
  const secondFile = path.join(projectDir, "device-gate.md");
  const imageFile = path.join(projectDir, "device-gate.png");
  const emptyFile = path.join(projectDir, "empty.txt");
  const invalidFile = path.join(projectDir, "unsupported.bin");
  await Promise.all([
    writeFile(validFile, "COCREATE DEVICE GATE MARKER\n"),
    writeFile(secondFile, "# Second attachment\n"),
    writeFile(imageFile, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")),
    writeFile(emptyFile, ""),
    writeFile(invalidFile, "not allowed")
  ]);

  let handle = null;
  let session = null;
  const result = {
    environment: "macOS packaged Desktop",
    voice: { executed: false, passed: false, blocked: false, reason: null, deviceCount: 0, builtInDetected: false },
    picker: { opened: false, cancelled: false, selected: false, multiple: false, image: false, blocked: false, reason: null },
    dragDrop: { executed: false, valid: false, multiple: false, invalidRejected: false, duplicatesPrevented: false, removed: false },
    security: { pathHidden: false },
    cleaned: false
  };
  try {
    const port = 10_100 + Math.floor(Math.random() * 120);
    handle = launchApp(userDataDir, port);
    session = await connect(port);
    await waitFor(async () => (await session.evaluate("window.overlayBridge.getCodexStatus()"))?.available, 60_000, "Codex no quedo disponible");
    await session.evaluate(`window.overlayBridge.createWorkspaceProject(${JSON.stringify({ name: "Device Gate Project", rootPath: projectDir })})`);
    const bootstrap = await session.evaluate("window.overlayBridge.getWorkspaceBootstrap()");
    await session.evaluate(`window.overlayBridge.createWorkspaceChat(${JSON.stringify({ projectId: null, title: "Device Gate Task" })})`.replace('"projectId":null', `"projectId":${JSON.stringify(bootstrap.project.id)}`));
    await session.evaluate("location.reload(); true");
    await waitFor(() => session.evaluate("Boolean(document.querySelector('.composer-shell'))"), 30_000, "El composer no se restauro");

    const voice = await session.evaluate(`(async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((entry) => entry.kind === "audioinput");
      const button = document.querySelector('button[aria-label*="nota de voz"], button[aria-label*="microfono"], button[aria-label*="micrófono"]');
      const status = await window.overlayBridge.getVoiceStatus();
      return {
        devices: devices.map((entry) => entry.label),
        buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : null,
        providerStatus: status?.status ?? null,
        providerMessage: status?.message ?? null
      };
    })()`);
    result.voice.deviceCount = voice.devices.length;
    result.voice.builtInDetected = voice.devices.some((label) => /built-in|macbook/i.test(label));
    result.voice.executed = !voice.buttonDisabled;
    result.voice.blocked = voice.buttonDisabled === true;
    result.voice.reason = voice.buttonDisabled ? voice.providerMessage ?? voice.providerStatus ?? "Voice disabled" : null;

    if (skipPicker) {
      result.picker.blocked = true;
      result.picker.reason = "Native picker interaction omitted after macOS Assistive Access did not close the dialog in the dedicated attempt.";
    } else try {
      result.picker.opened = await clickAttachmentAction(session, "Adjuntar archivo");
      await cancelNativeDialog();
      result.picker.cancelled = (await attachmentNames(session)).length === 0;

      await clickAttachmentAction(session, "Adjuntar archivo");
      await selectNativePath(validFile);
      result.picker.selected = await waitFor(async () => (await attachmentNames(session)).includes("device-gate.txt"), 10_000, "El archivo nativo no aparecio");
      result.security.pathHidden = !(await session.evaluate("document.body.innerText.includes('.cocreate-device-gate-')"));
      await removeAll(session);

      await clickAttachmentAction(session, "Adjuntar archivo");
      await selectNativePath(imageFile);
      result.picker.image = await waitFor(async () => (await attachmentNames(session)).includes("device-gate.png"), 10_000, "La imagen nativa no aparecio");
      await removeAll(session);
    } catch (error) {
      result.picker.blocked = true;
      result.picker.reason = error instanceof Error ? error.message.slice(0, 500) : "Native picker automation failed";
      await cancelNativeDialog().catch(() => undefined);
    }

    await performDrop(session, [validFile]);
    result.dragDrop.executed = true;
    result.dragDrop.valid = (await attachmentNames(session)).includes("device-gate.txt");
    await performDrop(session, [validFile, secondFile]);
    const multipleNames = await attachmentNames(session);
    result.dragDrop.multiple = multipleNames.includes("device-gate.txt") && multipleNames.includes("device-gate.md");
    result.dragDrop.duplicatesPrevented = multipleNames.filter((name) => name === "device-gate.txt").length === 1;
    await removeAll(session);
    result.dragDrop.removed = true;
    await performDrop(session, [emptyFile, invalidFile]);
    result.dragDrop.invalidRejected = (await attachmentNames(session)).length === 0;
    result.cleaned = true;
  } finally {
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
    if (session && handle) await closeApp(session, handle).catch(() => handle.child.kill("SIGTERM"));
    await rm(root, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.picker.blocked || !result.dragDrop.valid || !result.dragDrop.multiple) process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
