export const IDENTITY_SCHEMA_VERSION = 1;

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createIdentityId(seed = createId("identity-local")) {
  return `identity_${seed}`;
}

export function createProfileId(seed = createId("profile")) {
  return `profile_${seed}`;
}

export function createDeviceId(seed = createId("device")) {
  return `device_${seed}`;
}

export function createActorId(seed = createId("actor")) {
  return `actor_${seed}`;
}

export function createIdentityLinkId(seed = createId("identity-link")) {
  return `identity_link_${seed}`;
}

export function createWorkspaceOwnerFromIdentity(identityId) {
  return {
    type: "identity",
    id: identityId
  };
}

export function createHumanActor(identity, profile) {
  return {
    type: "human",
    id: `actor_local_${identity.id}`,
    identityId: identity.id,
    displayName: resolveProfileDisplayName(profile, identity),
    metadata: {
      identityType: identity.type
    }
  };
}

export function createSystemActor() {
  return {
    type: "system",
    id: "actor_system_cocreate",
    displayName: "CoCreate System",
    metadata: {}
  };
}

export function createCodexAgentActor() {
  return {
    type: "agent",
    id: "actor_agent_codex",
    agentId: "codex-upstream",
    displayName: "Codex",
    metadata: {
      provider: "openai/codex"
    }
  };
}

export function createLocalIdentity(input = {}) {
  return {
    id: typeof input.id === "string" && input.id ? input.id : createIdentityId(),
    type: "local",
    status: "active",
    displayName: typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim() : "Local User",
    createdAt: typeof input.createdAt === "string" ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : nowIso(),
    linkedAccountId: null,
    linkedAt: null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function createDefaultUserProfile(identity, input = {}) {
  return {
    id: typeof input.id === "string" && input.id ? input.id : createProfileId(),
    identityId: identity.id,
    displayName:
      typeof input.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim()
        : identity.displayName ?? "Local User",
    avatarRef: null,
    locale: typeof input.locale === "string" && input.locale.trim() ? input.locale.trim() : "es-CO",
    timezone: typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "America/Bogota",
    technicalLevel: typeof input.technicalLevel === "string" ? input.technicalLevel : null,
    communicationPreferences: {
      style:
        typeof input.communicationPreferences?.style === "string" ? input.communicationPreferences.style : "collaborative"
    },
    accessibilityPreferences: {
      reducedMotion: Boolean(input.accessibilityPreferences?.reducedMotion),
      highContrast: Boolean(input.accessibilityPreferences?.highContrast)
    },
    editorPreferences: {
      theme: typeof input.editorPreferences?.theme === "string" ? input.editorPreferences.theme : null
    },
    aiPreferences: {
      preferredModel:
        typeof input.aiPreferences?.preferredModel === "string" ? input.aiPreferences.preferredModel : null
    },
    createdAt: typeof input.createdAt === "string" ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : nowIso(),
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function createDeviceIdentity(identity, input = {}) {
  return {
    id: typeof input.id === "string" && input.id ? input.id : createDeviceId(),
    identityId: identity.id,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : "This Device",
    platform: typeof input.platform === "string" ? input.platform : "unknown",
    architecture: typeof input.architecture === "string" ? input.architecture : "unknown",
    appVersion: typeof input.appVersion === "string" ? input.appVersion : "0.0.0",
    createdAt: typeof input.createdAt === "string" ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : nowIso(),
    lastSeenAt: typeof input.lastSeenAt === "string" ? input.lastSeenAt : nowIso(),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function createIdentityLink(identity, input = {}) {
  return {
    id: typeof input.id === "string" && input.id ? input.id : createIdentityLinkId(),
    identityId: identity.id,
    status: "prepared",
    createdAt: typeof input.createdAt === "string" ? input.createdAt : nowIso(),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : nowIso(),
    linkedAccountId: null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function resolveProfileDisplayName(profile, identity) {
  if (profile?.displayName && typeof profile.displayName === "string" && profile.displayName.trim()) {
    return profile.displayName.trim();
  }

  if (identity?.displayName && typeof identity.displayName === "string" && identity.displayName.trim()) {
    return identity.displayName.trim();
  }

  return "Local User";
}

export function hasForbiddenSensitiveKeys(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const forbiddenKeys = ["password", "accessToken", "refreshToken", "apiKey", "secret", "token", "cookie"];
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.includes(key)) {
      return true;
    }
    if (hasForbiddenSensitiveKeys(value[key])) {
      return true;
    }
  }
  return false;
}

export function normalizeLegacyActor(actor) {
  if (actor && typeof actor === "object" && typeof actor.type === "string") {
    return actor;
  }

  if (typeof actor === "string" && actor.trim()) {
    return {
      type: actor === "system" ? "system" : "human",
      id: `actor_legacy_${actor.trim().toLowerCase().replace(/\s+/g, "_")}`,
      displayName: actor.trim(),
      metadata: {
        legacy: true
      }
    };
  }

  return createSystemActor();
}
