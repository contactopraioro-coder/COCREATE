import { BrowserWorkspaceGateway } from "./browser-workspace-gateway";
import type { WorkspaceGateway } from "./workspace-gateway";
import { DesktopWorkspaceGateway } from "./desktop-workspace-gateway";

export function createWorkspaceGateway(): WorkspaceGateway {
  if (window.overlayBridge?.getWorkspaceBootstrap) {
    return new DesktopWorkspaceGateway();
  }

  return new BrowserWorkspaceGateway();
}
