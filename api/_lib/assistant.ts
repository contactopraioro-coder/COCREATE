import { runTrustedAssistantRuntime } from "../../shared/trusted-assistant-runtime.js";
import {
  createServerAssistantDiagnostics,
  createServerDateTimeTool,
  createServerSystemTool,
  createUnavailableIdentityTool,
  createUnavailableWorkspaceTool
} from "./trusted-assistant-tools.js";
import { createServerProviderRuntime } from "./server-provider-runtime.js";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  body: string;
};

type ChatRequest = {
  prompt: string;
  history?: ChatMessage[];
  context?: {
    timezone?: string;
    locale?: string;
  };
};

type TranscriptionRequest = {
  audioBase64: string;
  mimeType: string;
  language?: string;
};

type ChatResult = {
  ok: boolean;
  output: string;
  provider: string;
  confidence: "Verified" | "VerifiedWithConflict" | "InsufficientEvidence" | "Derived" | "Estimated" | "Unavailable";
  capability: string;
  classification: string;
  routing: Record<string, unknown> | null;
  grounded: boolean;
  verifiedAt?: string;
  sources: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  warnings: string[];
};

type TranscriptionResult = {
  ok: boolean;
  text: string;
  provider: string;
};

const defaultTranscribeModel = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";

export async function generateAssistantReply({ prompt, history = [], context }: ChatRequest): Promise<ChatResult> {
  const providerRuntime = createServerProviderRuntime({
    dateTimeTool: createServerDateTimeTool(
      context
        ? {
            timezone: context.timezone,
            locale: context.locale,
            timezoneSource: "browser"
          }
        : null
    ),
    workspaceTool: createUnavailableWorkspaceTool(),
    identityTool: createUnavailableIdentityTool(),
    systemTool: createServerSystemTool()
  });
  const result = await runTrustedAssistantRuntime(
    {
      prompt,
      history,
      context
    },
    {
      providerRuntime,
      ...createServerAssistantDiagnostics()
    }
  );

  return {
    ok: result.ok,
    output: result.output,
    provider: result.provider,
    confidence: result.confidence,
    capability: result.capability,
    classification: result.classification,
    routing: (result.metadata?.routing as Record<string, unknown> | undefined) ?? null,
    grounded: result.grounded,
    verifiedAt: result.verifiedAt,
    sources: result.sources,
    citations: result.citations,
    warnings: result.warnings
  };
}

export async function transcribeAudio({ audioBase64, mimeType, language = "es" }: TranscriptionRequest): Promise<TranscriptionResult> {
  const result = await createServerProviderRuntime().execute({
    operation: "transcription",
    capability: "transcription",
    input: { audioBase64, mimeType, language, model: defaultTranscribeModel }
  });
  const text = result.output?.trim() ?? "";
  if (!text) {
    throw new Error("La transcripción llegó vacía.");
  }

  return {
    ok: true,
    text,
    provider: result.provider
  };
}
