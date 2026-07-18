import {
  normalizeTrustedAssistantError,
  runTrustedAssistantRuntime
} from "../shared/trusted-assistant-runtime.js";
import {
  createServerAssistantDiagnostics,
  createServerDateTimeTool,
  createServerSystemTool,
  createUnavailableIdentityTool,
  createUnavailableWorkspaceTool
} from "./_lib/trusted-assistant-tools.js";
import { createServerProviderRuntime } from "./_lib/server-provider-runtime.js";
import { guardChatRequest } from "./_lib/web-request-guard.js";
import { normalizeWebAttachmentPayloads } from "../shared/web-attachment-contracts.js";

type ApiRequest = {
  method?: string;
  body?: any;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
};

type ChatMessage = {
  role: "user" | "assistant" | "system";
  body: string;
};

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const guard = guardChatRequest(request);
  if (!guard.ok) {
    if (guard.retryAfterSeconds) response.setHeader?.("Retry-After", String(guard.retryAfterSeconds));
    response.status(guard.status).json({ error: guard.message, code: guard.code });
    return;
  }

  const runtimeDiagnostics = createServerAssistantDiagnostics();
  const controller = new AbortController();
  const onAborted = () => controller.abort("client-aborted");
  request.on?.("aborted", onAborted);

  try {
    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
    const history = Array.isArray(request.body?.history) ? (request.body.history as ChatMessage[]) : [];
    const requestId = typeof request.body?.requestId === "string" && request.body.requestId.length <= 160
      ? request.body.requestId
      : undefined;
    const correlationId = typeof request.body?.correlationId === "string" && request.body.correlationId.length <= 160
      ? request.body.correlationId
      : undefined;
    const dateTimeContext =
      request.body?.context && typeof request.body.context === "object"
        ? {
            timezone: typeof request.body.context.timezone === "string" ? request.body.context.timezone : null,
            locale: typeof request.body.context.locale === "string" ? request.body.context.locale : null,
            timezoneSource: "browser" as const
          }
        : null;
    const attachmentResult = normalizeWebAttachmentPayloads(request.body?.attachments);

    if (!prompt) {
      response.status(400).json({ error: "No hay prompt para responder." });
      return;
    }
    if (!attachmentResult.ok) {
      response.status(400).json({ error: attachmentResult.error, code: "INVALID_ATTACHMENTS" });
      return;
    }

    const providerRuntime = createServerProviderRuntime({
      dateTimeTool: createServerDateTimeTool(dateTimeContext),
      workspaceTool: createUnavailableWorkspaceTool(),
      identityTool: createUnavailableIdentityTool(),
      systemTool: createServerSystemTool()
    });
    const runtimeResponse = await runTrustedAssistantRuntime(
      {
        prompt,
        history,
        origin: "web-server",
        signal: controller.signal,
        requestId,
        correlationId,
        attachments: attachmentResult.attachments,
        context: dateTimeContext
          ? { timezone: dateTimeContext.timezone ?? undefined, locale: dateTimeContext.locale ?? undefined }
          : undefined
      },
      {
        providerRuntime,
        ...runtimeDiagnostics
      }
    );

    response.status(200).json({
      ok: runtimeResponse.ok,
      output: runtimeResponse.output,
      provider: runtimeResponse.provider,
      confidence: runtimeResponse.confidence,
      capability: runtimeResponse.capability,
      classification: runtimeResponse.classification,
      routing: runtimeResponse.metadata?.routing ?? null,
      grounding: runtimeResponse.grounding,
      sources: runtimeResponse.sources,
      citations: runtimeResponse.citations,
      grounded: runtimeResponse.grounded,
      verifiedAt: runtimeResponse.verifiedAt,
      warnings: runtimeResponse.warnings,
      tool: runtimeResponse.tool,
      conflicts: runtimeResponse.metadata?.conflicts ?? []
    });
  } catch (cause) {
    const error = normalizeTrustedAssistantError(cause, {
      code: "CHAT_HANDLER_ERROR",
      component: "WebChatHandler",
      provider: "web-api",
      kind: "api",
      safeMessage: "No pude procesar la solicitud del asistente. Inténtalo de nuevo."
    });
    runtimeDiagnostics.diagnostics?.log({
      type: "assistant.failed",
      capability: "unknown",
      tool: "WebChatHandler",
      provider: error.provider,
      durationMs: 0,
      error
    });
    response.status(500).json({
      error: runtimeDiagnostics.development
        ? `${error.safeMessage} [${error.code}] ${error.message}`
        : error.safeMessage,
      code: error.code
    });
  } finally {
    request.removeListener?.("aborted", onAborted);
  }
}
