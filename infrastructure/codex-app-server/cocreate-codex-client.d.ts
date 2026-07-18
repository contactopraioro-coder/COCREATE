import type { CodexUpstreamStatus } from "../../shared/codex-upstream-contracts.js";

export interface CoCreateCodexClientOptions {
  processManager: {
    ensureReady(): Promise<CodexUpstreamStatus>;
    getStatus(): CodexUpstreamStatus;
    getClient(): { request(method: string, params?: unknown, options?: unknown): Promise<any> };
    subscribe(listener: (notification: { method: string; params?: any }) => void): () => void;
    setServerRequestHandler(handler: ((request: { method: string; params?: any }) => Promise<any>) | null): void;
  };
}

export declare class CoCreateCodexClient {
  constructor(options: CoCreateCodexClientOptions);
  getStatus(): Promise<CodexUpstreamStatus>;
  createThread(input?: Record<string, any>): Promise<any>;
  resumeThread(threadId: string, input?: Record<string, any>): Promise<any>;
  readThread(threadId: string, includeTurns?: boolean): Promise<any>;
  listThreads(input?: Record<string, any>): Promise<any>;
  listTurns(threadId: string, input?: Record<string, any>): Promise<any>;
  startTurn(threadId: string, prompt: string, input?: Record<string, any>): Promise<any>;
  interruptTurn(threadId: string, turnId: string): Promise<any>;
  getAccount(): Promise<any>;
  listMcpServers(): Promise<any>;
  listModels(input?: Record<string, any>): Promise<any>;
  subscribe(listener: (notification: { method: string; params?: any }) => void): () => void;
  setServerRequestHandler(handler: ((request: { method: string; params?: any }) => Promise<any>) | null): void;
}
