import type { IdentityBootstrap, IdentityGateway } from "./identity-gateway.js";

const storageKey = "cocreate-browser-identity-v1";

type BrowserIdentityState = IdentityBootstrap & {
  schemaVersion: 1;
};

function createId(prefix: string) {
  const seed = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${seed}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createInitialState(): BrowserIdentityState {
  const createdAt = nowIso();
  const identityId = createId("identity_local_web");
  return {
    schemaVersion: 1,
    identity: {
      id: identityId,
      type: "local",
      status: "active",
      displayName: "Local User",
      createdAt,
      updatedAt: createdAt,
      linkedAccountId: null,
      linkedAt: null,
      metadata: { runtime: "browser" }
    },
    profile: {
      id: createId("profile"),
      identityId,
      displayName: "Local User",
      locale: navigator.language || "es-CO",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt,
      updatedAt: createdAt,
      schemaVersion: 1,
      metadata: {}
    },
    device: {
      id: createId("device"),
      identityId,
      name: "Web Browser",
      platform: navigator.platform || "web",
      architecture: "browser",
      appVersion: "0.0.1",
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
      metadata: { userAgent: navigator.userAgent }
    },
    preparedLink: null
  };
}

function readState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as BrowserIdentityState | null;
    if (parsed?.schemaVersion === 1 && parsed.identity && parsed.profile && parsed.device) {
      return parsed;
    }
  } catch {
    // Invalid local state is replaced with a valid local identity.
  }

  const initial = createInitialState();
  window.localStorage.setItem(storageKey, JSON.stringify(initial));
  return initial;
}

function writeState(state: BrowserIdentityState) {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
  return state;
}

function containsSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const forbidden = new Set(["password", "accessToken", "refreshToken", "apiKey", "secret", "token", "cookie"]);
  return Object.entries(value).some(([key, nested]) => forbidden.has(key) || containsSensitiveKey(nested));
}

export class BrowserIdentityGateway implements IdentityGateway {
  isAvailable() {
    return true;
  }

  async getBootstrap() {
    const state = readState();
    const timestamp = nowIso();
    return writeState({
      ...state,
      device: state.device
        ? {
            ...state.device,
            updatedAt: timestamp,
            lastSeenAt: timestamp
          }
        : null
    });
  }

  async updateProfile(payload: Record<string, unknown>) {
    if (containsSensitiveKey(payload)) {
      throw new Error("El perfil local no admite secretos ni credenciales.");
    }

    const state = readState();
    const allowedKeys = [
      "displayName",
      "locale",
      "timezone",
      "technicalLevel",
      "communicationPreferences",
      "accessibilityPreferences",
      "editorPreferences",
      "aiPreferences"
    ];
    const patch = Object.fromEntries(Object.entries(payload).filter(([key]) => allowedKeys.includes(key)));
    const profile = {
      ...(state.profile ?? {}),
      ...patch,
      updatedAt: nowIso()
    };
    writeState({ ...state, profile });
    return profile;
  }

  async prepareLink(payload: Record<string, unknown> = {}) {
    if (containsSensitiveKey(payload)) {
      throw new Error("La preparación de cuenta no admite secretos ni credenciales.");
    }

    const state = readState();
    const timestamp = nowIso();
    const preparedLink = {
      id: createId("identity_link"),
      identityId: state.identity?.id ?? null,
      status: "prepared",
      createdAt: timestamp,
      updatedAt: timestamp,
      linkedAccountId: null,
      metadata: payload
    };
    writeState({ ...state, preparedLink });
    return preparedLink;
  }
}
