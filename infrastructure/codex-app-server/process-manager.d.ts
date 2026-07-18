import type { CodexUpstreamStatus } from "../../shared/codex-upstream-contracts.js";
import type { CodexAppServerJsonRpcClient } from "./json-rpc-client.js";

export declare function createCodexAppServerProcessManager(options?: Record<string, any>): {
  start(): Promise<CodexUpstreamStatus>;
  ensureReady(): Promise<CodexUpstreamStatus>;
  stop(): Promise<void>;
  restart(): Promise<CodexUpstreamStatus>;
  getStatus(): CodexUpstreamStatus;
  getClient(): CodexAppServerJsonRpcClient;
  setServerRequestHandler(handler: ((request: any) => Promise<any>) | null): void;
  setActivityCounts(counts: { threads?: number; turns?: number }): void;
  subscribe(listener: (notification: any) => void): () => void;
  subscribeLifecycle(listener: (event: any) => void): () => void;
  subscribeUnknown(listener: (event: any) => void): () => void;
};
