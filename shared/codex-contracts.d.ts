export type CodexExecutionId = string;

export type CodexExecutionOrigin =
  | "desktop-renderer"
  | "web-renderer"
  | "vite-dev-api"
  | "legacy-bridge"
  | "test";

export type CodexExecutionStage =
  | "queued"
  | "starting"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type CodexOutputStream = "stdout" | "stderr";

export type CodexErrorCode =
  | "CODEX_UNAVAILABLE"
  | "EXECUTABLE_NOT_FOUND"
  | "PROCESS_EXITED"
  | "TIMEOUT"
  | "CANCELLED"
  | "IPC_ERROR"
  | "INVALID_PAYLOAD"
  | "UNKNOWN";

export interface CodexError {
  code: CodexErrorCode;
  message: string;
  safeMessage: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}

export interface CodexStatus {
  available: boolean;
  binary: string;
  version: string | null;
  compatible: boolean;
  validatedVersion: string;
  minimumSupportedVersion: string;
  license: string;
  source: string;
  mode: string;
  runtimeMode?: "app-server" | "exec";
  configuredMode?: "app-server" | "exec" | "auto";
  appServer?: import("./codex-upstream-contracts.js").CodexUpstreamStatus | null;
  fallback?: { active: boolean; reason: string; selectedAt: string } | null;
  error?: string;
  updatedAt: string;
}

export interface CodexUpstreamEvent {
  type: "codex.upstream";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "running";
  event: import("./codex-upstream-contracts.js").CoCreateCodexEvent;
}

export interface StartCodexExecutionRequest {
  executionId?: CodexExecutionId;
  prompt: string;
  cwd?: string;
  origin: CodexExecutionOrigin;
  ownerId?: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface CancelCodexExecutionRequest {
  executionId: CodexExecutionId;
  reason?: string;
}

export interface CodexExecutionStartedEvent {
  type: "execution.started";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "starting";
  origin: CodexExecutionOrigin;
  promptPreview: string;
}

export interface CodexExecutionOutputEvent {
  type: "execution.output";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "running";
  stream: CodexOutputStream;
  chunk: string;
}

export interface CodexExecutionProgressEvent {
  type: "execution.progress";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "starting" | "running" | "completed";
  message: string;
}

export interface CodexExecutionCompletedEvent {
  type: "execution.completed";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "completed";
  output: string;
  exitCode: number;
  diagnostics?: string;
}

export interface CodexExecutionCancelledEvent {
  type: "execution.cancelled";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "cancelled";
  reason?: string;
  output?: string;
}

export interface CodexExecutionFailedEvent {
  type: "execution.failed";
  executionId: CodexExecutionId;
  timestamp: string;
  stage: "failed";
  error: CodexError;
  diagnostics?: string;
}

export interface CodexStatusChangedEvent {
  type: "codex.statusChanged";
  timestamp: string;
  status: CodexStatus;
}

export type CodexExecutionEvent =
  | CodexExecutionStartedEvent
  | CodexExecutionOutputEvent
  | CodexExecutionProgressEvent
  | CodexExecutionCompletedEvent
  | CodexExecutionCancelledEvent
  | CodexExecutionFailedEvent
  | CodexUpstreamEvent
  | CodexStatusChangedEvent;

export type CodexTerminalEvent =
  | CodexExecutionCompletedEvent
  | CodexExecutionCancelledEvent
  | CodexExecutionFailedEvent;

export type CodexExecutionObserver = (event: CodexExecutionEvent) => void | Promise<void>;

export interface CodexExecutionHandle {
  executionId: CodexExecutionId;
  completed: Promise<CodexTerminalEvent>;
  cancel: (reason?: string) => Promise<{
    ok: boolean;
    executionId: CodexExecutionId;
    alreadyTerminated: boolean;
  }>;
}

export interface CodexAdapter {
  getStatus: () => Promise<CodexStatus>;
  execute: (
    request: StartCodexExecutionRequest,
    observer: CodexExecutionObserver
  ) => Promise<CodexExecutionHandle>;
  cancelExecution: (
    request: CancelCodexExecutionRequest
  ) => Promise<{
    ok: boolean;
    executionId: CodexExecutionId;
    alreadyTerminated: boolean;
  }>;
  dispose: () => Promise<void>;
}

export declare function createExecutionId(prefix?: string): CodexExecutionId;
export declare function createTimestamp(): string;
export declare function createCodexError(
  code: CodexErrorCode,
  message: string,
  options?: {
    safeMessage?: string;
    retriable?: boolean;
    details?: Record<string, unknown>;
  }
): CodexError;
export declare function toCodexError(error: unknown, fallbackCode?: CodexErrorCode): CodexError;
export declare function isCodexTerminalEvent(event: CodexExecutionEvent): event is CodexTerminalEvent;
export declare function getSafeCodexErrorMessage(error: CodexError): string;
