function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeForIntent(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, signals) {
  return signals.some((signal) => text.includes(signal));
}

function collectSignals(text, signals) {
  return signals.filter((signal) => text.includes(signal));
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const LONG_RUNNING_INTERACTION_TIMEOUT_MS = 10 * 60 * 1_000;

function providerTimeoutForInteraction(input) {
  return input.interactionMode === "live" || input.interactionMode === "proposal"
    ? LONG_RUNNING_INTERACTION_TIMEOUT_MS
    : undefined;
}

export function createTrustedAssistantError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "TrustedAssistantError";
  error.code = code;
  error.component = details.component ?? "assistant-runtime";
  error.provider = details.provider ?? "runtime";
  error.kind = details.kind ?? "unknown";
  error.safeMessage = details.safeMessage ?? "No pude completar esta solicitud de forma confiable.";
  error.retriable = Boolean(details.retriable);
  if (details.cause !== undefined) {
    error.cause = details.cause;
  }
  return error;
}

export function normalizeTrustedAssistantError(error, context = {}) {
  const original = error instanceof Error ? error : new Error(String(error ?? "Unknown assistant error"));
  return {
    code: typeof original.code === "string" ? original.code : context.code ?? "ASSISTANT_RUNTIME_ERROR",
    component: original.component ?? context.component ?? "assistant-runtime",
    provider: original.provider ?? context.provider ?? "runtime",
    kind: original.kind ?? context.kind ?? "unknown",
    message: original.message,
    safeMessage:
      original.safeMessage ?? context.safeMessage ?? "No pude completar esta solicitud de forma confiable.",
    retriable: Boolean(original.retriable ?? context.retriable),
    stack: original.stack ?? null
  };
}

function emitDiagnostic(runtime, event) {
  try {
    runtime.diagnostics?.log?.(event);
  } catch {
    // Diagnostics must never alter the assistant response path.
  }
}

function toolForCapability(capability) {
  return {
    datetime: "DateTimeTool",
    workspace: "WorkspaceTool",
    identity: "IdentityTool",
    system: "SystemTool",
    web: "TrustedWebTool",
    model: "ModelRuntime"
  }[capability] ?? "AssistantRuntime";
}

export function analyzeAssistantIntent(input = {}) {
  const prompt = normalizeText(input.prompt);
  const normalized = normalizeForIntent(prompt);
  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
  const usesWebAttachmentGateway = hasAttachments && (input.origin === "web-renderer" || input.origin === "web-server");
  const currentSignals = collectSignals(normalized, [
    "actual",
    "actualmente",
    "hoy",
    "ahora",
    "reciente",
    "mas reciente",
    "ultimo",
    "ultima version",
    "latest",
    "latest version",
    "today",
    "now",
    "current"
  ]);
  const externalSignals = collectSignals(normalized, [
    "noticia",
    "ocurrio",
    "paso hoy",
    "gano",
    "resultado",
    "marcador",
    "precio",
    "bitcoin",
    "alcalde",
    "presidente",
    "papa",
    "pontifice",
    "ceo",
    "clima",
    "trafico",
    "cotizacion",
    "eleccion",
    "news",
    "happened",
    "won",
    "score",
    "price",
    "mayor",
    "president",
    "weather"
  ]);
  const explanatoryDateTime = matchesAny(normalized, [
    /\bque es (una |la )?(zona horaria|timezone)\b/,
    /\b(explica|explicame|como funciona|por que|porque)\b.*\b(zona horaria|timezone|calendario|ano bisiesto|anos bisiestos)\b/,
    /\bwhat is (a |the )?(time zone|timezone)\b/,
    /\b(explain|how does|why)\b.*\b(time zone|timezone|calendar|leap year)\b/
  ]);
  const dateTimePatterns = [
    /\b(que|cual)\b.{0,28}\b(fecha|hora|dia|mes|ano|zona horaria|timezone)\b/,
    /\ben que (dia|mes|ano) estamos\b/,
    /\b(fecha|hora|dia|mes|ano) actual\b/,
    /\b(mi|nuestra) zona horaria\b/,
    /\bwhat (date|day|time|month|year)\b/,
    /\bwhat time is it\b/,
    /\bcurrent (date|day|time|month|year)\b/,
    /\bwhat(?:s| is) my (time zone|timezone)\b/,
    /\bwhat (time zone|timezone)\b/,
    /^(hoy|ahora|today|now)$/,
    /^(zona horaria|timezone|hora local|local time|fecha actual|current date)$/
  ];
  const matchedDateTimePatterns = dateTimePatterns
    .map((pattern) => (pattern.test(normalized) ? pattern.source : null))
    .filter(Boolean);
  const inherentlyCurrentExternal = matchesAny(normalized, [
    /\bquien es (el |la )?(presidente|papa|pontifice|alcalde|ceo)\b/,
    /\bwho is (the )?(president|pope|mayor|ceo)\b/,
    /\b(precio|price|cotizacion|clima|weather|trafico|traffic)\b/,
    /\b(noticia|noticias|news|resultado|resultados|score|marcador)\b/,
    /\b(version|versión) (mas |más )?(reciente|nueva|actual)\b/,
    /\b(ultima|ultimo|latest|newest|current) (version|release)\b/,
    /\b(version|release)\b.{0,24}\b(estable|stable|actual|reciente|latest|current|newest)\b/,
    /\b(latest|current|newest) version\b/
  ]);
  const asksExternalCurrent = inherentlyCurrentExternal || (externalSignals.length > 0 && currentSignals.length > 0);
  const asksDateTime = matchedDateTimePatterns.length > 0 && !explanatoryDateTime && !asksExternalCurrent;

  const workspaceSignals = collectSignals(normalized, [
    "workspace",
    "proyecto actual",
    "proyecto abierto",
    "que proyecto",
    "tarea actual",
    "tarea activa",
    "mi tarea",
    "que tarea",
    "conversacion activa",
    "conversaciones existen",
    "que conversaciones",
    "conversaciones tengo",
    "chats existen",
    "chat activo"
  ]);
  const asksWorkspace = workspaceSignals.length > 0;

  const identitySignals = collectSignals(normalized, [
    "quien soy",
    "como me llamo",
    "cual es mi nombre",
    "mi perfil",
    "mi timezone",
    "mi zona horaria",
    "mi idioma",
    "mi usuario",
    "que perfil",
    "dispositivo estoy usando",
    "mi dispositivo"
  ]);
  const asksIdentity = identitySignals.length > 0;

  const systemSignals = collectSignals(normalized, [
    "sistema",
    "sistema operativo",
    "plataforma",
    "arquitectura",
    "carpeta de trabajo",
    "directorio de trabajo",
    "working directory",
    "mi version",
    "version uso",
    "instalación",
    "instalacion"
  ]);
  const asksSystem = systemSignals.length > 0;

  const codingSignals = collectSignals(normalized, [
    "build",
    "debug",
    "fix",
    "error",
    "bug",
    "refactor",
    "implementa",
    "crea",
    "haz",
    "codigo",
    "repo",
    "archivo"
  ]);
  const asksCode = codingSignals.length > 0 || matchesAny(normalized, [
    /\b(react|typescript)\b/,
    /\b(escribe|genera|construye|crea|haz|implementa)\b.*\b(componente|api|endpoint|funcion|codigo|aplicacion)\b/,
    /\b(component|function|endpoint)\b.*\b(write|build|create|implement)\b/
  ]);

  const asksSearch = asksExternalCurrent && !asksDateTime;
  const asksCurrentInfo = currentSignals.length > 0 || asksExternalCurrent;

  const capabilities = [];
  if (hasAttachments) capabilities.push("model");
  if (!hasAttachments && asksDateTime) capabilities.push("datetime");
  if (!hasAttachments && asksIdentity) capabilities.push("identity");
  // Workspace words commonly appear in file names and coding instructions. A
  // concrete coding request must reach Codex instead of being answered as a
  // passive context query.
  if (!hasAttachments && asksWorkspace && !asksCode) capabilities.push("workspace");
  if (!hasAttachments && asksSystem) capabilities.push("system");
  if (!hasAttachments && asksSearch) capabilities.push("web");
  if (asksCode || capabilities.length === 0) capabilities.push("model");

  const primaryCapability = capabilities[0] ?? "model";
  const classification = {
    datetime: "DateTime",
    workspace: "Workspace",
    identity: "Identity",
    system: "System",
    web: "Web",
    model: asksCode ? "Coding" : "General Knowledge"
  }[primaryCapability];
  const primaryIntent = {
    datetime: "datetime-query",
    workspace: "workspace-context",
    identity: "identity-context",
    system: "system-context",
    web: "current-information",
    model: asksCode ? "coding" : "general-knowledge"
  }[primaryCapability];
  const providerCapability = primaryCapability === "model"
    ? usesWebAttachmentGateway ? "chat" : asksCode ? "coding" : "chat"
    : primaryCapability;
  const expectedConfidence = primaryCapability === "model" ? "Estimated" : "Verified";

  const routingSignals = [
    ...matchedDateTimePatterns.map((signal) => `datetime:${signal}`),
    ...identitySignals.map((signal) => `identity:${signal}`),
    ...workspaceSignals.map((signal) => `workspace:${signal}`),
    ...systemSignals.map((signal) => `system:${signal}`),
    ...codingSignals.map((signal) => `coding:${signal}`),
    ...currentSignals.map((signal) => `current:${signal}`),
    ...externalSignals.map((signal) => `external:${signal}`),
    ...(hasAttachments ? ["model:attachments"] : []),
    ...(usesWebAttachmentGateway ? ["provider:web-attachment-gateway"] : []),
    ...(explanatoryDateTime ? ["datetime:explanatory-exclusion"] : [])
  ];

  return {
    prompt,
    normalized,
    capabilities,
    primaryCapability,
    primaryIntent,
    providerCapability,
    classification,
    expectedConfidence,
    requiresCurrentVerification: asksSearch,
    asksDateTime,
    asksWorkspace,
    asksIdentity,
    asksSystem,
    asksCode,
    asksCurrentInfo,
    asksWeb: asksSearch,
    routingSignals,
    capabilityPriority: ["datetime", "identity", "workspace", "system", "web", "model"]
  };
}

export function buildTrustedResponse(input = {}) {
  return {
    ok: Boolean(input.ok),
    output: normalizeText(input.output),
    confidence: input.confidence ?? "Unavailable",
    capability: input.capability ?? "model",
    grounding: Array.isArray(input.grounding) ? input.grounding : [],
    sources: Array.isArray(input.sources) ? input.sources : [],
    citations: Array.isArray(input.citations) ? input.citations : [],
    grounded: Boolean(input.grounded),
    verifiedAt: normalizeText(input.verifiedAt) || undefined,
    warnings: Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : [],
    tool: input.tool ?? null,
    provider: input.provider ?? "runtime",
    classification: input.classification ?? "Unclassified",
    metadata: input.metadata ?? {}
  };
}

function webFreshnessForIntent(intent) {
  if (/\b(noticia|noticias|news|hoy|today|precio|price|estado actual|service status)\b/.test(intent.normalized)) {
    return "today";
  }
  if (/\b(version|versi[oó]n|release|resultado|score|marcador)\b/.test(intent.normalized)) {
    return "week";
  }
  if (/\b(actual|actualmente|current|presidente|president|alcalde|mayor|papa|pontifice)\b/.test(intent.normalized)) {
    return "today";
  }
  return "month";
}

function formatDateTimeReply(snapshot, normalized) {
  if (!snapshot) {
    return buildTrustedResponse({
      ok: false,
      output: "No pude consultar la fecha y hora del sistema en este entorno.",
      confidence: "Unavailable",
      capability: "datetime",
      grounding: ["system"],
      provider: "datetime-tool"
    });
  }

  const metadata = {
    ...snapshot,
    tool: "DateTimeTool",
    timezone: snapshot.timezone,
    resolvedAt: snapshot.resolvedAt ?? snapshot.iso
  };
  const timeTerminator = /[.!?]$/.test(snapshot.localTime) ? "" : ".";

  if (normalized.includes("timezone") || normalized.includes("zona horaria")) {
    return buildTrustedResponse({
      ok: true,
      output: `Tu zona horaria actual es ${snapshot.timezone}.`,
      confidence: "Verified",
      capability: "datetime",
      grounding: ["system", "identity"],
      provider: "datetime-tool",
      metadata
    });
  }

  const asksTime =
    normalized.includes("hora") ||
    normalized.includes("time") ||
    normalized === "ahora" ||
    normalized === "now";
  const asksDate = normalized.includes("fecha") || normalized.includes("date");

  if (asksTime && asksDate) {
    return buildTrustedResponse({
      ok: true,
      output: `La fecha y hora local verificadas son ${snapshot.localDate}, ${snapshot.localTime}${timeTerminator}`,
      confidence: "Verified",
      capability: "datetime",
      grounding: ["system", "identity"],
      provider: "datetime-tool",
      metadata
    });
  }

  if (asksTime) {
    return buildTrustedResponse({
      ok: true,
      output: `La hora local verificada es ${snapshot.localTime}${timeTerminator}`,
      confidence: "Verified",
      capability: "datetime",
      grounding: ["system", "identity"],
      provider: "datetime-tool",
      metadata
    });
  }

  if (normalized.includes("mes") || normalized.includes("month")) {
    return buildTrustedResponse({
      ok: true,
      output: `El mes local verificado es ${snapshot.monthName ?? snapshot.month}.`,
      confidence: "Verified",
      capability: "datetime",
      grounding: ["system", "identity"],
      provider: "datetime-tool",
      metadata
    });
  }

  if (normalized.includes("ano") || normalized.includes("year")) {
    return buildTrustedResponse({
      ok: true,
      output: `El año local verificado es ${snapshot.year}.`,
      confidence: "Verified",
      capability: "datetime",
      grounding: ["system", "identity"],
      provider: "datetime-tool",
      metadata
    });
  }

  if (normalized.includes("dia de la semana") || normalized.includes("day of the week")) {
    return buildTrustedResponse({
      ok: true,
      output: `El día local verificado es ${snapshot.dayOfWeek ?? snapshot.localDate}.`,
      confidence: "Verified",
      capability: "datetime",
      grounding: ["system", "identity"],
      provider: "datetime-tool",
      metadata
    });
  }

  return buildTrustedResponse({
    ok: true,
    output: `La fecha local verificada es ${snapshot.localDate}.`,
    confidence: "Verified",
    capability: "datetime",
    grounding: ["system", "identity"],
    provider: "datetime-tool",
    metadata
  });
}

function formatWorkspaceReply(snapshot, normalized) {
  if (!snapshot?.workspace) {
    return buildTrustedResponse({
      ok: false,
      output: "No pude leer el contexto del Workspace en este entorno.",
      confidence: "Unavailable",
      capability: "workspace",
      grounding: ["workspace"],
      provider: "workspace-tool"
    });
  }

  if (normalized.includes("proyecto")) {
    const name = snapshot.project?.name ?? "ningún proyecto activo";
    return buildTrustedResponse({
      ok: true,
      output: snapshot.project ? `El proyecto activo es ${name}.` : "No hay un proyecto activo en este momento.",
      confidence: "Verified",
      capability: "workspace",
      grounding: ["workspace"],
      provider: "workspace-tool",
      metadata: snapshot
    });
  }

  if (normalized.includes("tarea")) {
    const title = snapshot.task?.title ?? "ninguna tarea activa";
    return buildTrustedResponse({
      ok: true,
      output: snapshot.task ? `La tarea activa es ${title}.` : "No hay una tarea activa en este momento.",
      confidence: "Verified",
      capability: "workspace",
      grounding: ["workspace"],
      provider: "workspace-tool",
      metadata: snapshot
    });
  }

  if (normalized.includes("convers") || normalized.includes("chats existen")) {
    const asksForList = normalized.includes("existen") || normalized.includes("que conversaciones") || normalized.includes("tengo");
    if (asksForList) {
      const conversations = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
      const titles = conversations
        .map((conversation) => conversation?.title ?? conversation?.thread?.title)
        .filter(Boolean);
      return buildTrustedResponse({
        ok: true,
        output: titles.length
          ? `Las conversaciones existentes son: ${titles.join(", ")}.`
          : "No hay conversaciones registradas en este workspace.",
        confidence: "Verified",
        capability: "workspace",
        grounding: ["workspace"],
        provider: "workspace-tool",
        metadata: snapshot
      });
    }
    const title = snapshot.conversation?.title ?? "ninguna conversación activa";
    return buildTrustedResponse({
      ok: true,
      output: snapshot.conversation
        ? `La conversación activa es ${title}.`
        : "No hay una conversación activa en este momento.",
      confidence: "Verified",
      capability: "workspace",
      grounding: ["workspace"],
      provider: "workspace-tool",
      metadata: snapshot
    });
  }

  return buildTrustedResponse({
    ok: true,
    output: `Estás trabajando en el workspace ${snapshot.workspace.name}.`,
    confidence: "Verified",
    capability: "workspace",
    grounding: ["workspace"],
    provider: "workspace-tool",
    metadata: snapshot
  });
}

function formatIdentityReply(snapshot, normalized) {
  if (!snapshot?.identity) {
    return buildTrustedResponse({
      ok: false,
      output: "No pude leer tu identidad local en este entorno.",
      confidence: "Unavailable",
      capability: "identity",
      grounding: ["identity"],
      provider: "identity-tool"
    });
  }

  if (normalized.includes("timezone") || normalized.includes("zona horaria")) {
    return buildTrustedResponse({
      ok: true,
      output: `Tu zona horaria de perfil es ${snapshot.profile?.timezone ?? "desconocida"}.`,
      confidence: "Verified",
      capability: "identity",
      grounding: ["identity"],
      provider: "identity-tool",
      metadata: snapshot
    });
  }

  if (normalized.includes("idioma")) {
    return buildTrustedResponse({
      ok: true,
      output: `Tu idioma de perfil es ${snapshot.profile?.locale ?? "desconocido"}.`,
      confidence: "Verified",
      capability: "identity",
      grounding: ["identity"],
      provider: "identity-tool",
      metadata: snapshot
    });
  }

  if (normalized.includes("dispositivo") || normalized.includes("device")) {
    const platform = snapshot.device?.platform ?? "desconocido";
    const architecture = snapshot.device?.architecture ?? "desconocida";
    return buildTrustedResponse({
      ok: true,
      output: `Tu dispositivo activo usa ${platform} con arquitectura ${architecture}.`,
      confidence: "Verified",
      capability: "identity",
      grounding: ["identity"],
      provider: "identity-tool",
      metadata: snapshot
    });
  }

  return buildTrustedResponse({
    ok: true,
    output: `Tu perfil local activo es ${snapshot.profile?.displayName ?? snapshot.identity.displayName ?? "Local User"}.`,
    confidence: "Verified",
    capability: "identity",
    grounding: ["identity"],
    provider: "identity-tool",
    metadata: snapshot
  });
}

function formatSystemReply(snapshot, normalized) {
  if (!snapshot) {
    return buildTrustedResponse({
      ok: false,
      output: "No pude consultar el sistema actual en este entorno.",
      confidence: "Unavailable",
      capability: "system",
      grounding: ["system"],
      provider: "system-tool"
    });
  }

  let output = `Este entorno corre sobre ${snapshot.platform} ${snapshot.architecture}.`;
  if (normalized.includes("carpeta") || normalized.includes("directorio") || normalized.includes("working directory")) {
    const workingDirectory = snapshot.workingDirectory ?? snapshot.cwd;
    if (!workingDirectory) {
      return buildTrustedResponse({
        ok: false,
        output: "La carpeta de trabajo no está disponible en este entorno.",
        confidence: "Unavailable",
        capability: "system",
        grounding: ["system"],
        provider: "system-tool"
      });
    }
    output = `La carpeta de trabajo verificada es ${workingDirectory}.`;
  } else if (normalized.includes("version")) {
    const version = snapshot.appVersion ?? snapshot.runtimeVersion ?? snapshot.version;
    if (!version) {
      return buildTrustedResponse({
        ok: false,
        output: "La versión del entorno no está disponible.",
        confidence: "Unavailable",
        capability: "system",
        grounding: ["system"],
        provider: "system-tool"
      });
    }
    output = `La versión verificada del entorno es ${version}.`;
  }

  return buildTrustedResponse({
    ok: true,
    output,
    confidence: "Verified",
    capability: "system",
    grounding: ["system"],
    provider: "system-tool",
    metadata: snapshot
  });
}

function buildUnavailableWebReply() {
  return buildTrustedResponse({
    ok: false,
    output:
      "Esta pregunta requiere información web actual, pero no pude obtener evidencia pública verificable en este entorno.",
    confidence: "Unavailable",
    capability: "web",
    grounding: ["tooling"],
    provider: "web-tool",
    tool: "TrustedWebTool"
  });
}

export async function runTrustedAssistantRuntime(input = {}, runtime = {}) {
  const startedAt = Date.now();
  const intent = analyzeAssistantIntent(input);
  const capability = intent.primaryCapability;
  const selectedTool = toolForCapability(capability);
  let lastProviderRouting = null;

  emitDiagnostic(runtime, {
    type: "assistant.routing",
    intent: intent.capabilities,
    capability,
    classification: intent.classification,
    providerCapability: intent.providerCapability,
    tool: selectedTool,
    signals: intent.routingSignals,
    provider: capability === "model" ? "pending" : selectedTool,
    durationMs: 0
  });

  const enrichWithRouting = (response) => {
    const routing = {
      intent: intent.primaryIntent,
      capability,
      providerCapability: intent.providerCapability,
      classification: intent.classification,
      provider: response.provider,
      requiredProvider: lastProviderRouting?.requiredProvider ?? response.provider,
      selectedProvider: lastProviderRouting?.selectedProvider ?? null,
      adapter: lastProviderRouting?.selectedAdapter ?? null,
      tool: selectedTool,
      selectionReason: lastProviderRouting?.selectionReason ??
        (response.capability === "web" && !response.ok ? "required-provider-unavailable" : "capability-route"),
      discardedProviders: lastProviderRouting?.discardedProviders ?? [],
      confidence: response.confidence,
      fallback: response.capability === "web" && !response.ok
        ? "unavailable-no-fallback"
        : lastProviderRouting?.fallback ?? false,
      fallbackPolicy: lastProviderRouting?.fallbackPolicy ??
        (response.capability === "web" ? "unavailable" : "strict-provider"),
      requestId: lastProviderRouting?.requestId ?? response.metadata?.requestId ?? null,
      signals: intent.routingSignals
    };
    return {
      ...response,
      tool: response.tool ?? selectedTool,
      classification: intent.classification,
      metadata: { ...response.metadata, routing }
    };
  };

  const complete = (response) => {
    const enrichedResponse = enrichWithRouting(response);
    emitDiagnostic(runtime, {
      type: "assistant.completed",
      intent: intent.primaryIntent,
      capability,
      classification: intent.classification,
      providerCapability: intent.providerCapability,
      tool: selectedTool,
      signals: intent.routingSignals,
      provider: enrichedResponse.provider,
      adapter: enrichedResponse.metadata.routing.adapter,
      requiredProvider: enrichedResponse.metadata.routing.requiredProvider,
      selectedProvider: enrichedResponse.metadata.routing.selectedProvider,
      discardedProviders: enrichedResponse.metadata.routing.discardedProviders,
      selectionReason: enrichedResponse.metadata.routing.selectionReason,
      confidence: enrichedResponse.confidence,
      fallback: enrichedResponse.metadata.routing.fallback,
      requestId: enrichedResponse.metadata.routing.requestId,
      ok: enrichedResponse.ok,
      durationMs: Date.now() - startedAt,
      timezone: enrichedResponse.capability === "datetime" ? enrichedResponse.metadata?.timezone ?? null : undefined,
      resolvedAt: enrichedResponse.capability === "datetime" ? enrichedResponse.metadata?.resolvedAt ?? null : undefined
    });
    return enrichedResponse;
  };

  const fail = (error, context = {}) => {
    const normalizedError = normalizeTrustedAssistantError(error, {
      component: context.component ?? selectedTool,
      provider: context.provider ?? selectedTool,
      safeMessage: context.safeMessage
    });
    emitDiagnostic(runtime, {
      type: "assistant.failed",
      intent: intent.primaryIntent,
      capability,
      classification: intent.classification,
      providerCapability: intent.providerCapability,
      tool: selectedTool,
      provider: normalizedError.provider,
      durationMs: Date.now() - startedAt,
      error: normalizedError
    });

    const developmentDetails = runtime.development
      ? ` [${normalizedError.code}] ${normalizedError.message}`
      : "";
    return enrichWithRouting(buildTrustedResponse({
      ok: false,
      output: `${normalizedError.safeMessage}${developmentDetails}`,
      confidence: "Unavailable",
      capability,
      grounding: [capability === "model" ? "model" : "tooling"],
      provider: normalizedError.provider,
      metadata: runtime.development ? { error: normalizedError } : { errorCode: normalizedError.code }
    }));
  };

  const executeProvider = async (providerCapability, operation = "query", providerInput = {}) => {
    if (!runtime.providerRuntime?.execute) {
      throw createTrustedAssistantError("PROVIDER_RUNTIME_UNAVAILABLE", "Provider Runtime no está disponible.", {
        component: "ProviderRuntime",
        provider: "provider-runtime",
        kind: "configuration",
        safeMessage: "No hay un proveedor confiable disponible para esta solicitud."
      });
    }
    try {
      const result = await runtime.providerRuntime.execute({
        capability: providerCapability,
        operation,
        signal: input.signal,
        requestId: input.requestId,
        timeoutMs: providerTimeoutForInteraction(input),
        input: providerInput,
        metadata: {
          intent: intent.primaryIntent,
          capability,
          providerCapability,
          classification: intent.classification,
          expectedConfidence: intent.expectedConfidence,
          tool: selectedTool,
          fallbackPolicy: capability === "web" ? "unavailable" : "priority"
        }
      });
      lastProviderRouting = result.routing ?? null;
      return result;
    } catch (error) {
      lastProviderRouting = error?.routing ?? null;
      throw error;
    }
  };

  if (capability === "datetime") {
    try {
      const result = await executeProvider("datetime", "query", { prompt: intent.prompt });
      const snapshot = result?.value;
      return complete(formatDateTimeReply(snapshot, intent.normalized));
    } catch (error) {
      return fail(error, {
        component: "DateTimeTool",
        provider: "datetime-tool",
        safeMessage: "No pude consultar la fecha y hora del sistema en este entorno."
      });
    }
  }

  if (capability === "workspace") {
    try {
      const result = await executeProvider("workspace", "query", { prompt: intent.prompt });
      const snapshot = result?.value;
      return complete(formatWorkspaceReply(snapshot, intent.normalized));
    } catch (error) {
      return fail(error, {
        component: "WorkspaceTool",
        provider: "workspace-tool",
        safeMessage: "No pude leer el contexto del Workspace en este entorno."
      });
    }
  }

  if (capability === "identity") {
    try {
      const result = await executeProvider("identity", "query", { prompt: intent.prompt });
      const snapshot = result?.value;
      return complete(formatIdentityReply(snapshot, intent.normalized));
    } catch (error) {
      return fail(error, {
        component: "IdentityTool",
        provider: "identity-tool",
        safeMessage: "No pude leer tu identidad local en este entorno."
      });
    }
  }

  if (capability === "system") {
    try {
      const result = await executeProvider("system", "query", { prompt: intent.prompt });
      const snapshot = result?.value;
      return complete(formatSystemReply(snapshot, intent.normalized));
    } catch (error) {
      return fail(error, {
        component: "SystemTool",
        provider: "system-tool",
        safeMessage: "No pude consultar el sistema actual en este entorno."
      });
    }
  }

  if (capability === "web" || intent.requiresCurrentVerification) {
    try {
      const result = await executeProvider("web", "search", {
        query: intent.prompt,
        locale: input.context?.locale,
        timezone: input.context?.timezone,
        countryHint: input.context?.countryHint,
        freshness: webFreshnessForIntent(intent),
        intent: intent.primaryIntent,
        correlationId: input.correlationId
      });
      const answer = result?.value;
      const verified =
        (answer?.confidence === "Verified" || answer?.confidence === "VerifiedWithConflict") &&
        answer?.grounded === true &&
        normalizeText(answer?.verifiedAt) &&
        Array.isArray(answer?.sources) && answer.sources.length > 0 &&
        Array.isArray(answer?.citations) && answer.citations.length > 0;
      if (!normalizeText(answer?.output ?? result?.output)) {
        return complete(buildUnavailableWebReply());
      }
      if (!verified) {
        return complete(buildTrustedResponse({
          ok: false,
          output: "No encontré evidencia pública suficiente para afirmar una respuesta actual con confianza.",
          confidence: "InsufficientEvidence",
          capability: "web",
          grounding: ["web"],
          sources: answer?.sources ?? [],
          citations: [],
          grounded: false,
          warnings: answer?.warnings ?? ["insufficient-evidence"],
          provider: result.provider,
          tool: "TrustedWebTool",
          metadata: {
            requestId: result.requestId,
            searchProvider: answer?.provider ?? null,
            metrics: answer?.metadata ?? null
          }
        }));
      }
      return complete(buildTrustedResponse({
        ok: true,
        output: answer.output,
        confidence: answer.confidence,
        capability: "web",
        grounding: ["web"],
        sources: answer.sources,
        citations: answer.citations,
        grounded: true,
        verifiedAt: answer.verifiedAt,
        warnings: answer.warnings,
        provider: result.provider,
        tool: "TrustedWebTool",
        metadata: {
          requestId: result.requestId,
          model: result.model ?? null,
          searchProvider: answer.provider,
          conflicts: answer.groundingBundle?.conflicts ?? [],
          metrics: answer.metadata ?? null
        }
      }));
    } catch (error) {
      return fail(error, {
        component: "TrustedWebTool",
        provider: error?.provider ?? "web-tool",
        safeMessage: "No pude obtener evidencia pública verificable para esta consulta."
      });
    }
  }

  try {
      const result = await executeProvider(intent.providerCapability, "chat", {
        prompt: intent.prompt,
        history: input.history ?? [],
        model: input.model ?? null,
        effort: input.effort ?? null,
        collaborationMode: input.collaborationMode ?? null,
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
        skills: Array.isArray(input.skills) ? input.skills : [],
        interactionMode: input.interactionMode === "proposal" ? "proposal" : input.interactionMode === "live" ? "live" : "chat",
        visualContext: input.visualContext && typeof input.visualContext === "object" ? input.visualContext : null,
        proposalWorkspaceId: typeof input.proposalWorkspaceId === "string" ? input.proposalWorkspaceId : null,
        proposalContext: input.proposalContext && typeof input.proposalContext === "object" ? input.proposalContext : null
      });
      if (!normalizeText(result?.output)) {
        throw createTrustedAssistantError("MODEL_EMPTY_RESPONSE", "El modelo devolvió una respuesta vacía.", {
          component: "ModelRuntime",
          provider: result?.provider ?? "provider-runtime",
          kind: "parsing",
          safeMessage: "El modelo no devolvió texto útil. Inténtalo de nuevo.",
          retriable: true
        });
      }

      return complete(buildTrustedResponse({
        ok: true,
        output: result.output,
        confidence: "Estimated",
        capability: "model",
        grounding: ["model"],
        provider: result.provider ?? "model",
        metadata: {
          delegated: true,
          requestId: result.requestId,
          model: result.model ?? null,
          usage: result.usage ?? null
        }
      }));
    } catch (error) {
      return fail(error, {
        component: "ModelRuntime",
        provider: error?.provider ?? "model",
        safeMessage: "No pude completar la respuesta con el modelo. Inténtalo de nuevo."
      });
    }
}
