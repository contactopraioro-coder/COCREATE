import type { IdentityGateway } from "./identity-gateway";

export class DesktopIdentityGateway implements IdentityGateway {
  isAvailable() {
    return Boolean(window.overlayBridge?.getIdentityBootstrap);
  }

  async getBootstrap() {
    if (!window.overlayBridge?.getIdentityBootstrap) {
      return null;
    }

    return window.overlayBridge.getIdentityBootstrap();
  }

  async updateProfile(payload: Record<string, unknown>) {
    if (!window.overlayBridge?.updateIdentityProfile) {
      return null;
    }

    return window.overlayBridge.updateIdentityProfile(payload);
  }

  async prepareLink(payload: Record<string, unknown> = {}) {
    if (!window.overlayBridge?.prepareIdentityLink) {
      return null;
    }

    return window.overlayBridge.prepareIdentityLink(payload);
  }
}
