import { WorkspaceRuntimeService } from "./workspace-runtime-service.js";

export class WorkspaceOwnershipService {
  constructor(private readonly workspaceRuntimeService: WorkspaceRuntimeService) {}

  async getWorkspaceOwner() {
    const bootstrap = await this.workspaceRuntimeService.getBootstrap();
    return bootstrap?.ownership?.workspaceOwner ?? null;
  }
}
