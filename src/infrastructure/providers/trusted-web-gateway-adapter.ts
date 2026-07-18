import {
  createFunctionProviderAdapter,
  createProviderError,
  type ProviderAdapter,
  type ProviderRequest
} from "../../../shared/provider-runtime.js";

type TrustedWebGatewayOptions = {
  origin: "desktop-renderer" | "web-renderer";
};

function capabilities() {
  return {
    operations: ["search"],
    domains: ["web"],
    streaming: false,
    tools: true,
    reasoning: false,
    multimodal: false,
    embeddings: false
  };
}

function providerFailure(payload: any, request: ProviderRequest) {
  const error = payload?.error ?? {};
  return createProviderError(error.code ?? "WEB_PROVIDER_UNAVAILABLE", error.message ?? error.safeMessage ?? "Trusted Web no esta disponible.", {
    provider: error.provider ?? "web-tool",
    kind: error.kind ?? "gateway",
    health: error.health ?? "Unavailable",
    safeMessage: error.safeMessage ?? "No pude obtener evidencia publica verificable.",
    retriable: error.retriable,
    requestId: request.requestId,
    status: error.status
  });
}

async function executeDesktop(request: ProviderRequest) {
  if (!window.overlayBridge?.executeTrustedWeb) throw providerFailure(null, request);
  const onAbort = () => {
    void window.overlayBridge?.cancelTrustedWeb({ requestId: request.requestId ?? "", reason: "renderer-abort" });
  };
  request.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const payload = await window.overlayBridge.executeTrustedWeb({
      requestId: request.requestId ?? "",
      input: request.input
    });
    if (!payload?.ok || !payload.result) throw providerFailure(payload, request);
    return {
      output: payload.result.output,
      value: payload.result.value,
      model: payload.result.model,
      metadata: payload.result.metadata ?? undefined
    };
  } finally {
    request.signal?.removeEventListener("abort", onAbort);
  }
}

async function executeWeb(request: ProviderRequest) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: request.input?.query ?? request.input?.prompt,
      requestId: request.requestId,
      correlationId: request.input?.correlationId,
      context: {
        timezone: request.input?.timezone,
        locale: request.input?.locale
      }
    }),
    signal: request.signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw providerFailure({
      error: {
        code: payload?.code ?? "WEB_PROVIDER_UNAVAILABLE",
        message: payload?.error ?? payload?.output,
        safeMessage: payload?.error ?? payload?.output,
        status: response.status,
        retriable: response.status >= 500
      }
    }, request);
  }
  return {
    output: payload.output,
    value: {
      output: payload.output,
      confidence: payload.confidence,
      grounded: payload.grounded,
      verifiedAt: payload.verifiedAt,
      sources: payload.sources ?? [],
      citations: payload.citations ?? [],
      warnings: payload.warnings ?? [],
      provider: payload.routing?.selectedProvider ?? payload.provider,
      tool: payload.tool ?? "TrustedWebTool",
      groundingBundle: { conflicts: payload.conflicts ?? [] },
      metadata: { requestId: payload.routing?.requestId ?? request.requestId }
    },
    metadata: { transport: "https", upstream: "/api/chat" }
  };
}

export function createTrustedWebGatewayAdapter(options: TrustedWebGatewayOptions): ProviderAdapter {
  return createFunctionProviderAdapter({
    id: "web-tool",
    name: "Trusted Web Tool Gateway",
    capabilities: capabilities(),
    metadata: { transport: options.origin === "desktop-renderer" ? "electron-ipc" : "https" },
    async getHealth() {
      if (options.origin === "web-renderer") return { status: "Healthy" as const, metadata: { transport: "https" } };
      if (!window.overlayBridge?.getTrustedWebStatus) return { status: "Unavailable" as const, message: "IPC no disponible." };
      return window.overlayBridge.getTrustedWebStatus();
    },
    execute: options.origin === "desktop-renderer" ? executeDesktop : executeWeb
  });
}
