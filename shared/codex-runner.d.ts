import type {
  CancelCodexExecutionRequest,
  CodexAdapter,
  CodexExecutionObserver,
  CodexStatus,
  StartCodexExecutionRequest
} from "./codex-contracts";

export interface NodeCodexAdapterOptions {
  binary?: string;
  cwd?: string;
  defaultOrigin?: StartCodexExecutionRequest["origin"];
  timeoutMs?: number;
  execFileAsync?: (
    file: string,
    args: string[],
    options: { timeout?: number }
  ) => Promise<{ stdout: string; stderr: string }>;
  spawnFactory?: (
    file: string,
    args: string[],
    options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] }
  ) => {
    stdout: {
      on: (event: "data", listener: (chunk: Buffer | string) => void) => void;
    };
    stderr: {
      on: (event: "data", listener: (chunk: Buffer | string) => void) => void;
    };
    stdin: {
      write: (value: string) => void;
      end: () => void;
    };
    on: (event: "error" | "close", listener: (...args: unknown[]) => void) => void;
    kill: (signal?: "SIGTERM") => void;
  };
}

export declare function resolveCodexStatus(options?: NodeCodexAdapterOptions): Promise<CodexStatus>;
export declare function createNodeCodexAdapter(options?: NodeCodexAdapterOptions): CodexAdapter;
export declare function collectExecutionOutput(
  adapter: CodexAdapter,
  request: StartCodexExecutionRequest,
  observer?: CodexExecutionObserver
): Promise<{
  ok: boolean;
  output: string;
  executionId: string;
  diagnostics?: string;
}>;
export declare function cancelActiveExecution(
  adapter: CodexAdapter,
  request: CancelCodexExecutionRequest
): Promise<{
  ok: boolean;
  executionId: string;
  alreadyTerminated: boolean;
}>;
export declare function getCodexCompatibilityPolicy(): {
  validatedVersion: string;
  minimumSupportedVersion: string;
  distribution: "external-binary-required";
};
