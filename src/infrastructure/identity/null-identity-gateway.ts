import type { IdentityGateway } from "./identity-gateway";

export class NullIdentityGateway implements IdentityGateway {
  isAvailable() {
    return false;
  }

  async getBootstrap() {
    return null;
  }

  async updateProfile() {
    return null;
  }

  async prepareLink() {
    return null;
  }
}
