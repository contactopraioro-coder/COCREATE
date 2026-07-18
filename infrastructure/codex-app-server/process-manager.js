import { execFile, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { promisify } from "node:util";
import {
  CODEX_UPSTREAM_PROTOCOL_VERSION,
  CODEX_UPSTREAM_VALIDATED_VERSION,
  createCodexUpstreamError,
  evaluateCodexUpstreamCompatibility,
  normalizeCodexVersion,
  redactCodexDiagnostic,
  toCodexUpstreamError
} from "../../shared/codex-upstream-contracts.js";
import { CodexAppServerJsonRpcClient } from "./json-rpc-client.js";
import { CODEX_APP_SERVER_PROTOCOL_MANIFEST } from "./protocol-manifest.js";

const execFileAsyncDefault = promisify(execFile);

function now() {
  return new Date().toISOString();
}

async function settlesBefore(promise, timeoutMs) {
  let timeoutId;
  let settled = false;
  await Promise.race([
    promise.then(() => { settled = true; }),
    new Promise((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
    })
  ]);
  clearTimeout(timeoutId);
  return settled;
}

export function createCodexAppServerProcessManager(options = {}) {
  const binary = options.binary ?? process.env.CODEX_BINARY ?? "codex";
  const cwd = options.cwd ?? process.cwd();
  const spawnFactory = options.spawnFactory ?? spawn;
  const execFileAsync = options.execFileAsync ?? execFileAsyncDefault;
  const restartLimit = options.restartLimit ?? 2;
  const restartBaseDelayMs = options.restartBaseDelayMs ?? 250;
  const shutdownGraceMs = options.shutdownGraceMs ?? 2_000;
  const webSearchMode = ["disabled", "cached", "live"].includes(options.webSearchMode)
    ? options.webSearchMode
    : "live";
  const events = new EventEmitter();

  let state = "stopped";
  let child = null;
  let client = null;
  let startPromise = null;
  let stopPromise = null;
  let restartTimer = null;
  let restartCount = 0;
  let consecutiveRestartAttempts = 0;
  let activeThreadCount = 0;
  let activeTurnCount = 0;
  let stopping = false;
  let initialized = false;
  let authenticated = false;
  let authMode = "unknown";
  let version = null;
  let compatibility = "binary-missing";
  let lastError = null;
  let configuredMcpServers = null;
  let serverRequestHandler = null;
  let stderrBuffer = "";

  function snapshot() {
    return {
      available: state === "ready" && initialized && authenticated && compatibility === "compatible",
      binaryFound: Boolean(version),
      binaryPath: binary,
      codexVersion: version,
      validatedVersion: CODEX_UPSTREAM_VALIDATED_VERSION,
      protocolVersion: CODEX_UPSTREAM_PROTOCOL_VERSION,
      compatibility,
      processState: state,
      initialized,
      authenticated,
      authMode,
      capabilities: { ...CODEX_APP_SERVER_PROTOCOL_MANIFEST.capabilities },
      webSearch: { supported: true, mode: webSearchMode },
      mcp: { supported: true, configuredServers: configuredMcpServers },
      activeThreads: options.getActiveThreadCount?.() ?? activeThreadCount,
      activeTurns: options.getActiveTurnCount?.() ?? activeTurnCount,
      restartCount,
      lastError,
      updatedAt: now()
    };
  }

  function setState(nextState, eventType = "runtime.state") {
    state = nextState;
    events.emit("lifecycle", { type: eventType, state: nextState, status: snapshot(), timestamp: now() });
  }

  async function probeBinary() {
    try {
      const { stdout, stderr } = await execFileAsync(binary, ["--version"], { timeout: 5_000 });
      version = normalizeCodexVersion(stdout || stderr);
      compatibility = evaluateCodexUpstreamCompatibility(version);
      if (compatibility !== "compatible") {
        throw createCodexUpstreamError(
          "CODEX_APP_SERVER_INCOMPATIBLE",
          `Codex ${version ?? "unknown"} does not match validated version ${CODEX_UPSTREAM_VALIDATED_VERSION}.`,
          { details: { version, validatedVersion: CODEX_UPSTREAM_VALIDATED_VERSION } }
        );
      }
      return version;
    } catch (cause) {
      const error = toCodexUpstreamError(cause, "CODEX_APP_SERVER_UNAVAILABLE");
      if (error.code !== "CODEX_APP_SERVER_INCOMPATIBLE") {
        compatibility = version ? "unsupported-version" : "binary-missing";
      }
      throw error;
    }
  }

  async function discoverRuntimeState() {
    const account = await client.request("account/read", { refreshToken: false }, { timeoutMs: 10_000 }).catch(() => null);
    const accountType = account?.account?.type;
    authenticated = Boolean(account?.account);
    authMode = accountType === "chatgpt" ? "chatgpt" : accountType === "apiKey" ? "api-key" : authenticated ? "unknown" : "none";

    const mcp = await client.request("mcpServerStatus/list", {}, { timeoutMs: 20_000 }).catch(() => null);
    const entries = Array.isArray(mcp?.data)
      ? mcp.data
      : Array.isArray(mcp?.servers)
        ? mcp.servers
        : Array.isArray(mcp)
          ? mcp
          : null;
    configuredMcpServers = entries ? entries.length : null;
  }

  async function start() {
    if (state === "ready" && client && child) return snapshot();
    if (startPromise) return startPromise;
    stopping = false;
    startPromise = (async () => {
      setState(restartCount ? "restarting" : "starting", restartCount ? "runtime.restarting" : "runtime.starting");
      try {
        await probeBinary();
        child = spawnFactory(binary, ["app-server", "--listen", "stdio://"], {
          cwd,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
          detached: false
        });
        if (!child?.stdin || !child?.stdout || !child?.stderr) {
          throw createCodexUpstreamError("CODEX_APP_SERVER_INITIALIZATION_FAILED", "App Server process streams are unavailable.");
        }

        setState("initializing", "runtime.initializing");
        stderrBuffer = "";
        child.stderr.on("data", (chunk) => {
          stderrBuffer = `${stderrBuffer}${redactCodexDiagnostic(chunk)}`.slice(-16_384);
        });
        client = new CodexAppServerJsonRpcClient({
          readable: child.stdout,
          writable: child.stdin,
          requestTimeoutMs: options.requestTimeoutMs,
          maxMessageBytes: options.maxMessageBytes,
          onDiagnostic: (diagnostic) => events.emit("diagnostic", diagnostic)
        });
        client.setServerRequestHandler((request) => {
          if (!serverRequestHandler) {
            throw createCodexUpstreamError("CODEX_APPROVAL_UNAVAILABLE", `No handler for ${request.method}.`);
          }
          return serverRequestHandler(request);
        });
        client.subscribe((notification) => events.emit("notification", notification));
        client.subscribeUnknown((unknown) => events.emit("unknown", unknown));

        const spawnedChild = child;
        child.once("error", (cause) => handleUnexpectedExit(spawnedChild, null, cause));
        child.once("close", (code, signal) => handleUnexpectedExit(spawnedChild, code, null, signal));

        const initializedResponse = await client.request("initialize", {
          clientInfo: {
            name: "cocreate-desktop",
            title: "CoCreate Desktop",
            version: options.clientVersion ?? "0.0.1"
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false
          }
        }, { timeoutMs: options.initializeTimeoutMs ?? 20_000 });
        if (!initializedResponse?.userAgent || typeof initializedResponse?.platformFamily !== "string") {
          throw createCodexUpstreamError(
            "CODEX_APP_SERVER_INITIALIZATION_FAILED",
            "App Server initialize response is incompatible."
          );
        }
        await client.notify("initialized");
        initialized = true;
        await discoverRuntimeState();
        lastError = null;
        consecutiveRestartAttempts = 0;
        setState("ready", "runtime.ready");
        return snapshot();
      } catch (cause) {
        const error = toCodexUpstreamError(cause, "CODEX_APP_SERVER_INITIALIZATION_FAILED");
        lastError = { code: error.code, safeMessage: error.safeMessage };
        compatibility = error.code === "CODEX_APP_SERVER_INCOMPATIBLE"
          ? "unsupported-version"
          : compatibility === "binary-missing"
            ? "binary-missing"
            : "initialization-failed";
        initialized = false;
        setState("failed", "runtime.failed");
        await stopProcessOnly();
        throw error;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  function handleUnexpectedExit(exitedChild, code, cause, signal = null) {
    if (child !== exitedChild) return;
    client?.dispose("process-exit");
    client = null;
    child = null;
    initialized = false;
    if (stopping) return;
    const error = toCodexUpstreamError(
      cause ?? new Error(`Codex App Server exited with code ${code ?? "null"} signal ${signal ?? "none"}.`),
      "CODEX_APP_SERVER_CLOSED"
    );
    lastError = { code: error.code, safeMessage: error.safeMessage };
    setState("degraded", "runtime.failed");
    events.emit("exit", { code, signal, error, timestamp: now() });
    if (consecutiveRestartAttempts >= restartLimit || restartTimer) {
      setState("failed", "runtime.failed");
      return;
    }
    consecutiveRestartAttempts += 1;
    restartCount += 1;
    setState("restarting", "runtime.restarting");
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void start().catch(() => undefined);
    }, restartBaseDelayMs * consecutiveRestartAttempts);
  }

  async function stopProcessOnly() {
    const currentClient = client;
    const currentChild = child;
    client = null;
    child = null;
    currentClient?.dispose("process-stop");
    if (!currentChild || currentChild.exitCode != null) return;
    const closePromise = once(currentChild, "close").catch(() => []);
    currentChild.kill("SIGTERM");
    const closed = await settlesBefore(closePromise, shutdownGraceMs);
    if (!closed) {
      currentChild.kill("SIGKILL");
      await settlesBefore(closePromise, shutdownGraceMs);
    }
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping = true;
      try {
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        setState("stopping", "runtime.stopping");
        await stopProcessOnly();
        initialized = false;
        authenticated = false;
        authMode = "unknown";
        setState("stopped", "runtime.stopped");
      } finally {
        stopping = false;
        stopPromise = null;
      }
    })();
    return stopPromise;
  }

  async function restart() {
    await stop();
    restartCount += 1;
    consecutiveRestartAttempts += 1;
    return start();
  }

  function setServerRequestHandler(handler) {
    serverRequestHandler = typeof handler === "function" ? handler : null;
    client?.setServerRequestHandler((request) => {
      if (!serverRequestHandler) {
        throw createCodexUpstreamError("CODEX_APPROVAL_UNAVAILABLE", `No handler for ${request.method}.`);
      }
      return serverRequestHandler(request);
    });
  }

  return {
    start,
    ensureReady: start,
    stop,
    restart,
    getStatus: snapshot,
    getClient() {
      if (!client || state !== "ready") {
        throw createCodexUpstreamError("CODEX_APP_SERVER_UNAVAILABLE", "Codex App Server is not ready.");
      }
      return client;
    },
    setServerRequestHandler,
    setActivityCounts(counts = {}) {
      activeThreadCount = Number.isFinite(counts.threads) ? Math.max(0, counts.threads) : activeThreadCount;
      activeTurnCount = Number.isFinite(counts.turns) ? Math.max(0, counts.turns) : activeTurnCount;
    },
    subscribe(listener) {
      events.on("notification", listener);
      return () => events.off("notification", listener);
    },
    subscribeLifecycle(listener) {
      events.on("lifecycle", listener);
      events.on("exit", listener);
      return () => {
        events.off("lifecycle", listener);
        events.off("exit", listener);
      };
    },
    subscribeUnknown(listener) {
      events.on("unknown", listener);
      return () => events.off("unknown", listener);
    }
  };
}
