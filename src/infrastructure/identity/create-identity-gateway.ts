import { BrowserIdentityGateway } from "./browser-identity-gateway";
import { DesktopIdentityGateway } from "./desktop-identity-gateway";
import type { IdentityGateway } from "./identity-gateway";

export function createIdentityGateway(): IdentityGateway {
  if (window.overlayBridge?.getIdentityBootstrap) {
    return new DesktopIdentityGateway();
  }

  return new BrowserIdentityGateway();
}
