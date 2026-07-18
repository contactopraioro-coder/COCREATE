import type { CodexExecutionEvent } from "../../../shared/codex-contracts.js";
import { redactCodexDiagnostic } from "../../../shared/codex-upstream-contracts.js";
import { normalizeWebAttachmentPayloads } from "../../../shared/web-attachment-contracts.js";
import type { VisualInstructionContext } from "./visual-collaboration-service.js";
import { CodexExecutionService } from "./codex-execution-service.js";

function visualText(value: unknown, fallback: string, limit = 120) {
  const text = redactCodexDiagnostic(typeof value === "string" ? value : "", limit).replace(/\s+/g, " ").trim();
  return text || fallback;
}

function safeVisualLocation(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function buildVisualInstructionPrompt(prompt: string, value: unknown, proposalWorkspace = false) {
  if (!value || typeof value !== "object" || (value as { mode?: unknown }).mode !== "visual-collaboration") return prompt;
  const context = value as Partial<VisualInstructionContext>;
  const preview = context.preview && typeof context.preview === "object" ? context.preview : null;
  const selection = context.selection && typeof context.selection === "object" ? context.selection : null;
  const workspace = context.workspace && typeof context.workspace === "object" ? context.workspace : null;
  const lines = [
    "Contexto visual compartido por CoCreate (datos de producto, no inspección del DOM):",
    `- Vista actual: ${visualText(preview?.title, "Aplicación actual")}`,
    `- Dirección segura: ${safeVisualLocation(preview?.location) ?? "no disponible"}`,
    `- Viewport: ${visualText(preview?.viewport, "no disponible", 32)}`,
    selection
      ? `- Elemento al que se refiere el usuario: ${visualText(selection.label, "Elemento seleccionado", 80)} (${visualText(selection.location, "vista actual", 80)})`
      : "- Elemento seleccionado: ninguno",
    `- Project: ${visualText(workspace?.project, "sin Project", 100)}`,
    `- Task: ${visualText(workspace?.task, "sin Task", 100)}`,
    proposalWorkspace
      ? "No asumas detalles visuales que este contexto no contiene. Implementa la instrucción únicamente dentro del Proposal Workspace actual; no modifiques Current, no hagas commit y no hagas push."
      : "No asumas detalles visuales que este contexto no contiene. Describe una propuesta y no apliques archivos sin aprobación explícita."
  ];
  return `${prompt}\n\n${lines.join("\n")}`;
}

export class CodexConversationService {
  constructor(
    private readonly executionService: CodexExecutionService,
    private readonly exposure?: { consume(event: CodexExecutionEvent): unknown }
  ) {}

  async getStatus() {
    return this.executionService.getStatus();
  }

  async runPrompt(
    input: {
      prompt: string;
      history?: unknown[];
      origin: "desktop-renderer" | "web-renderer";
      clientId?: string;
      model?: string;
      effort?: string;
      collaborationMode?: Record<string, unknown> | null;
      attachments?: Array<Record<string, unknown>>;
      skills?: Array<Record<string, unknown>>;
      interactionMode?: "chat" | "live" | "proposal";
      visualContext?: Record<string, unknown> | null;
      proposalWorkspaceId?: string;
      proposalContext?: Record<string, unknown> | null;
      signal?: AbortSignal;
    },
    callbacks?: {
      onEvent?: (event: CodexExecutionEvent) => void;
    }
  ) {
    const webAttachmentCandidates = (input.attachments ?? []).filter((attachment) => attachment.source === "web");
    const webAttachments = normalizeWebAttachmentPayloads(webAttachmentCandidates);
    if (!webAttachments.ok) throw new Error(webAttachments.error);
    let streamedOutput = "";
    const handle = await this.executionService.executePrompt(
      {
        prompt: buildVisualInstructionPrompt(input.prompt, input.visualContext, Boolean(input.proposalWorkspaceId)),
        origin: input.origin,
        metadata: {
          history: input.history ?? [],
          clientId: input.clientId ?? null,
          model: input.model ?? null,
          effort: input.effort ?? null,
          collaborationMode: input.collaborationMode ?? null,
          attachmentTokens: (input.attachments ?? []).map((attachment) => attachment.token).filter((token): token is string => typeof token === "string"),
          webAttachments: webAttachments.attachments,
          skillTokens: (input.skills ?? []).map((skill) => skill.token).filter((token): token is string => typeof token === "string"),
          interactionMode: input.proposalWorkspaceId ? "proposal" : input.interactionMode === "live" ? "live" : "chat",
          proposalWorkspaceId: input.proposalWorkspaceId ?? null,
          proposalContext: input.proposalContext ?? null
        }
      },
      (event) => {
        this.exposure?.consume(event);
        if (event.type === "execution.output") {
          streamedOutput += event.chunk;
        }
        callbacks?.onEvent?.(event);
      }
    );

    const cancelOnAbort = () => { void handle.cancel("provider-aborted"); };
    if (input.signal?.aborted) cancelOnAbort();
    else input.signal?.addEventListener("abort", cancelOnAbort, { once: true });
    const terminalEvent = await handle.completed.finally(() => {
      input.signal?.removeEventListener("abort", cancelOnAbort);
    });
    if (terminalEvent.type === "execution.completed") {
      return {
        ok: true,
        output: terminalEvent.output || streamedOutput
      };
    }

    if (terminalEvent.type === "execution.cancelled") {
      return {
        ok: false,
        output: streamedOutput || "La ejecución fue cancelada."
      };
    }

    throw new Error(terminalEvent.error.safeMessage);
  }
}
