import { runTrustedAssistantRuntime } from "../../../shared/trusted-assistant-runtime.js";
import { createTrustedWebRequestId } from "../../../shared/trusted-web-contracts.js";
import { CapabilityRouter } from "./capability-router.js";
import type { CodexConversationService } from "./codex-conversation-service.js";
import type { IdentityService } from "./identity-service.js";
import { TrustedResponseService } from "./trusted-response-service.js";
import type { WorkspaceRuntimeService } from "./workspace-runtime-service.js";
import { createDesktopAssistantTools } from "../../infrastructure/assistant/desktop-assistant-tools.js";
import { createRendererProviderRuntime } from "../../infrastructure/providers/create-renderer-provider-runtime.js";

export class AssistantRuntimeService {
  private readonly capabilityRouter = new CapabilityRouter();
  private readonly trustedResponseService = new TrustedResponseService();

  constructor(
    private readonly codexConversationService: CodexConversationService,
    private readonly workspaceRuntimeService: WorkspaceRuntimeService,
    private readonly identityService: IdentityService
  ) {}

  async respond(input: {
    prompt: string;
    history?: unknown[];
    origin: "desktop-renderer" | "web-renderer";
    clientId?: string;
    signal?: AbortSignal;
    model?: string;
    effort?: string;
    collaborationMode?: Record<string, unknown> | null;
    attachments?: Array<Record<string, unknown>>;
    skills?: Array<Record<string, unknown>>;
    interactionMode?: "chat" | "live" | "proposal";
    visualContext?: Record<string, unknown> | null;
    proposalWorkspaceId?: string;
    proposalContext?: Record<string, unknown> | null;
  }) {
    const routing = this.capabilityRouter.resolve(input);
    const webRequestId = routing.primaryCapability === "web" ? createTrustedWebRequestId("web") : undefined;
    const webStartedAt = webRequestId ? new Date().toISOString() : undefined;
    const profile = await this.identityService.getUserProfile().catch(() => null);
    const development = import.meta.env.DEV;
    const tools = createDesktopAssistantTools({
      identityService: this.identityService,
      workspaceRuntimeService: this.workspaceRuntimeService
    });
    const providerRuntime = createRendererProviderRuntime({
      tools,
      codexConversationService: this.codexConversationService,
      origin: input.origin,
      clientId: input.clientId,
      development
    });

    if (webRequestId && input.origin === "web-renderer") {
      await this.workspaceRuntimeService.recordWebExecution({
        type: "web.execution.started",
        requestId: webRequestId,
        timestamp: webStartedAt,
        queryPreview: input.prompt.slice(0, 180)
      }).catch(() => null);
    }

    const response = await runTrustedAssistantRuntime({
      ...input,
      requestId: webRequestId,
      correlationId: webRequestId,
      context: {
        locale: typeof profile?.locale === "string" ? profile.locale : undefined,
        timezone: typeof profile?.timezone === "string"
          ? profile.timezone
          : Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    }, {
      providerRuntime,
      development,
      diagnostics: development
        ? {
            log(event: Record<string, unknown>) {
              const logger = event.type === "assistant.failed" ? console.error : console.debug;
              logger("[TrustedAssistantRuntime]", event);
            }
          }
        : undefined
    });

    if (webRequestId && input.origin === "web-renderer") {
      const timestamp = new Date().toISOString();
      await this.workspaceRuntimeService.recordWebExecution({
        type: response.ok
          ? "web.execution.completed"
          : response.metadata?.errorCode === "WEB_CANCELLED"
            ? "web.execution.cancelled"
            : "web.execution.failed",
        requestId: webRequestId,
        timestamp,
        startedAt: webStartedAt,
        provider: response.metadata?.searchProvider ?? response.provider,
        sourcesCount: response.sources.length,
        verifiedAt: response.verifiedAt ?? null,
        confidence: response.confidence,
        error: response.ok ? null : {
          code: response.metadata?.errorCode ?? "WEB_PROVIDER_UNAVAILABLE",
          safeMessage: response.output
        }
      }).catch(() => null);
    }

    if (!response.output) {
      return this.trustedResponseService.unavailable(
        "No pude construir una respuesta confiable para esta solicitud.",
        routing.primaryCapability
      );
    }

    return response;
  }
}
