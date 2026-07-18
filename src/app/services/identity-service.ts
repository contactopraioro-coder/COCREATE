import type { IdentityGateway } from "../../infrastructure/identity/identity-gateway.js";

export class IdentityService {
  constructor(private readonly gateway: IdentityGateway) {}

  async getBootstrap() {
    return this.gateway.getBootstrap();
  }

  async getCurrentIdentity() {
    const bootstrap = await this.gateway.getBootstrap();
    return bootstrap?.identity ?? null;
  }

  async getUserProfile() {
    const bootstrap = await this.gateway.getBootstrap();
    return bootstrap?.profile ?? null;
  }

  async getCurrentDevice() {
    const bootstrap = await this.gateway.getBootstrap();
    return bootstrap?.device ?? null;
  }

  async updateUserProfile(patch: Record<string, unknown>) {
    return this.gateway.updateProfile(patch);
  }

  async prepareAccountLink(payload: Record<string, unknown> = {}) {
    return this.gateway.prepareLink(payload);
  }
}
