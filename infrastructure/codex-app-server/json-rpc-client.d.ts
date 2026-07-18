import type { Readable, Writable } from "node:stream";

export declare class CodexAppServerJsonRpcClient {
  constructor(options: {
    readable: Readable;
    writable: Writable;
    maxMessageBytes?: number;
    requestTimeoutMs?: number;
    onDiagnostic?: (diagnostic: Record<string, unknown>) => void;
  });
  subscribe(listener: (notification: { method: string; params?: any }) => void): () => void;
  subscribeUnknown(listener: (event: Record<string, unknown>) => void): () => void;
  setServerRequestHandler(handler: ((request: { id: number; method: string; params?: any }) => Promise<any>) | null): void;
  request(method: string, params?: unknown, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<any>;
  notify(method: string, params?: unknown): Promise<void>;
  respond(id: number, result: unknown): Promise<void>;
  respondError(id: number, code: number, message: string): Promise<void>;
  dispose(reason?: string): void;
}
