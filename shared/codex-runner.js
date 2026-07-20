import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createCodexError,
  createExecutionId,
  createTimestamp,
  toCodexError
} from "./codex-contracts.js";

const execFileAsyncDefault = promisify(execFile);
const VALIDATED_CODEX_VERSION = "0.134.0";
const MINIMUM_SUPPORTED_CODEX_VERSION = "0.134.0";

function noop() {}

function normalizeVersion(rawVersion) {
  const match = String(rawVersion ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map((value) => Number(value));
  const rightParts = right.split(".").map((value) => Number(value));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function evaluateCompatibility(version) {
  if (!version) {
    return {
      compatible: false,
      message: `No pude determinar la versión de Codex. CoCreate Desktop valida ${VALIDATED_CODEX_VERSION} y requiere al menos ${MINIMUM_SUPPORTED_CODEX_VERSION}.`
    };
  }

  if (compareVersions(version, MINIMUM_SUPPORTED_CODEX_VERSION) < 0) {
    return {
      compatible: false,
      message: `La versión ${version} de Codex es incompatible. CoCreate Desktop valida ${VALIDATED_CODEX_VERSION} y requiere al menos ${MINIMUM_SUPPORTED_CODEX_VERSION}.`
    };
  }

  return {
    compatible: true,
    message: ""
  };
}

export async function resolveCodexStatus(options = {}) {
  const binary = options.binary ?? process.env.CODEX_BINARY ?? "codex";
  const execFileAsync = options.execFileAsync ?? execFileAsyncDefault;

  try {
    const { stdout, stderr } = await execFileAsync(binary, ["--version"], {
      timeout: 5000
    });
    const versionText = (stdout || stderr).trim() || "installed";
    const normalizedVersion = normalizeVersion(versionText);
    const compatibility = evaluateCompatibility(normalizedVersion);

    return {
      available: compatibility.compatible,
      binary,
      version: versionText,
      compatible: compatibility.compatible,
      validatedVersion: VALIDATED_CODEX_VERSION,
      minimumSupportedVersion: MINIMUM_SUPPORTED_CODEX_VERSION,
      license: "Apache-2.0",
      source: "https://github.com/openai/codex",
      mode: "cli-upstream",
      error: compatibility.compatible ? undefined : compatibility.message,
      updatedAt: createTimestamp()
    };
  } catch (error) {
    const codexError = toCodexError(error, "CODEX_UNAVAILABLE");
    return {
      available: false,
      binary,
      version: null,
      compatible: false,
      validatedVersion: VALIDATED_CODEX_VERSION,
      minimumSupportedVersion: MINIMUM_SUPPORTED_CODEX_VERSION,
      license: "Apache-2.0",
      source: "https://github.com/openai/codex",
      mode: "cli-upstream",
      error: codexError.safeMessage,
      updatedAt: createTimestamp()
    };
  }
}

export function createNodeCodexAdapter(options = {}) {
  const binary = options.binary ?? process.env.CODEX_BINARY ?? "codex";
  const baseCwd = options.cwd ?? process.cwd();
  const defaultOrigin = options.defaultOrigin ?? "legacy-bridge";
  const defaultTimeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  // Sandbox mode for `codex exec`. On Windows the OS-level `workspace-write`
  // sandbox silently degrades to read-only (its helper isn't active), so Codex
  // can read but never write files. Set CODEX_SANDBOX_MODE=danger-full-access
  // to let Codex actually create/modify files in the selected folder.
  const sandboxMode = options.sandboxMode ?? process.env.CODEX_SANDBOX_MODE ?? "workspace-write";
  const spawnFactory = options.spawnFactory ?? spawn;
  const execFileAsync = options.execFileAsync ?? execFileAsyncDefault;
  const activeExecutions = new Map();

  async function getStatus() {
    return resolveCodexStatus({
      ...options,
      binary,
      execFileAsync
    });
  }

  async function execute(request, observer) {
    const prompt = typeof request?.prompt === "string" ? request.prompt.trim() : "";
    if (!prompt) {
      throw createCodexError("INVALID_PAYLOAD", "Missing prompt for Codex execution.", {
        safeMessage: "No hay prompt para ejecutar en Codex."
      });
    }

    const executionId = request.executionId?.trim() || createExecutionId();
    if (activeExecutions.has(executionId)) {
      throw createCodexError("INVALID_PAYLOAD", `Duplicate execution id: ${executionId}`, {
        safeMessage: "Ya existe una ejecución activa con ese identificador."
      });
    }

    const cwd = request.cwd?.trim() || baseCwd;
    const origin = request.origin ?? defaultOrigin;
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
    const ownerId = request.ownerId?.trim() || null;
    const model = typeof request.metadata?.model === "string" ? request.metadata.model.trim() : "";
    const effort = typeof request.metadata?.effort === "string" ? request.metadata.effort.trim() : "";
    const runDir = await mkdtemp(path.join(tmpdir(), "cocreate-codex-"));
    const lastMessagePath = path.join(runDir, "last-message.txt");

    let stdout = "";
    let stderr = "";
    let finished = false;
    let cancelled = false;
    let timeoutTriggered = false;
    let cancelReason = "";
    let timeoutId = null;
    let child = null;

    const emit = async (event) => {
      await Promise.resolve(observer?.(event));
    };

    const cleanup = async () => {
      activeExecutions.delete(executionId);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      await rm(runDir, { recursive: true, force: true }).catch(noop);
    };

    let resolveCompleted;
    const completed = new Promise((resolve) => {
      resolveCompleted = resolve;
    });

    const finalizeTerminalEvent = async (event) => {
      if (finished) {
        return;
      }

      finished = true;
      await emit(event);
      await cleanup();
      resolveCompleted(event);
    };

    const cancel = async (reason = "user-requested") => {
      if (finished) {
        return {
          ok: true,
          executionId,
          alreadyTerminated: true
        };
      }

      cancelled = true;
      cancelReason = reason;
      if (!child) {
        return {
          ok: true,
          executionId,
          alreadyTerminated: false
        };
      }

      const signalled = child.kill("SIGTERM");
      if (!signalled) {
        const cancellationError = createCodexError("UNKNOWN", `No pude enviar SIGTERM a la ejecución ${executionId}.`, {
          safeMessage: "No pude cancelar la ejecución activa."
        });
        await finalizeTerminalEvent({
          type: "execution.failed",
          executionId,
          timestamp: createTimestamp(),
          stage: "failed",
          error: cancellationError,
          diagnostics: stderr.trim() || stdout.trim() || undefined
        });
        throw cancellationError;
      }
      return {
        ok: true,
        executionId,
        alreadyTerminated: false
      };
    };

    activeExecutions.set(executionId, {
      cancel,
      ownerId
    });

    await emit({
      type: "execution.started",
      executionId,
      timestamp: createTimestamp(),
      stage: "starting",
      origin,
      promptPreview: prompt.slice(0, 280)
    });

    await emit({
      type: "execution.progress",
      executionId,
      timestamp: createTimestamp(),
      stage: "starting",
      message: "Inicializando ejecución de Codex."
    });

    const execArgs = ["exec", "--cd", cwd, "--sandbox", sandboxMode];
    if (model) {
      execArgs.push("--model", model);
    }
    if (effort) {
      // Config override; codex parses the value as TOML, falling back to a literal string.
      execArgs.push("-c", `model_reasoning_effort="${effort}"`);
    }
    execArgs.push("--output-last-message", lastMessagePath, "-");

    child = spawnFactory(binary, execArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      child?.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      void emit({
        type: "execution.output",
        executionId,
        timestamp: createTimestamp(),
        stage: "running",
        stream: "stdout",
        chunk: text
      });
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      void emit({
        type: "execution.progress",
        executionId,
        timestamp: createTimestamp(),
        stage: "running",
        message: text.trim() || "Codex reportó progreso."
      });
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      const codexError = toCodexError(error, "UNKNOWN");
      const event = {
        type: "execution.failed",
        executionId,
        timestamp: createTimestamp(),
        stage: "failed",
        error: codexError,
        diagnostics: stderr.trim() || stdout.trim() || undefined
      };

      void finalizeTerminalEvent(event);
    });

    child.on("close", async (code) => {
      if (finished) {
        return;
      }

      const diagnostics = stderr.trim() || undefined;
      const output = stdout.trim();

      if (cancelled) {
        const cancelledEvent = {
          type: "execution.cancelled",
          executionId,
          timestamp: createTimestamp(),
          stage: "cancelled",
          reason: cancelReason || "cancelled",
          output: output || undefined
        };
        await finalizeTerminalEvent(cancelledEvent);
        return;
      }

      if (timeoutTriggered) {
        const timeoutError = createCodexError("TIMEOUT", "Codex execution timed out.", {
          safeMessage: "Codex tardó demasiado y la ejecución fue detenida.",
          retriable: true,
          details: {
            timeoutMs
          }
        });
        const timeoutEvent = {
          type: "execution.failed",
          executionId,
          timestamp: createTimestamp(),
          stage: "failed",
          error: timeoutError,
          diagnostics
        };
        await finalizeTerminalEvent(timeoutEvent);
        return;
      }

      if (code === 0) {
        const lastMessage = await readFile(lastMessagePath, "utf8")
          .then((value) => value.trim())
          .catch(() => "");
        const finalOutput = lastMessage || output || diagnostics || "Codex terminó sin salida.";
        const completedEvent = {
          type: "execution.completed",
          executionId,
          timestamp: createTimestamp(),
          stage: "completed",
          output: finalOutput,
          exitCode: 0,
          diagnostics
        };
        await emit({
          type: "execution.progress",
          executionId,
          timestamp: createTimestamp(),
          stage: "completed",
          message: "Codex terminó la ejecución."
        });
        await finalizeTerminalEvent(completedEvent);
        return;
      }

      const exitError = createCodexError("PROCESS_EXITED", diagnostics || output || `Codex terminó con código ${code}.`, {
        safeMessage: "Codex terminó inesperadamente.",
        details: {
          exitCode: code
        }
      });
      const failedEvent = {
        type: "execution.failed",
        executionId,
        timestamp: createTimestamp(),
        stage: "failed",
        error: exitError,
        diagnostics
      };
      await finalizeTerminalEvent(failedEvent);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    return {
      executionId,
      completed,
      cancel
    };
  }

  async function cancelExecution(request) {
    const active = activeExecutions.get(request.executionId);
    if (!active) {
      return {
        ok: true,
        executionId: request.executionId,
        alreadyTerminated: true
      };
    }

    return active.cancel(request.reason);
  }

  async function dispose() {
    const cancellations = Array.from(activeExecutions.entries()).map(([executionId, handle]) =>
      handle.cancel(`dispose:${executionId}`)
    );
    await Promise.allSettled(cancellations);
  }

  return {
    getStatus,
    execute,
    cancelExecution,
    dispose
  };
}

export async function collectExecutionOutput(adapter, request, observer) {
  const chunks = [];
  const handle = await adapter.execute(request, async (event) => {
    if (event.type === "execution.output") {
      chunks.push(event.chunk);
    }
    await observer?.(event);
  });

  const terminalEvent = await handle.completed;
  if (terminalEvent.type === "execution.completed") {
    return {
      ok: true,
      output: terminalEvent.output || chunks.join(""),
      executionId: handle.executionId,
      diagnostics: terminalEvent.diagnostics
    };
  }

  if (terminalEvent.type === "execution.cancelled") {
    throw createCodexError("CANCELLED", terminalEvent.reason || "Execution cancelled.", {
      safeMessage: "La ejecución fue cancelada."
    });
  }

  throw terminalEvent.error;
}

export async function cancelActiveExecution(adapter, request) {
  return adapter.cancelExecution(request);
}

export function getCodexCompatibilityPolicy() {
  return {
    validatedVersion: VALIDATED_CODEX_VERSION,
    minimumSupportedVersion: MINIMUM_SUPPORTED_CODEX_VERSION,
    distribution: "external-binary-required"
  };
}
