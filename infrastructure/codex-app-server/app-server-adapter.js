import { createExecutionId, createTimestamp, createCodexError } from "../../shared/codex-contracts.js";
import path from "node:path";
import {
  CODEX_UPSTREAM_PROTOCOL_VERSION,
  CODEX_UPSTREAM_VALIDATED_VERSION,
  createCodexUpstreamEvent,
  createCodexUpstreamError,
  redactCodexDiagnostic,
  toCodexUpstreamError
} from "../../shared/codex-upstream-contracts.js";
import { CoCreateCodexClient } from "./cocreate-codex-client.js";

const TERMINAL_METHOD = "turn/completed";
const LIVE_APPROVAL_POLICY = Object.freeze({
  granular: {
    mcp_elicitations: true,
    rules: true,
    sandbox_approval: true,
    request_permissions: true,
    skill_approval: true
  }
});

function isWithinRoot(candidate, roots) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return false;
  return roots.some((root) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function sanitizeLivePermissions(value, roots) {
  const fileSystem = value?.fileSystem && typeof value.fileSystem === "object" ? value.fileSystem : {};
  const entries = Array.isArray(fileSystem.entries)
    ? fileSystem.entries.filter((entry) => {
        if (entry?.access !== "write") return false;
        if (entry.path?.type === "special") return entry.path.value?.kind === "project_roots";
        return entry.path?.type === "path" && isWithinRoot(entry.path.path, roots);
      })
    : [];
  for (const writablePath of Array.isArray(fileSystem.write) ? fileSystem.write : []) {
    if (!isWithinRoot(writablePath, roots)) continue;
    entries.push({ access: "write", path: { type: "path", path: writablePath } });
  }
  return {
    fileSystem: entries.length ? { entries } : null,
    network: { enabled: false }
  };
}

function hasLiveWritePermission(permissions) {
  return Boolean(permissions?.fileSystem?.entries?.some((entry) => entry.access === "write"));
}

function toLegacyError(cause) {
  const error = toCodexUpstreamError(cause);
  const code = error.code === "CODEX_APP_SERVER_TIMEOUT"
    ? "TIMEOUT"
    : error.code === "CODEX_APP_SERVER_UNAVAILABLE" || error.code === "CODEX_APP_SERVER_INCOMPATIBLE"
      ? "CODEX_UNAVAILABLE"
      : error.code === "CODEX_APP_SERVER_CLOSED"
        ? "PROCESS_EXITED"
        : "UNKNOWN";
  return createCodexError(code, error.message, {
    safeMessage: error.safeMessage,
    retriable: error.retriable,
    details: { upstreamCode: error.code }
  });
}

function terminalOutput(turn, streamedOutput) {
  if (streamedOutput.trim()) return streamedOutput;
  const messages = Array.isArray(turn?.items)
    ? turn.items.filter((item) => item?.type === "agentMessage" && typeof item.text === "string")
    : [];
  return messages.map((item) => item.text).join("\n").trim();
}

function isStaleThreadError(cause) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /thread.+(not found|missing|unknown)|rollout.+not found/i.test(message);
}

function sanitizeItem(item) {
  if (!item || typeof item !== "object") return {};
  switch (item.type) {
    case "commandExecution":
      return {
        itemType: item.type,
        itemId: item.id,
        command: redactCodexDiagnostic(item.command, 500),
        status: item.status,
        exitCode: item.exitCode,
        durationMs: item.durationMs
      };
    case "fileChange":
      return { itemType: item.type, itemId: item.id, status: item.status, changes: item.changes ?? [] };
    case "mcpToolCall":
      return {
        itemType: item.type,
        itemId: item.id,
        server: item.server,
        tool: item.tool,
        status: item.status,
        durationMs: item.durationMs,
        error: item.error ? { message: redactCodexDiagnostic(item.error.message ?? "MCP tool failed.", 1_000) } : null
      };
    case "webSearch":
      return {
        itemType: item.type,
        itemId: item.id,
        query: redactCodexDiagnostic(item.query, 500),
        action: item.action ?? null
      };
    case "dynamicToolCall":
      return {
        itemType: item.type,
        itemId: item.id,
        tool: redactCodexDiagnostic(item.tool, 200),
        namespace: redactCodexDiagnostic(item.namespace, 200),
        status: item.status,
        durationMs: item.durationMs
      };
    default:
      return { itemType: item.type ?? "unknown", itemId: item.id ?? null };
  }
}

function mapItemEvent(method, item) {
  const phase = method === "item/started" ? "started" : "completed";
  const prefix = item?.type === "commandExecution"
    ? "command"
    : item?.type === "fileChange"
      ? "fileChange"
      : item?.type === "mcpToolCall"
        ? "mcp"
        : item?.type === "webSearch"
          ? "webSearch"
          : "item";
  return `${prefix}.${phase}`;
}

export function createCodexAppServerAdapter(options = {}) {
  if (!options.processManager) {
    throw new TypeError("createCodexAppServerAdapter requires a process manager.");
  }
  const client = options.client ?? new CoCreateCodexClient({ processManager: options.processManager });
  const defaultCwd = options.cwd ?? process.cwd();
  const defaultTimeoutMs = options.timeoutMs ?? 10 * 60 * 1_000;
  const activeExecutions = new Map();
  const turnExecutions = new Map();

  const turnKey = (threadId, turnId) => `${threadId}:${turnId}`;

  function publishActivityCounts() {
    const active = Array.from(activeExecutions.values()).filter((entry) => !entry.finished);
    options.processManager.setActivityCounts?.({
      threads: new Set(active.map((entry) => entry.threadId).filter(Boolean)).size,
      turns: active.filter((entry) => entry.turnId).length
    });
  }

  async function emit(state, event) {
    state.emitQueue = state.emitQueue.then(() => Promise.resolve(state.observer?.(event))).catch(() => undefined);
    await state.emitQueue;
  }

  function findState(params = {}) {
    const resolvedTurnId = params.turnId ?? params.turn?.id ?? null;
    if (params.threadId && resolvedTurnId) {
      const executionId = turnExecutions.get(turnKey(params.threadId, resolvedTurnId));
      if (executionId) return activeExecutions.get(executionId) ?? null;
    }
    if (params.threadId) {
      return Array.from(activeExecutions.values()).find((entry) => entry.threadId === params.threadId && !entry.finished) ?? null;
    }
    return null;
  }

  async function emitUpstream(state, type, data = {}) {
    const upstreamEvent = createCodexUpstreamEvent(type, {
      executionId: state.executionId,
      codexThreadId: state.threadId,
      codexTurnId: state.turnId,
      data
    });
    await emit(state, {
      type: "codex.upstream",
      executionId: state.executionId,
      timestamp: upstreamEvent.timestamp,
      stage: "running",
      event: upstreamEvent
    });
  }

  async function finalize(state, event) {
    if (state.finished) return;
    state.finished = true;
    if (state.timeoutId) clearTimeout(state.timeoutId);
    activeExecutions.delete(state.executionId);
    if (state.threadId && state.turnId) turnExecutions.delete(turnKey(state.threadId, state.turnId));
    await emit(state, event);
    state.resolveCompleted(event);
    publishActivityCounts();
  }

  async function handleNotification(notification) {
    const params = notification?.params ?? {};
    const state = findState(params);
    if (!state) return;

    if (notification.method === "turn/started" && params.turn?.id) {
      state.turnId = params.turn.id;
      turnExecutions.set(turnKey(state.threadId, state.turnId), state.executionId);
      publishActivityCounts();
      await emitUpstream(state, "turn.started", { status: params.turn.status });
      return;
    }

    if (notification.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      state.output += params.delta;
      await emit(state, {
        type: "execution.output",
        executionId: state.executionId,
        timestamp: createTimestamp(),
        stage: "running",
        stream: "stdout",
        chunk: params.delta
      });
      return;
    }

    if (notification.method === "item/commandExecution/outputDelta" && typeof params.delta === "string") {
      await emitUpstream(state, "command.output", { itemId: params.itemId ?? null });
      return;
    }

    if (notification.method === "turn/diff/updated") {
      state.latestDiff = redactCodexDiagnostic(params.diff, 1_000_000);
      await emitUpstream(state, "diff.updated", { diff: state.latestDiff });
      return;
    }

    if (notification.method === "turn/plan/updated") {
      await emitUpstream(state, "plan.updated", {
        explanation: params.explanation ? redactCodexDiagnostic(params.explanation, 1_000) : null,
        plan: Array.isArray(params.plan) ? params.plan.slice(0, 100) : []
      });
      return;
    }

    if (notification.method === "item/plan/delta" || notification.method === "item/reasoning/summaryTextDelta") {
      const type = notification.method === "item/plan/delta" ? "plan.delta" : "reasoning.summaryDelta";
      await emitUpstream(state, type, {
        itemId: params.itemId ?? null,
        delta: typeof params.delta === "string" ? redactCodexDiagnostic(params.delta, 16_384) : "",
        summaryIndex: params.summaryIndex ?? null
      });
      return;
    }

    if (notification.method === "item/fileChange/patchUpdated") {
      await emitUpstream(state, "fileChange.patchUpdated", {
        itemId: params.itemId ?? null,
        changes: Array.isArray(params.changes) ? params.changes.slice(0, 1_000) : []
      });
      return;
    }

    if (notification.method === "item/mcpToolCall/progress") {
      await emitUpstream(state, "mcp.progress", {
        itemId: params.itemId ?? null,
        message: typeof params.message === "string" ? redactCodexDiagnostic(params.message, 2_000) : ""
      });
      return;
    }

    if ((notification.method === "item/started" || notification.method === "item/completed") && params.item) {
      await emitUpstream(state, mapItemEvent(notification.method, params.item), sanitizeItem(params.item));
      return;
    }

    if (notification.method === "thread/tokenUsage/updated") {
      await emitUpstream(state, "usage.updated", { tokenUsage: params.tokenUsage ?? null });
      return;
    }

    if (notification.method === "thread/compacted") {
      await emitUpstream(state, "thread.compacted");
      return;
    }

    if (notification.method === "thread/status/changed") {
      await emitUpstream(state, "thread.statusChanged", { status: params.status ?? null });
      return;
    }

    if (notification.method === "warning") {
      await emitUpstream(state, "runtime.warning", {
        message: typeof params.message === "string"
          ? redactCodexDiagnostic(params.message, 4_000)
          : "Codex reported a warning."
      });
      return;
    }

    if (notification.method === "error") {
      await emitUpstream(state, "runtime.error", {
        willRetry: params.willRetry === true,
        message: redactCodexDiagnostic(params.error?.message ?? "Codex reported an error.", 4_000)
      });
      return;
    }

    if (notification.method === TERMINAL_METHOD) {
      const turn = params.turn ?? {};
      const output = terminalOutput(turn, state.output);
      await emitUpstream(state, "turn.completed", {
        status: turn.status ?? "completed",
        durationMs: Number.isFinite(turn.durationMs) ? turn.durationMs : null,
        error: turn.error
          ? { message: redactCodexDiagnostic(turn.error.message ?? "Codex turn failed.", 1_000) }
          : null
      });
      if (state.cancelled || turn.status === "interrupted") {
        await finalize(state, {
          type: "execution.cancelled",
          executionId: state.executionId,
          timestamp: createTimestamp(),
          stage: "cancelled",
          reason: state.cancelReason || "turn-interrupted",
          output
        });
      } else if (turn.status === "failed") {
        const cause = createCodexUpstreamError(
          "CODEX_APP_SERVER_PROTOCOL_ERROR",
          turn.error?.message ?? "Codex turn failed."
        );
        await finalize(state, {
          type: "execution.failed",
          executionId: state.executionId,
          timestamp: createTimestamp(),
          stage: "failed",
          error: toLegacyError(cause)
        });
      } else {
        await finalize(state, {
          type: "execution.completed",
          executionId: state.executionId,
          timestamp: createTimestamp(),
          stage: "completed",
          output,
          exitCode: 0
        });
      }
    }
  }

  async function handleServerRequest(request) {
    const params = request.params ?? {};
    const state = findState(params);
    if (state) {
      await emitUpstream(state, "approval.requested", {
        method: request.method,
        itemId: params.itemId ?? null,
        command: params.command ? redactCodexDiagnostic(params.command, 500) : null,
        reason: params.reason ? redactCodexDiagnostic(params.reason, 500) : null
      });
    }

    if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") {
      const approved = await options.requestApproval?.({
        kind: request.method.includes("commandExecution") ? "command" : "file-change",
        command: params.command ? redactCodexDiagnostic(params.command, 500) : null,
        cwd: params.cwd ? redactCodexDiagnostic(params.cwd, 1_000) : null,
        reason: params.reason ? redactCodexDiagnostic(params.reason, 500) : null,
        threadId: params.threadId ?? null,
        turnId: params.turnId ?? null,
        itemId: params.itemId ?? null
      });
      const decision = approved === true ? "accept" : "decline";
      if (state) await emitUpstream(state, "approval.resolved", { method: request.method, decision });
      return { decision };
    }

    if (request.method === "item/tool/requestUserInput") {
      return { answers: {} };
    }
    if (request.method === "mcpServer/elicitation/request") {
      return { action: "decline", content: null, _meta: null };
    }
    if (request.method === "item/permissions/requestApproval") {
      const permissions = sanitizeLivePermissions(params.permissions, state?.runtimeWorkspaceRoots ?? []);
      if (!state?.liveMode || !hasLiveWritePermission(permissions)) {
        if (state) await emitUpstream(state, "approval.resolved", { method: request.method, decision: "decline" });
        return { permissions: {}, scope: "turn", strictAutoReview: true };
      }
      const approved = await options.requestApproval?.({
        kind: "file-change",
        command: null,
        cwd: params.cwd ? redactCodexDiagnostic(params.cwd, 1_000) : null,
        reason: params.reason ? redactCodexDiagnostic(params.reason, 500) : "Codex solicita permiso para aplicar los Working Changes.",
        threadId: params.threadId ?? null,
        turnId: params.turnId ?? null,
        itemId: params.itemId ?? null
      });
      const decision = approved === true ? "accept" : "decline";
      if (state) await emitUpstream(state, "approval.resolved", { method: request.method, decision });
      return {
        permissions: approved === true ? permissions : {},
        scope: "turn",
        strictAutoReview: true
      };
    }
    throw createCodexUpstreamError("CODEX_APPROVAL_UNAVAILABLE", `Unsupported App Server request: ${request.method}`);
  }

  const unsubscribe = client.subscribe((notification) => {
    void handleNotification(notification).catch(() => undefined);
  });
  const unsubscribeLifecycle = options.processManager.subscribeLifecycle?.((event) => {
    if (event?.type !== "runtime.failed" && !event?.error) return;
    const cause = event.error ?? createCodexUpstreamError(
      "CODEX_APP_SERVER_CLOSED",
      "Codex App Server stopped during an active turn."
    );
    for (const state of activeExecutions.values()) {
      void finalize(state, {
        type: "execution.failed",
        executionId: state.executionId,
        timestamp: createTimestamp(),
        stage: "failed",
        error: toLegacyError(cause)
      });
    }
  }) ?? (() => undefined);
  client.setServerRequestHandler(handleServerRequest);

  async function getStatus() {
    try {
      const status = await client.getStatus();
      return {
        available: status.available,
        binary: status.binaryPath,
        version: status.codexVersion,
        compatible: status.compatibility === "compatible",
        validatedVersion: status.validatedVersion,
        minimumSupportedVersion: status.validatedVersion,
        license: "Apache-2.0",
        source: "https://github.com/openai/codex",
        mode: "app-server",
        runtimeMode: "app-server",
        appServer: status,
        error: status.lastError?.safeMessage,
        updatedAt: status.updatedAt
      };
    } catch (cause) {
      const error = toCodexUpstreamError(cause, "CODEX_APP_SERVER_UNAVAILABLE");
      const status = options.processManager.getStatus();
      return {
        available: false,
        binary: status.binaryPath,
        version: status.codexVersion,
        compatible: false,
        validatedVersion: CODEX_UPSTREAM_VALIDATED_VERSION,
        minimumSupportedVersion: CODEX_UPSTREAM_VALIDATED_VERSION,
        license: "Apache-2.0",
        source: "https://github.com/openai/codex",
        mode: "app-server",
        runtimeMode: "app-server",
        appServer: status,
        error: error.safeMessage,
        updatedAt: createTimestamp()
      };
    }
  }

  async function execute(request, observer) {
    const prompt = typeof request?.prompt === "string" ? request.prompt.trim() : "";
    if (!prompt) {
      throw createCodexError("INVALID_PAYLOAD", "Missing prompt for Codex execution.");
    }
    const executionId = request.executionId?.trim() || createExecutionId();
    if (activeExecutions.has(executionId)) {
      throw createCodexError("INVALID_PAYLOAD", `Duplicate execution id: ${executionId}`);
    }

    let resolveCompleted;
    const completed = new Promise((resolve) => { resolveCompleted = resolve; });
    const context = request.metadata?.workspaceContext ?? {};
    const cwd = request.cwd?.trim() || context.rootPath || defaultCwd;
    const runtimeWorkspaceRoots = [context.rootPath || cwd].filter(Boolean);
    const liveMode = request.metadata?.interactionMode === "live";
    const state = {
      executionId,
      observer,
      resolveCompleted,
      completed,
      threadId: null,
      turnId: null,
      output: "",
      latestDiff: "",
      liveMode,
      runtimeWorkspaceRoots,
      finished: false,
      cancelled: false,
      cancelReason: "",
      timeoutId: null,
      emitQueue: Promise.resolve()
    };
    activeExecutions.set(executionId, state);
    publishActivityCounts();

    await emit(state, {
      type: "execution.started",
      executionId,
      timestamp: createTimestamp(),
      stage: "starting",
      origin: request.origin,
      promptPreview: prompt.slice(0, 280)
    });

    try {
      await options.processManager.ensureReady();
      const approvalPolicy = liveMode ? LIVE_APPROVAL_POLICY : "on-request";
      const threadInput = {
        cwd,
        runtimeWorkspaceRoots,
        approvalPolicy,
        sandbox: liveMode ? "read-only" : "workspace-write",
        config: { web_search: options.webSearchMode ?? "live" }
      };
      const mappedThreadId = context.codexThreadId ?? request.metadata?.codexThreadId ?? null;
      let threadResponse;
      if (mappedThreadId) {
        try {
          threadResponse = await client.resumeThread(mappedThreadId, threadInput);
        } catch (cause) {
          if (!isStaleThreadError(cause)) throw cause;
          await emitUpstream(state, "thread.mappingStale", { previousThreadId: mappedThreadId });
          threadResponse = await client.createThread(threadInput);
        }
      } else {
        threadResponse = await client.createThread(threadInput);
      }
      state.threadId = threadResponse.thread.id;
      publishActivityCounts();
      if (!context.proposalWorkspace) {
        await options.persistThreadMapping?.({
          workspaceId: context.workspaceId ?? null,
          projectId: context.projectId ?? null,
          taskId: context.taskId ?? null,
          conversationId: context.conversationId ?? null,
          codexThreadId: state.threadId,
          codexRuntimeVersion: CODEX_UPSTREAM_VALIDATED_VERSION,
          codexProtocolVersion: CODEX_UPSTREAM_PROTOCOL_VERSION,
          mappedAt: createTimestamp()
        });
      }
      await emitUpstream(state, mappedThreadId === state.threadId ? "thread.resumed" : "thread.started", {
        conversationId: context.conversationId ?? null,
        model: threadResponse.model ?? null,
        provider: threadResponse.modelProvider ?? threadResponse.thread.modelProvider ?? null
      });

      const turnResponse = await client.startTurn(state.threadId, prompt, {
        cwd,
        runtimeWorkspaceRoots,
        approvalPolicy,
        clientMetadata: {
          cocreate_execution_id: executionId,
          cocreate_interaction_mode: request.metadata?.interactionMode === "proposal"
            ? "proposal"
            : request.metadata?.interactionMode === "live"
              ? "live"
              : "chat"
        },
        model: typeof request.metadata?.model === "string" ? request.metadata.model : null,
        effort: typeof request.metadata?.effort === "string" ? request.metadata.effort : null,
        collaborationMode: request.metadata?.collaborationMode ?? null,
        userInputs: Array.isArray(request.metadata?.upstreamInputs) ? request.metadata.upstreamInputs : []
      });
      state.turnId = turnResponse.turn.id;
      turnExecutions.set(turnKey(state.threadId, state.turnId), executionId);
      publishActivityCounts();
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      state.timeoutId = setTimeout(() => {
        state.cancelled = true;
        state.cancelReason = "timeout";
        void client.interruptTurn(state.threadId, state.turnId).catch(async (cause) => {
          await finalize(state, {
            type: "execution.failed",
            executionId,
            timestamp: createTimestamp(),
            stage: "failed",
            error: toLegacyError(cause)
          });
        });
      }, timeoutMs);
    } catch (cause) {
      await finalize(state, {
        type: "execution.failed",
        executionId,
        timestamp: createTimestamp(),
        stage: "failed",
        error: toLegacyError(cause)
      });
    }

    return {
      executionId,
      completed,
      cancel: (reason) => cancelExecution({ executionId, reason })
    };
  }

  async function cancelExecution(request) {
    const state = activeExecutions.get(request.executionId);
    if (!state || state.finished) {
      return { ok: true, executionId: request.executionId, alreadyTerminated: true };
    }
    state.cancelled = true;
    state.cancelReason = request.reason ?? "user-requested";
    if (state.threadId && state.turnId) {
      await client.interruptTurn(state.threadId, state.turnId);
    }
    return { ok: true, executionId: request.executionId, alreadyTerminated: false };
  }

  async function dispose() {
    unsubscribe();
    unsubscribeLifecycle();
    client.setServerRequestHandler(null);
    const cancellations = Array.from(activeExecutions.values()).map((state) =>
      cancelExecution({ executionId: state.executionId, reason: "runtime-disposed" }).catch(() => undefined)
    );
    await Promise.all(cancellations);
    await options.processManager.stop();
  }

  async function listModels() {
    const response = await client.listModels();
    return {
      data: Array.isArray(response?.data)
        ? response.data.filter((model) => model && model.hidden !== true).map((model) => ({
            id: String(model.id ?? model.model),
            model: String(model.model ?? model.id),
            displayName: String(model.displayName ?? model.model ?? model.id),
            description: typeof model.description === "string" ? model.description : "",
            isDefault: model.isDefault === true,
            inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities.filter((value) => typeof value === "string") : [],
            supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
              ? model.supportedReasoningEfforts.map((entry) => typeof entry === "string" ? entry : entry?.reasoningEffort).filter(Boolean)
              : [],
            defaultReasoningEffort: model.defaultReasoningEffort ?? null
          }))
        : []
    };
  }

  return { getStatus, execute, cancelExecution, listModels, dispose };
}
