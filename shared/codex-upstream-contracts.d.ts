export type CodexRuntimeMode = "app-server" | "exec" | "auto";
export type CodexProcessState =
  | "stopped"
  | "starting"
  | "initializing"
  | "ready"
  | "degraded"
  | "restarting"
  | "failed"
  | "stopping";
export type CodexUpstreamCompatibility =
  | "compatible"
  | "compatible-with-warnings"
  | "unsupported-version"
  | "binary-missing"
  | "initialization-failed";

export type CodexUpstreamErrorCode =
  | "CODEX_APP_SERVER_UNAVAILABLE"
  | "CODEX_APP_SERVER_INCOMPATIBLE"
  | "CODEX_APP_SERVER_INITIALIZATION_FAILED"
  | "CODEX_APP_SERVER_PROTOCOL_ERROR"
  | "CODEX_APP_SERVER_TIMEOUT"
  | "CODEX_APP_SERVER_CLOSED"
  | "CODEX_APPROVAL_UNAVAILABLE"
  | "CODEX_THREAD_NOT_FOUND";

export interface CodexUpstreamStatus {
  available: boolean;
  binaryFound: boolean;
  binaryPath: string;
  codexVersion: string | null;
  validatedVersion: string;
  protocolVersion: string;
  compatibility: CodexUpstreamCompatibility;
  processState: CodexProcessState;
  initialized: boolean;
  authenticated: boolean;
  authMode: "chatgpt" | "api-key" | "unknown" | "none";
  capabilities: Record<string, boolean>;
  webSearch: { supported: boolean; mode: "disabled" | "cached" | "live" };
  mcp: { supported: boolean; configuredServers: number | null };
  activeThreads: number;
  activeTurns: number;
  restartCount: number;
  lastError: { code: string; safeMessage: string } | null;
  updatedAt: string;
}

export interface CodexThreadMapping {
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  codexThreadId: string;
  codexRuntimeVersion: string;
  codexProtocolVersion: string;
  mappedAt: string;
}

export interface CoCreateCodexEvent {
  type: string;
  timestamp: string;
  executionId: string | null;
  codexThreadId: string | null;
  codexTurnId: string | null;
  codexRuntimeVersion: string;
  codexProtocolVersion: string;
  data: Record<string, unknown>;
}

export const CODEX_UPSTREAM_VALIDATED_VERSION: "0.134.0";
export const CODEX_UPSTREAM_PROTOCOL_VERSION: "v2";
export const CODEX_RUNTIME_MODES: readonly CodexRuntimeMode[];
export declare function resolveCodexRuntimeMode(value: unknown): CodexRuntimeMode;
export declare function normalizeCodexVersion(value: unknown): string | null;
export declare function evaluateCodexUpstreamCompatibility(
  version: string | null,
  validatedVersion?: string
): CodexUpstreamCompatibility;
export declare function createCodexUpstreamError(
  code: CodexUpstreamErrorCode,
  message: string,
  options?: { safeMessage?: string; retriable?: boolean; details?: Record<string, unknown> }
): Error & {
  code: CodexUpstreamErrorCode;
  safeMessage: string;
  retriable: boolean;
  details?: Record<string, unknown>;
};
export declare function toCodexUpstreamError(cause: unknown, fallbackCode?: CodexUpstreamErrorCode): ReturnType<typeof createCodexUpstreamError>;
export declare function redactCodexDiagnostic(value: unknown, maxLength?: number): string;
export declare function createCodexUpstreamEvent(
  type: string,
  input?: Partial<Omit<CoCreateCodexEvent, "type" | "timestamp">>
): CoCreateCodexEvent;
