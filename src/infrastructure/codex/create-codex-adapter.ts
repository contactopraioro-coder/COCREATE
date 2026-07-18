import type { CodexAdapter } from "../../../shared/codex-contracts.js";
import { DesktopCodexAdapter } from "./desktop-codex-adapter.js";
import { WebCodexAdapter } from "./web-codex-adapter.js";

export function createCodexAdapter(): CodexAdapter {
  if (window.overlayBridge) {
    return new DesktopCodexAdapter();
  }

  return new WebCodexAdapter();
}
