export type TrustedAssistantConfidence = "Verified" | "VerifiedWithConflict" | "InsufficientEvidence" | "Derived" | "Estimated" | "Unavailable";

export type TrustedAssistantResponse = {
  ok: boolean;
  output: string;
  confidence: TrustedAssistantConfidence;
  capability: string;
  grounding: string[];
  sources: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  grounded: boolean;
  verifiedAt?: string;
  warnings: string[];
  tool: string | null;
  provider: string;
  metadata: Record<string, unknown>;
  classification: string;
};

export declare function analyzeAssistantIntent(input?: {
  prompt?: string;
  history?: unknown[];
  origin?: string;
}): {
  prompt: string;
  normalized: string;
  capabilities: string[];
  primaryCapability: string;
  primaryIntent: string;
  providerCapability: string;
  classification: string;
  expectedConfidence: TrustedAssistantConfidence;
  requiresCurrentVerification: boolean;
  asksDateTime: boolean;
  asksWorkspace: boolean;
  asksIdentity: boolean;
  asksSystem: boolean;
  asksCode: boolean;
  asksCurrentInfo: boolean;
  asksWeb: boolean;
  routingSignals: string[];
  capabilityPriority: string[];
};

export declare function buildTrustedResponse(input?: Record<string, unknown>): TrustedAssistantResponse;

export type TrustedAssistantError = Error & {
  code: string;
  component: string;
  provider: string;
  kind: string;
  safeMessage: string;
  retriable: boolean;
};

export declare function createTrustedAssistantError(
  code: string,
  message: string,
  details?: {
    component?: string;
    provider?: string;
    kind?: string;
    safeMessage?: string;
    retriable?: boolean;
    cause?: unknown;
  }
): TrustedAssistantError;

export declare function normalizeTrustedAssistantError(
  error: unknown,
  context?: Record<string, unknown>
): {
  code: string;
  component: string;
  provider: string;
  kind: string;
  message: string;
  safeMessage: string;
  retriable: boolean;
  stack: string | null;
};

export declare function runTrustedAssistantRuntime(
  input?: {
    prompt?: string;
    history?: unknown[];
    origin?: string;
    signal?: AbortSignal;
    requestId?: string;
    correlationId?: string;
    model?: string;
    effort?: string;
    collaborationMode?: Record<string, unknown> | null;
    attachments?: Array<Record<string, unknown>>;
    skills?: Array<Record<string, unknown>>;
    context?: { locale?: string; timezone?: string; countryHint?: string };
  },
  runtime?: Record<string, any>
): Promise<TrustedAssistantResponse>;
