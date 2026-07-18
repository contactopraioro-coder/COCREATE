import type { GitContext } from "../../app/services/git-context-service.js";

export function createGitContextLoader() {
  if (!window.overlayBridge?.getGitContext) return undefined;
  return (): Promise<GitContext> => window.overlayBridge!.getGitContext();
}

