import type {
  CancelCodexExecutionRequest,
  CodexExecutionEvent,
  CodexExecutionId,
  CodexStatus,
  StartCodexExecutionRequest
} from "./codex-contracts";

export interface CodexExecuteIpcResponse {
  ok: true;
  executionId: CodexExecutionId;
}

export interface CodexCancelIpcResponse {
  ok: boolean;
  executionId: CodexExecutionId;
  alreadyTerminated: boolean;
}

export const CODEX_IPC_CHANNELS: {
  readonly getStatus: "cocreate:codex:get-status";
  readonly listModels: "cocreate:codex:list-models";
  readonly execute: "cocreate:codex:execute";
  readonly cancel: "cocreate:codex:cancel";
  readonly events: "cocreate:codex:events";
};

export declare function assertStartCodexExecutionRequest(
  value: unknown
): asserts value is StartCodexExecutionRequest;
export declare function assertCancelCodexExecutionRequest(
  value: unknown
): asserts value is CancelCodexExecutionRequest;
export declare function assertCodexExecutionEvent(
  value: unknown
): asserts value is CodexExecutionEvent;
export declare function createStatusResponse(status: CodexStatus): CodexStatus;
