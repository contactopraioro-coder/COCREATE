export type IdentityBootstrap = {
  identity: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  device: Record<string, unknown> | null;
  preparedLink: Record<string, unknown> | null;
};

export type IdentityGateway = {
  isAvailable: () => boolean;
  getBootstrap: () => Promise<IdentityBootstrap | null>;
  updateProfile: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  prepareLink: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
};
