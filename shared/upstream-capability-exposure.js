import { redactCodexDiagnostic } from "./codex-upstream-contracts.js";

const CAPABILITY_DEFINITIONS = Object.freeze([
  { id: "streaming", label: "Streaming", upstreamKey: "streaming" },
  { id: "approvals", label: "Approvals", upstreamKey: "approvals" },
  { id: "diffs", label: "Diffs", upstreamKey: "diffs" },
  { id: "webSearch", label: "Web Search", upstreamKey: "webSearch" },
  { id: "mcp", label: "MCP", upstreamKey: "mcp" },
  { id: "planning", label: "Planning", upstreamKey: "plans" },
  { id: "commands", label: "Commands", upstreamKey: "commands" },
  { id: "usage", label: "Usage", upstreamKey: "usage" }
]);

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedString(value, limit = 2_000) {
  return typeof value === "string" ? redactCodexDiagnostic(value, limit) : "";
}

function toTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : new Date().toISOString();
}

function normalizeThreadStatus(value) {
  const type = typeof value === "string" ? value : value?.type;
  if (type === "active") return "Active";
  if (type === "idle") return "Idle";
  if (type === "notLoaded") return "Restored";
  if (type === "systemError") return "Failed";
  return "Unknown";
}

function normalizePlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan
    .slice(0, 100)
    .map((entry, index) => {
      const item = asRecord(entry);
      const text = boundedString(item.step ?? item.text ?? item.description, 500).trim();
      if (!text) return null;
      const rawStatus = String(item.status ?? "pending").toLowerCase();
      return {
        id: String(item.id ?? `plan-step-${index + 1}`),
        text,
        status: rawStatus.includes("complete")
          ? "completed"
          : rawStatus.includes("progress") || rawStatus.includes("running")
            ? "running"
            : "pending"
      };
    })
    .filter(Boolean);
}

function commandActivity(command) {
  const normalized = String(command ?? "").toLowerCase();
  if (/\b(test|vitest|jest|playwright|pytest|cargo test)\b/.test(normalized)) return "Executed tests";
  if (/\b(build|compile|tsc)\b/.test(normalized)) return "Built project";
  if (/\b(format|prettier|eslint --fix)\b/.test(normalized)) return "Formatted files";
  return "Executed command";
}

export function summarizeCommand(command) {
  const value = boundedString(command, 500);
  const normalized = value.toLowerCase();
  if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b/.test(normalized)) return "Instalando dependencias...";
  if (/\b(test|vitest|jest|playwright|pytest|cargo test)\b/.test(normalized)) return "Ejecutando pruebas...";
  if (/\b(build|compile|tsc)\b/.test(normalized)) return "Compilando...";
  if (/\b(format|prettier|eslint --fix)\b/.test(normalized)) return "Formateando...";
  if (/\b(rg|grep|find|cat|sed|head|tail)\b/.test(normalized)) return "Leyendo archivos...";
  if (/\b(git status|git diff|git log)\b/.test(normalized)) return "Analizando el proyecto...";
  return "Ejecutando comando...";
}

function normalizeChangePath(change) {
  const item = asRecord(change);
  return boundedString(item.path ?? item.filePath ?? item.file ?? item.destination ?? "", 1_000);
}

export function summarizeFileChanges(changes) {
  const safeChanges = Array.isArray(changes) ? changes.slice(0, 1_000) : [];
  const files = Array.from(new Set(safeChanges.map(normalizeChangePath).filter(Boolean))).slice(0, 100);
  const unifiedDiff = safeChanges
    .map((entry) => boundedString(asRecord(entry).diff ?? asRecord(entry).unified_diff ?? "", 250_000))
    .filter(Boolean)
    .join("\n");
  const diff = summarizeUnifiedDiff(unifiedDiff);
  const generatedFiles = safeChanges
    .filter((entry) => /add|create|new/i.test(String(asRecord(entry).kind ?? asRecord(entry).type ?? "")))
    .map(normalizeChangePath)
    .filter(Boolean)
    .slice(0, 100);
  return {
    files: files.length ? files : diff.files,
    generatedFiles,
    changesCount: safeChanges.length,
    additions: diff.additions,
    deletions: diff.deletions,
    size: diff.size,
    preview: diff.preview,
    truncated: diff.truncated
  };
}

export function summarizeUnifiedDiff(value) {
  const diff = typeof value === "string" ? redactCodexDiagnostic(value, 1_000_000) : "";
  const files = new Set();
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch?.[2]) files.add(gitMatch[2]);
    const newFileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (newFileMatch?.[1] && newFileMatch[1] !== "/dev/null") files.add(newFileMatch[1]);
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return {
    files: Array.from(files).slice(0, 100),
    additions,
    deletions,
    size: new TextEncoder().encode(diff).length,
    preview: diff.slice(0, 8_192),
    truncated: diff.length > 8_192
  };
}

function productEvent(event, input = {}) {
  return {
    kind: input.kind ?? event.type,
    technicalType: event.type,
    timestamp: toTimestamp(event.timestamp),
    executionId: event.executionId ?? null,
    threadId: event.codexThreadId ?? null,
    turnId: event.codexTurnId ?? null,
    capability: input.capability ?? null,
    label: input.label ?? null,
    status: input.status ?? null,
    data: input.data ?? {},
    activity: input.activity ?? null
  };
}

const UPSTREAM_EVENT_HANDLERS = Object.freeze({
  "thread.started": (event) => productEvent(event, {
    kind: "thread.updated",
    capability: "threads",
    label: "Nuevo thread de Codex",
    status: "Active",
    data: { origin: "new", ...event.data }
  }),
  "thread.resumed": (event) => productEvent(event, {
    kind: "thread.updated",
    capability: "threads",
    label: "Thread restaurado",
    status: "Active",
    data: { origin: "restored", ...event.data }
  }),
  "thread.statusChanged": (event) => productEvent(event, {
    kind: "thread.updated",
    capability: "threads",
    status: normalizeThreadStatus(event.data?.status),
    data: event.data
  }),
  "turn.started": (event) => productEvent(event, {
    kind: "turn.updated",
    capability: "turns",
    label: "Codex está trabajando...",
    status: "Running",
    activity: { type: "capability.turn.started", summary: "Started coding" }
  }),
  "turn.completed": (event) => {
    const rawStatus = String(event.data?.status ?? "completed").toLowerCase();
    const status = rawStatus === "interrupted"
      ? "Interrupted"
      : rawStatus === "failed"
        ? "Failed"
        : "Completed";
    return productEvent(event, {
      kind: "turn.updated",
      capability: "turns",
      label: status === "Completed" ? "Trabajo completado" : `Turn ${status.toLowerCase()}`,
      status,
      data: event.data
    });
  },
  "plan.updated": (event) => productEvent(event, {
    kind: "plan.updated",
    capability: "planning",
    label: "Plan actualizado",
    status: "Running",
    data: {
      explanation: boundedString(event.data?.explanation, 1_000),
      steps: normalizePlan(event.data?.plan)
    },
    activity: { type: "capability.plan.updated", summary: "Updated plan" }
  }),
  "plan.delta": (event) => productEvent(event, {
    kind: "plan.streaming",
    capability: "planning",
    label: "Preparando plan...",
    status: "Running"
  }),
  "reasoning.summaryDelta": (event) => productEvent(event, {
    kind: "reasoning.streaming",
    capability: "reasoningSummaries",
    label: "Analizando...",
    status: "Running"
  }),
  "command.started": (event) => productEvent(event, {
    kind: "command.updated",
    capability: "commands",
    label: summarizeCommand(event.data?.command),
    status: "Running",
    data: event.data
  }),
  "command.completed": (event) => productEvent(event, {
    kind: "command.updated",
    capability: "commands",
    label: event.data?.exitCode === 0 ? "Comando completado" : "El comando terminó con error",
    status: event.data?.exitCode === 0 ? "Completed" : "Failed",
    data: event.data,
    activity: { type: "capability.command.completed", summary: commandActivity(event.data?.command) }
  }),
  "command.output": (event) => productEvent(event, {
    kind: "command.streaming",
    capability: "commands",
    status: "Running"
  }),
  "fileChange.started": (event) => productEvent(event, {
    kind: "tool.updated",
    capability: "diffs",
    label: "Aplicando patch...",
    status: "Running",
    data: { tool: "fileChange", ...summarizeFileChanges(event.data?.changes) }
  }),
  "fileChange.patchUpdated": (event) => productEvent(event, {
    kind: "patch.updated",
    capability: "diffs",
    label: "Actualizando archivos...",
    status: "Running",
    data: summarizeFileChanges(event.data?.changes)
  }),
  "fileChange.completed": (event) => productEvent(event, {
    kind: "patch.updated",
    capability: "diffs",
    label: "Patch aplicado",
    status: "Completed",
    data: summarizeFileChanges(event.data?.changes),
    activity: { type: "capability.patch.applied", summary: "Applied patch" }
  }),
  "diff.updated": (event) => productEvent(event, {
    kind: "diff.updated",
    capability: "diffs",
    label: "Diff actualizado",
    status: "Completed",
    data: summarizeUnifiedDiff(event.data?.diff),
    activity: { type: "capability.diff.created", summary: "Created diff" }
  }),
  "approval.requested": (event) => productEvent(event, {
    kind: "approval.updated",
    capability: "approvals",
    label: "Codex necesita tu aprobación",
    status: "Waiting",
    data: event.data,
    activity: { type: "capability.approval.requested", summary: "Approval requested" }
  }),
  "approval.resolved": (event) => productEvent(event, {
    kind: "approval.updated",
    capability: "approvals",
    label: event.data?.decision === "accept" ? "Acción aprobada" : "Acción cancelada",
    status: event.data?.decision === "accept" ? "Completed" : "Cancelled",
    data: event.data
  }),
  "webSearch.started": (event) => productEvent(event, {
    kind: "web.updated",
    capability: "webSearch",
    label: "Searching Web...",
    status: "Running",
    data: event.data,
    activity: { type: "capability.web.started", summary: "Started web search" }
  }),
  "webSearch.completed": (event) => productEvent(event, {
    kind: "web.updated",
    capability: "webSearch",
    label: "Verified from Web",
    status: "Completed",
    data: event.data,
    activity: { type: "capability.web.completed", summary: "Verified from Web" }
  }),
  "mcp.started": (event) => productEvent(event, {
    kind: "tool.updated",
    capability: "mcp",
    label: "Usando herramienta MCP...",
    status: "Running",
    data: { tool: boundedString(event.data?.tool, 200), server: boundedString(event.data?.server, 200) }
  }),
  "mcp.progress": (event) => productEvent(event, {
    kind: "tool.updated",
    capability: "mcp",
    label: boundedString(event.data?.message, 300) || "Herramienta MCP en progreso...",
    status: "Running"
  }),
  "mcp.completed": (event) => productEvent(event, {
    kind: "tool.updated",
    capability: "mcp",
    label: "Herramienta MCP completada",
    status: event.data?.error ? "Failed" : "Completed",
    data: { tool: boundedString(event.data?.tool, 200), server: boundedString(event.data?.server, 200) },
    activity: { type: "capability.mcp.completed", summary: "Completed MCP tool" }
  }),
  "item.started": (event) => productEvent(event, {
    kind: "tool.updated",
    capability: "tools",
    label: "Analizando...",
    status: "Running",
    data: event.data
  }),
  "item.completed": (event) => productEvent(event, {
    kind: "tool.updated",
    capability: "tools",
    label: "Análisis completado",
    status: "Completed",
    data: event.data
  }),
  "usage.updated": (event) => productEvent(event, {
    kind: "usage.updated",
    capability: "usage",
    data: { tokenUsage: asRecord(event.data?.tokenUsage) }
  }),
  "runtime.warning": (event) => productEvent(event, {
    kind: "warning.created",
    capability: "runtime",
    label: boundedString(event.data?.message, 1_000) || "Codex reportó una advertencia.",
    status: "Warning",
    activity: { type: "capability.warning.created", summary: "Codex warning" }
  }),
  "runtime.error": (event) => productEvent(event, {
    kind: "warning.created",
    capability: "runtime",
    label: boundedString(event.data?.message, 1_000) || "El servidor perdió conexión.",
    status: "Failed",
    activity: { type: "capability.warning.created", summary: "Codex connection issue" }
  }),
  "thread.compacted": (event) => productEvent(event, {
    kind: "warning.created",
    capability: "compaction",
    label: "Codex compactó el contexto de la sesión.",
    status: "Warning"
  }),
  "thread.mappingStale": (event) => productEvent(event, {
    kind: "warning.created",
    capability: "threads",
    label: "Codex reinició la sesión del thread.",
    status: "Warning"
  })
});

export const CODEX_PRODUCT_EVENT_MAPPING = Object.freeze(
  Object.fromEntries(
    Object.entries(UPSTREAM_EVENT_HANDLERS).map(([technicalType, handler]) => [
      technicalType,
      handler({ type: technicalType, timestamp: "1970-01-01T00:00:00.000Z", data: {} }).kind
    ])
  )
);

export function createCapabilityRegistry(status) {
  const upstream = status?.appServer ?? null;
  const capabilities = asRecord(upstream?.capabilities);
  const available = Boolean(status?.available && status?.runtimeMode === "app-server" && upstream?.available);
  const entries = CAPABILITY_DEFINITIONS.map((definition) => {
    const enabled = available && capabilities[definition.upstreamKey] === true;
    return {
      id: definition.id,
      label: definition.label,
      enabled,
      status: enabled ? "Enabled" : "Unavailable",
      source: "codex-app-server"
    };
  });
  return {
    source: "codex-app-server",
    available,
    codexVersion: upstream?.codexVersion ?? status?.version ?? null,
    protocolVersion: upstream?.protocolVersion ?? null,
    entries,
    enabledCount: entries.filter((entry) => entry.enabled).length,
    mcpServersConnected: Number.isFinite(upstream?.mcp?.configuredServers)
      ? Math.max(0, upstream.mcp.configuredServers)
      : 0,
    updatedAt: toTimestamp(upstream?.updatedAt ?? status?.updatedAt)
  };
}

export function createInitialCapabilityExposure(status = null) {
  return {
    version: 1,
    registry: createCapabilityRegistry(status),
    execution: {
      id: null,
      status: "Idle",
      active: false,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      result: null
    },
    thread: { id: null, status: "Unknown", active: false, origin: null },
    turn: { id: null, status: "Idle", active: false },
    streaming: { active: false, chunks: 0 },
    current: { capability: null, label: null, status: "Idle", timestamp: null },
    plan: null,
    command: null,
    tool: null,
    diff: null,
    patch: null,
    approval: null,
    webSearch: { status: "Idle", label: null },
    usage: { provider: null, model: null, tokens: null, durationMs: null, threadId: null, turnId: null },
    warnings: [],
    lastActivity: null,
    updatedAt: toTimestamp(status?.updatedAt)
  };
}

export function deriveActiveWorkState(state) {
  if (state.approval?.active) {
    return { id: "waiting-approval", label: "Waiting for approval", status: "Waiting", active: true };
  }
  const terminal = {
    Completed: "Completed",
    Cancelled: "Cancelled",
    Failed: "Failed",
    Interrupted: "Interrupted"
  }[state.execution.status];
  if (terminal) {
    return { id: terminal.toLowerCase(), label: terminal, status: state.execution.status, active: false };
  }
  if (state.patch?.status === "Running" || state.current.capability === "diffs" && state.current.status === "Running") {
    return { id: "applying", label: "Applying changes", status: "Running", active: true };
  }
  if (state.command?.status === "Running") {
    const testing = /prueb|test/i.test(`${state.command.label} ${state.command.command}`);
    return {
      id: testing ? "testing" : "running",
      label: testing ? "Running tests" : state.command.label,
      status: "Running",
      active: true
    };
  }
  if (state.plan?.steps.some((step) => step.status === "running") && state.turn.active) {
    return { id: "planning", label: "Planning", status: "Running", active: true };
  }
  if (state.execution.active && !state.turn.id) {
    return { id: "preparing", label: "Preparing", status: "Running", active: true };
  }
  if (state.turn.active || state.execution.active || state.streaming.active) {
    return { id: "running", label: state.current.label || "Running", status: "Running", active: true };
  }
  return { id: "idle", label: "Idle", status: "Idle", active: false };
}

export function mapUpstreamEventToProductEvent(event) {
  const handler = UPSTREAM_EVENT_HANDLERS[event?.type];
  return handler ? handler(event) : null;
}

export function mapCodexEventToProductEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "codex.upstream") return mapUpstreamEventToProductEvent(event.event);
  if (event.type === "execution.started") {
    return productEvent(event, {
      kind: "execution.updated",
      capability: "coding",
      label: "Iniciando Codex...",
      status: "Running",
      activity: { type: "capability.execution.started", summary: "Started coding" }
    });
  }
  if (event.type === "execution.output") {
    return productEvent(event, {
      kind: "streaming.updated",
      capability: "streaming",
      label: "Generando respuesta...",
      status: "Running"
    });
  }
  if (event.type === "execution.progress") {
    return productEvent(event, {
      kind: "execution.progress",
      capability: "coding",
      label: boundedString(event.message, 500),
      status: event.stage === "completed" ? "Completed" : "Running"
    });
  }
  if (event.type === "execution.completed") {
    return productEvent(event, {
      kind: "execution.updated",
      capability: "coding",
      label: "Trabajo completado",
      status: "Completed",
      activity: { type: "capability.execution.completed", summary: "Completed task" }
    });
  }
  if (event.type === "execution.cancelled") {
    const interrupted = event.reason === "turn-interrupted";
    return productEvent(event, {
      kind: "execution.updated",
      capability: "coding",
      label: interrupted ? "Turn interrumpido" : "Ejecución cancelada",
      status: interrupted ? "Interrupted" : "Cancelled",
      activity: { type: "capability.execution.cancelled", summary: "Cancelled execution" }
    });
  }
  if (event.type === "execution.failed") {
    return productEvent(event, {
      kind: "execution.updated",
      capability: "coding",
      label: event.error?.safeMessage ?? "La ejecución falló",
      status: "Failed",
      data: { errorCode: event.error?.code ?? "UNKNOWN" },
      activity: { type: "capability.execution.failed", summary: "Execution failed" }
    });
  }
  if (event.type === "codex.statusChanged") {
    return productEvent(event, {
      kind: "registry.updated",
      capability: "runtime",
      data: { registry: createCapabilityRegistry(event.status) }
    });
  }
  return null;
}

function durationBetween(startedAt, completedAt) {
  const started = Date.parse(startedAt ?? "");
  const completed = Date.parse(completedAt ?? "");
  return Number.isFinite(started) && Number.isFinite(completed) ? Math.max(0, completed - started) : null;
}

export function reduceCapabilityExposure(state, event) {
  const product = mapCodexEventToProductEvent(event);
  if (!product) return state;
  const next = {
    ...state,
    updatedAt: product.timestamp,
    current: product.label
      ? { capability: product.capability, label: product.label, status: product.status, timestamp: product.timestamp }
      : state.current,
    lastActivity: product.activity
      ? { ...product.activity, timestamp: product.timestamp, executionId: product.executionId }
      : state.lastActivity
  };

  if (product.kind === "registry.updated") next.registry = product.data.registry;
  if (product.kind === "execution.updated") {
    const active = product.status === "Running" || product.status === "Waiting";
    const startedAt = product.status === "Running" && !state.execution.active ? product.timestamp : state.execution.startedAt;
    const completedAt = active ? null : product.timestamp;
    next.execution = {
      ...state.execution,
      id: product.executionId ?? state.execution.id,
      status: product.status,
      active,
      startedAt,
      completedAt,
      durationMs: completedAt ? durationBetween(startedAt, completedAt) : null,
      result: active ? null : product.status
    };
    next.streaming = { active: false, chunks: active ? 0 : state.streaming.chunks };
    if (product.status === "Running") {
      next.plan = null;
      next.command = null;
      next.tool = null;
      next.diff = null;
      next.patch = null;
      next.approval = null;
      next.webSearch = { status: "Idle", label: null };
      next.usage = {
        ...state.usage,
        tokens: null,
        durationMs: null,
        turnId: null
      };
      next.warnings = [];
    }
    if (!active) {
      next.turn = { ...state.turn, active: false, status: state.turn.status === "Idle" ? product.status : state.turn.status };
      next.approval = state.approval ? { ...state.approval, active: false } : null;
      next.webSearch = state.webSearch.status === "Running"
        ? { status: "Failed", label: "La búsqueda web no terminó." }
        : state.webSearch;
    }
  }
  if (product.kind === "execution.progress") {
    next.execution = { ...state.execution, status: product.status, active: product.status === "Running" };
  }
  if (product.kind === "streaming.updated") {
    next.streaming = { active: true, chunks: state.streaming.chunks + 1 };
    next.execution = { ...state.execution, status: "Running", active: true };
  }
  if (product.kind === "thread.updated") {
    next.thread = {
      id: product.threadId ?? state.thread.id,
      status: product.status ?? state.thread.status,
      active: product.status === "Active",
      origin: product.data.origin ?? state.thread.origin
    };
    next.usage = {
      ...state.usage,
      provider: product.data.provider ?? state.usage.provider,
      model: product.data.model ?? state.usage.model,
      threadId: product.threadId ?? state.usage.threadId
    };
  }
  if (product.kind === "turn.updated") {
    next.turn = {
      id: product.turnId ?? state.turn.id,
      status: product.status,
      active: product.status === "Running" || product.status === "Waiting"
    };
    next.execution = {
      ...state.execution,
      status: product.status === "Running" ? "Running" : state.execution.status,
      active: product.status === "Running" ? true : state.execution.active
    };
    next.usage = {
      ...state.usage,
      durationMs: Number.isFinite(product.data.durationMs) ? product.data.durationMs : state.usage.durationMs,
      threadId: product.threadId ?? state.usage.threadId,
      turnId: product.turnId ?? state.usage.turnId
    };
  }
  if (product.kind === "plan.updated") {
    next.plan = { explanation: product.data.explanation, steps: product.data.steps, updatedAt: product.timestamp };
  }
  if (product.kind === "command.updated") {
    next.command = {
      id: product.data.itemId ?? null,
      label: product.label,
      status: product.status,
      command: boundedString(product.data.command, 500),
      exitCode: Number.isFinite(product.data.exitCode) ? product.data.exitCode : null,
      updatedAt: product.timestamp
    };
  }
  if (product.kind === "tool.updated") {
    next.tool = {
      label: product.label,
      status: product.status,
      name: boundedString(product.data.tool ?? product.data.itemType, 200),
      updatedAt: product.timestamp
    };
  }
  if (product.kind === "patch.updated") next.patch = { ...product.data, status: product.status, updatedAt: product.timestamp };
  if (product.kind === "diff.updated") next.diff = { ...product.data, updatedAt: product.timestamp };
  if (product.kind === "approval.updated") {
    const active = product.status === "Waiting";
    next.approval = {
      active,
      status: product.status,
      label: product.label,
      command: boundedString(product.data.command, 500),
      reason: boundedString(product.data.reason, 500),
      updatedAt: product.timestamp
    };
    next.turn = { ...state.turn, status: active ? "Waiting" : "Running", active: true };
    next.execution = { ...state.execution, status: active ? "Waiting" : "Running", active: true };
  }
  if (product.kind === "web.updated") next.webSearch = { status: product.status, label: product.label };
  if (product.kind === "usage.updated") {
    next.usage = {
      ...state.usage,
      tokens: product.data.tokenUsage,
      threadId: product.threadId ?? state.usage.threadId,
      turnId: product.turnId ?? state.usage.turnId
    };
  }
  if (product.kind === "warning.created") {
    next.warnings = [
      ...state.warnings,
      { message: product.label, status: product.status, timestamp: product.timestamp }
    ].slice(-6);
  }
  return next;
}
