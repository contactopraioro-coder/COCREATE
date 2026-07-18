import type { UpstreamCapabilitiesGateway } from "../../app/services/upstream-stability-service.js";

export function createUpstreamCapabilitiesGateway(): UpstreamCapabilitiesGateway | undefined {
  const bridge = window.overlayBridge;
  if (!bridge?.getUpstreamCapabilities || !bridge.listUpstreamPlanModes || !bridge.listUpstreamExtensions) return undefined;
  return {
    getSnapshot: () => bridge.getUpstreamCapabilities(),
    listPlanModes: () => bridge.listUpstreamPlanModes(),
    listExtensions: () => bridge.listUpstreamExtensions(),
    refresh: () => bridge.refreshUpstreamCapabilities(),
    subscribe: (listener) => bridge.onUpstreamCapabilitiesChanged(listener)
  };
}
