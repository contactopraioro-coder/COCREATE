import type { CodexAdapter } from "../../shared/codex-contracts.js";
import type { CodexRuntimeMode } from "../../shared/codex-upstream-contracts.js";

export declare function createCodexRuntimeAdapter(options: {
  appServerAdapter: CodexAdapter;
  execAdapter: CodexAdapter;
  mode?: CodexRuntimeMode;
}): CodexAdapter;
