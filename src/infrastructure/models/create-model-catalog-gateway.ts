import type { CodexModelOption } from "../../app/services/model-selection-service.js";

export function createModelCatalogLoader() {
  if (!window.overlayBridge?.listCodexModels) return undefined;
  return (): Promise<{ data: CodexModelOption[]; unavailableReason?: string }> => window.overlayBridge!.listCodexModels();
}
