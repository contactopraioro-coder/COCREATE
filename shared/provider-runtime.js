const HEALTH_STATES = new Set([
  "Healthy",
  "Unavailable",
  "Misconfigured",
  "Rate Limited",
  "Maintenance"
]);

const DEFAULT_PRIORITIES = {
  datetime: ["datetime-tool"],
  workspace: ["workspace-tool"],
  identity: ["identity-tool"],
  system: ["system-tool"],
  web: ["web-tool"],
  memory: ["memory-engine"],
  coding: ["codex"],
  chat: ["openai"],
  model: ["openai"],
  completion: ["openai"],
  transcription: ["openai"]
};

const STRICT_ROUTING_DOMAINS = new Set([
  "datetime",
  "workspace",
  "identity",
  "system",
  "web",
  "coding",
  "chat"
]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso() {
  return new Date().toISOString();
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitize(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /api.?key|access.?token|refresh.?token|secret|password|authorization/i.test(key)
        ? "[REDACTED]"
        : sanitize(item, seen)
    ])
  );
}

function normalizeCapabilities(capabilities = {}) {
  return {
    operations: Array.from(new Set(Array.isArray(capabilities.operations) ? capabilities.operations : [])),
    domains: Array.from(new Set(Array.isArray(capabilities.domains) ? capabilities.domains : [])),
    streaming: Boolean(capabilities.streaming),
    tools: Boolean(capabilities.tools),
    reasoning: Boolean(capabilities.reasoning),
    multimodal: Boolean(capabilities.multimodal),
    embeddings: Boolean(capabilities.embeddings)
  };
}

function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw createProviderError("PROVIDER_CONTRACT_INVALID", "El provider debe ser un objeto.", {
      kind: "contract"
    });
  }
  if (!normalizeText(adapter.id) || typeof adapter.execute !== "function") {
    throw createProviderError("PROVIDER_CONTRACT_INVALID", "El provider requiere id y execute().", {
      provider: normalizeText(adapter.id) || "unknown",
      kind: "contract"
    });
  }
  const capabilities = normalizeCapabilities(adapter.capabilities);
  if (!capabilities.operations.length || !capabilities.domains.length) {
    throw createProviderError("PROVIDER_CONTRACT_INVALID", "El provider requiere operations y domains.", {
      provider: adapter.id,
      kind: "contract"
    });
  }
  if (capabilities.streaming && typeof adapter.stream !== "function") {
    throw createProviderError("PROVIDER_CONTRACT_INVALID", "Un provider con streaming debe implementar stream().", {
      provider: adapter.id,
      kind: "contract"
    });
  }
  adapter.capabilities = capabilities;
  adapter.enabled = adapter.enabled !== false;
  return adapter;
}

export function createProviderError(code, message, options = {}) {
  const error = new Error(message);
  error.name = "ProviderError";
  error.code = code;
  error.provider = options.provider ?? "provider-runtime";
  error.kind = options.kind ?? "unknown";
  error.health = HEALTH_STATES.has(options.health) ? options.health : "Unavailable";
  error.safeMessage = options.safeMessage ?? "El proveedor no pudo completar la solicitud.";
  error.retriable = Boolean(options.retriable);
  error.requestId = options.requestId ?? null;
  error.status = options.status ?? null;
  error.routing = options.routing ?? null;
  if (options.cause !== undefined) {
    error.cause = options.cause;
  }
  return error;
}

export function normalizeProviderError(error, context = {}) {
  const original = error instanceof Error ? error : new Error(String(error ?? "Unknown provider error"));
  return {
    code: original.code ?? context.code ?? "PROVIDER_EXECUTION_FAILED",
    provider: original.provider ?? context.provider ?? "provider-runtime",
    kind: original.kind ?? context.kind ?? "unknown",
    health: HEALTH_STATES.has(original.health) ? original.health : context.health ?? "Unavailable",
    message: original.message,
    safeMessage: original.safeMessage ?? context.safeMessage ?? "El proveedor no pudo completar la solicitud.",
    retriable: Boolean(original.retriable ?? context.retriable),
    requestId: original.requestId ?? context.requestId ?? null,
    status: original.status ?? context.status ?? null,
    routing: original.routing ?? context.routing ?? null
  };
}

export class ProviderRegistry {
  constructor(adapters = []) {
    this.adapters = new Map();
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter) {
    const validated = assertProviderAdapter(adapter);
    if (this.adapters.has(validated.id)) {
      throw createProviderError("PROVIDER_ALREADY_REGISTERED", `El provider ${validated.id} ya existe.`, {
        provider: validated.id,
        kind: "registry"
      });
    }
    this.adapters.set(validated.id, validated);
    return validated;
  }

  get(id) {
    return this.adapters.get(id) ?? null;
  }

  list() {
    return Array.from(this.adapters.values()).map((adapter) => ({
      id: adapter.id,
      name: adapter.name ?? adapter.id,
      enabled: adapter.enabled,
      capabilities: adapter.capabilities,
      metadata: sanitize(adapter.metadata ?? {})
    }));
  }

  async getHealth(id) {
    const adapter = this.get(id);
    if (!adapter) {
      throw createProviderError("PROVIDER_NOT_FOUND", `El provider ${id} no está registrado.`, {
        provider: id,
        kind: "registry"
      });
    }
    if (!adapter.enabled) {
      return { status: "Unavailable", checkedAt: nowIso(), message: "Provider deshabilitado." };
    }
    try {
      const health = (await adapter.getHealth?.()) ?? { status: "Healthy" };
      return {
        status: HEALTH_STATES.has(health.status) ? health.status : "Unavailable",
        checkedAt: health.checkedAt ?? nowIso(),
        message: health.message ?? null,
        metadata: sanitize(health.metadata ?? {})
      };
    } catch (error) {
      const normalized = normalizeProviderError(error, { provider: id });
      return {
        status: normalized.health,
        checkedAt: nowIso(),
        message: normalized.safeMessage,
        metadata: { errorCode: normalized.code }
      };
    }
  }

  async describe() {
    return Promise.all(
      this.list().map(async (provider) => ({
        ...provider,
        health: await this.getHealth(provider.id)
      }))
    );
  }
}

export class ProviderSelection {
  constructor(priorities = {}) {
    this.priorities = { ...DEFAULT_PRIORITIES, ...priorities };
  }

  evaluate(request, providers) {
    const domain = request.capability ?? request.operation ?? "chat";
    const priority = this.priorities[domain] ?? [];
    const operation = request.operation ?? "chat";
    const considered = providers.map((provider) => {
      let reason = "eligible";
      if (request.provider && provider.id !== request.provider) reason = "not-explicit-provider";
      else if (!provider.enabled) reason = "disabled";
      else if (provider.health?.status !== "Healthy") reason = `health:${provider.health?.status ?? "Unavailable"}`;
      else if (!provider.capabilities.operations.includes(operation)) reason = `operation-unsupported:${operation}`;
      else if (!provider.capabilities.domains.includes(domain)) reason = `capability-unsupported:${domain}`;
      else if (STRICT_ROUTING_DOMAINS.has(domain) && priority.length && !priority.includes(provider.id)) {
        reason = `provider-not-allowed:${domain}`;
      }
      return {
        id: provider.id,
        health: provider.health?.status ?? "Unavailable",
        eligible: reason === "eligible",
        reason
      };
    });
    const eligible = providers
      .filter((provider) => considered.find((item) => item.id === provider.id)?.eligible)
      .sort((left, right) => {
        const leftIndex = priority.indexOf(left.id);
        const rightIndex = priority.indexOf(right.id);
        return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
          (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
      });
    const selected = eligible[0] ?? null;
    const selectedPriority = selected ? priority.indexOf(selected.id) : -1;
    const fallback = Boolean(selected && selectedPriority > 0);
    const selectionReason = request.provider
      ? selected ? "explicit-provider-match" : "explicit-provider-unavailable"
      : fallback
        ? "fallback-after-higher-priority-unavailable"
        : selected
          ? "highest-priority-healthy-match"
          : "no-healthy-compatible-provider";
    for (const item of considered) {
      if (item.id === selected?.id) item.reason = selectionReason;
      else if (item.eligible) item.reason = "lower-priority-compatible-provider";
    }
    const requiredProvider = request.provider ?? priority[0] ?? null;
    return { selected, considered, priority, requiredProvider, domain, operation, selectionReason, fallback };
  }

  select(request, providers) {
    return this.evaluate(request, providers).selected;
  }
}

export class ProviderMetrics {
  constructor(limit = 250) {
    this.limit = limit;
    this.entries = [];
  }

  record(entry) {
    const metric = sanitize({ ...entry, timestamp: entry.timestamp ?? nowIso() });
    this.entries.push(metric);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    return metric;
  }

  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

function withTimeout(promise, timeoutMs, controller, provider, requestId) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(createProviderError("PROVIDER_TIMEOUT", `${provider} excedió ${timeoutMs} ms.`, {
        provider,
        requestId,
        kind: "timeout",
        health: "Unavailable",
        safeMessage: "El proveedor tardó demasiado en responder. Inténtalo de nuevo.",
        retriable: true
      }));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export class ProviderRuntime {
  constructor(options = {}) {
    this.registry = options.registry ?? new ProviderRegistry();
    this.selection = options.selection ?? new ProviderSelection();
    this.metrics = options.metrics ?? new ProviderMetrics();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.observer = options.observer ?? null;
  }

  async resolveSelection(request, requestId = request.requestId ?? createRequestId()) {
    const providers = await this.registry.describe();
    const decision = this.selection.evaluate(request, providers);
    const routing = {
      requestId,
      intent: request.metadata?.intent ?? null,
      capability: request.metadata?.capability ?? request.capability,
      providerCapability: request.capability,
      classification: request.metadata?.classification ?? null,
      expectedConfidence: request.metadata?.expectedConfidence ?? null,
      tool: request.metadata?.tool ?? null,
      requiredProvider: decision.requiredProvider,
      selectedProvider: decision.selected?.id ?? null,
      selectedAdapter: decision.selected?.id ?? null,
      discardedProviders: decision.considered
        .filter((provider) => provider.id !== decision.selected?.id)
        .map((provider) => ({ id: provider.id, reason: provider.reason, health: provider.health })),
      selectionReason: decision.selectionReason,
      fallback: decision.fallback,
      fallbackPolicy: request.metadata?.fallbackPolicy ?? "priority"
    };
    this.emit({ type: "provider.selection", ...routing });
    if (!decision.selected) {
      throw createProviderError("PROVIDER_UNAVAILABLE", "No hay un provider saludable para esta solicitud.", {
        provider: decision.requiredProvider ?? "provider-runtime",
        kind: "selection",
        health: "Unavailable",
        safeMessage: "No hay un proveedor disponible para completar esta solicitud.",
        cause: routing,
        routing
      });
    }
    return { adapter: this.registry.get(decision.selected.id), routing };
  }

  async select(request) {
    return (await this.resolveSelection(request)).adapter;
  }

  async execute(request) {
    const startedAt = Date.now();
    const requestId = request.requestId ?? createRequestId();
    const selection = await this.resolveSelection(request, requestId);
    const adapter = selection.adapter;
    const routing = selection.routing;
    const controller = new AbortController();
    request.signal?.addEventListener?.("abort", () => controller.abort(), { once: true });
    this.emit({
      type: "provider.started",
      requestId,
      provider: adapter.id,
      adapter: adapter.id,
      operation: request.operation,
      ...routing
    });
    try {
      const result = await withTimeout(
        Promise.resolve(adapter.execute({ ...request, requestId, signal: controller.signal })),
        request.timeoutMs ?? this.timeoutMs,
        controller,
        adapter.id,
        requestId
      );
      const metric = this.recordMetric({
        requestId,
        provider: adapter.id,
        model: result?.model ?? adapter.metadata?.model ?? null,
        durationMs: Date.now() - startedAt,
        tokens: result?.usage ?? null,
        error: null,
        streaming: false,
        timeout: false,
        intent: routing.intent,
        capability: routing.capability,
        classification: routing.classification,
        confidence: routing.expectedConfidence,
        adapter: routing.selectedAdapter,
        tool: routing.tool,
        providerChosen: routing.selectedProvider,
        providersDiscarded: routing.discardedProviders,
        selectionReason: routing.selectionReason,
        fallback: routing.fallback
      });
      this.emit({ type: "provider.completed", ...metric });
      return { ...result, provider: adapter.id, requestId, routing };
    } catch (error) {
      const normalized = normalizeProviderError(error, { provider: adapter.id, requestId, routing });
      const metric = this.recordMetric({
        requestId,
        provider: adapter.id,
        model: adapter.metadata?.model ?? null,
        durationMs: Date.now() - startedAt,
        tokens: null,
        error: { code: normalized.code, kind: normalized.kind, status: normalized.status },
        streaming: false,
        timeout: normalized.kind === "timeout",
        intent: routing.intent,
        capability: routing.capability,
        classification: routing.classification,
        confidence: "Unavailable",
        adapter: routing.selectedAdapter,
        tool: routing.tool,
        providerChosen: routing.selectedProvider,
        providersDiscarded: routing.discardedProviders,
        selectionReason: routing.selectionReason,
        fallback: routing.fallback
      });
      this.emit({ type: "provider.failed", ...metric });
      throw createProviderError(normalized.code, normalized.message, { ...normalized, routing });
    }
  }

  async *stream(request) {
    const startedAt = Date.now();
    const requestId = request.requestId ?? createRequestId();
    const selection = await this.resolveSelection(request, requestId);
    const adapter = selection.adapter;
    const routing = selection.routing;
    if (!adapter.capabilities.streaming || typeof adapter.stream !== "function") {
      throw createProviderError("PROVIDER_STREAMING_UNSUPPORTED", `${adapter.id} no soporta streaming.`, {
        provider: adapter.id,
        requestId,
        kind: "capability",
        safeMessage: "El proveedor seleccionado no soporta streaming."
      });
    }
    let failed = null;
    try {
      for await (const chunk of adapter.stream({ ...request, requestId })) {
        yield chunk;
      }
    } catch (error) {
      failed = normalizeProviderError(error, { provider: adapter.id, requestId, routing });
      throw createProviderError(failed.code, failed.message, failed);
    } finally {
      const metric = this.recordMetric({
        requestId,
        provider: adapter.id,
        model: adapter.metadata?.model ?? null,
        durationMs: Date.now() - startedAt,
        tokens: null,
        error: failed ? { code: failed.code, kind: failed.kind, status: failed.status } : null,
        streaming: true,
        timeout: failed?.kind === "timeout",
        intent: routing.intent,
        capability: routing.capability,
        classification: routing.classification,
        confidence: failed ? "Unavailable" : routing.expectedConfidence,
        adapter: routing.selectedAdapter,
        tool: routing.tool,
        providerChosen: routing.selectedProvider,
        providersDiscarded: routing.discardedProviders,
        selectionReason: routing.selectionReason,
        fallback: routing.fallback
      });
      this.emit({ type: failed ? "provider.failed" : "provider.completed", ...metric });
    }
  }

  async getProviders() {
    return this.registry.describe();
  }

  getMetrics() {
    return this.metrics.list();
  }

  recordMetric(entry) {
    return this.metrics.record(entry);
  }

  emit(event) {
    try {
      this.observer?.(sanitize(event));
    } catch {
      // Observability cannot alter provider execution.
    }
  }
}

export class ProviderFactory {
  constructor() {
    this.factories = new Map();
  }

  register(id, factory) {
    if (!normalizeText(id) || typeof factory !== "function") {
      throw createProviderError("PROVIDER_FACTORY_INVALID", "La factory requiere id y función.", {
        kind: "factory"
      });
    }
    this.factories.set(id, factory);
    return this;
  }

  create(id, options) {
    const factory = this.factories.get(id);
    if (!factory) {
      throw createProviderError("PROVIDER_FACTORY_NOT_FOUND", `No existe factory para ${id}.`, {
        provider: id,
        kind: "factory"
      });
    }
    return assertProviderAdapter(factory(options));
  }
}

export function createFunctionProviderAdapter(options) {
  return assertProviderAdapter({
    id: options.id,
    name: options.name ?? options.id,
    enabled: options.enabled,
    capabilities: options.capabilities,
    metadata: options.metadata ?? {},
    getHealth: options.getHealth ?? (async () => ({ status: options.enabled === false ? "Unavailable" : "Healthy" })),
    execute: options.execute,
    stream: options.stream
  });
}

export function createPlaceholderProvider(options) {
  return createFunctionProviderAdapter({
    id: options.id,
    name: options.name,
    enabled: true,
    capabilities: options.capabilities,
    metadata: { ...(options.metadata ?? {}), implementation: "future" },
    async getHealth() {
      return { status: "Unavailable", message: "Not Implemented" };
    },
    async execute() {
      throw createProviderError("PROVIDER_NOT_IMPLEMENTED", `${options.name ?? options.id} no está implementado.`, {
        provider: options.id,
        kind: "not-implemented",
        health: "Unavailable",
        safeMessage: "Este proveedor todavía no está implementado."
      });
    }
  });
}

export { HEALTH_STATES as PROVIDER_HEALTH_STATES };
