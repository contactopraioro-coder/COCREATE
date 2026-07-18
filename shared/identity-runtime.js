import {
  createCodexAgentActor,
  createDefaultUserProfile,
  createDeviceIdentity,
  createHumanActor,
  createIdentityLink,
  createLocalIdentity,
  createSystemActor,
  hasForbiddenSensitiveKeys,
  nowIso,
  normalizeLegacyActor
} from "./identity-domain.js";

export function createIdentityRuntime({ store }) {
  async function initialize(context = {}) {
    return store.update(async (state) => {
      if (!state.identity) {
        state.identity = createLocalIdentity({
          displayName: context.defaultDisplayName
        });
        state.events.push({
          id: `identity-event-${Date.now()}`,
          type: "identity.localCreated",
          version: 1,
          timestamp: nowIso(),
          actor: createSystemActor(),
          payload: {
            identityId: state.identity.id
          }
        });
      }

      if (!state.profile) {
        state.profile = createDefaultUserProfile(state.identity, {
          locale: context.locale,
          timezone: context.timezone
        });
        state.events.push({
          id: `identity-event-${Date.now()}-profile`,
          type: "profile.created",
          version: 1,
          timestamp: nowIso(),
          actor: createSystemActor(),
          payload: {
            profileId: state.profile.id
          }
        });
      }

      if (!state.device) {
        state.device = createDeviceIdentity(state.identity, {
          platform: context.platform,
          architecture: context.architecture,
          appVersion: context.appVersion,
          name: context.deviceName
        });
        state.events.push({
          id: `identity-event-${Date.now()}-device`,
          type: "device.registered",
          version: 1,
          timestamp: nowIso(),
          actor: createSystemActor(),
          payload: {
            deviceId: state.device.id
          }
        });
      }

      state.device.lastSeenAt = nowIso();
      state.device.appVersion = context.appVersion ?? state.device.appVersion;
      state.device.platform = context.platform ?? state.device.platform;
      state.device.architecture = context.architecture ?? state.device.architecture;
    });
  }

  async function getSnapshot() {
    const state = await store.load();
    return {
      identity: state.identity,
      profile: state.profile,
      device: state.device,
      preparedLink: state.preparedLink ?? null
    };
  }

  async function getOrCreateLocalIdentity(context = {}) {
    await initialize(context);
    const state = await store.load();
    return state.identity;
  }

  async function getCurrentIdentity() {
    const state = await store.load();
    return state.identity;
  }

  async function getCurrentActor() {
    const state = await store.load();
    if (!state.identity) {
      return createSystemActor();
    }

    return createHumanActor(state.identity, state.profile);
  }

  async function getUserProfile() {
    const state = await store.load();
    return state.profile;
  }

  async function updateUserProfile(patch = {}) {
    const state = await store.update(async (current) => {
      if (!current.identity || !current.profile) {
        throw new Error("No existe una identidad local activa para actualizar el perfil.");
      }

      if (hasForbiddenSensitiveKeys(patch)) {
        throw new Error("El perfil no puede almacenar secretos o credenciales.");
      }

      if (typeof patch.displayName === "string" && patch.displayName.trim()) {
        current.profile.displayName = patch.displayName.trim().slice(0, 80);
        current.identity.displayName = current.profile.displayName;
      }
      if (typeof patch.locale === "string" && patch.locale.trim()) {
        current.profile.locale = patch.locale.trim();
      }
      if (typeof patch.timezone === "string" && patch.timezone.trim()) {
        current.profile.timezone = patch.timezone.trim();
      }
      if ("technicalLevel" in patch) {
        current.profile.technicalLevel = typeof patch.technicalLevel === "string" ? patch.technicalLevel : null;
      }
      if (patch.communicationPreferences && typeof patch.communicationPreferences === "object") {
        current.profile.communicationPreferences = {
          ...current.profile.communicationPreferences,
          ...patch.communicationPreferences
        };
      }
      if (patch.accessibilityPreferences && typeof patch.accessibilityPreferences === "object") {
        current.profile.accessibilityPreferences = {
          ...current.profile.accessibilityPreferences,
          ...patch.accessibilityPreferences
        };
      }
      current.profile.updatedAt = nowIso();
      current.identity.updatedAt = nowIso();
      current.events.push({
        id: `identity-event-${Date.now()}-profile-update`,
        type: "profile.updated",
        version: 1,
        timestamp: nowIso(),
        actor: createHumanActor(current.identity, current.profile),
        payload: {
          profileId: current.profile.id
        }
      });
    });

    return state.profile;
  }

  async function getCurrentDevice() {
    const state = await store.load();
    return state.device;
  }

  async function touchCurrentDevice(context = {}) {
    const state = await store.update(async (current) => {
      if (!current.device) {
        throw new Error("No existe un dispositivo local activo.");
      }

      current.device.lastSeenAt = nowIso();
      current.device.platform = context.platform ?? current.device.platform;
      current.device.architecture = context.architecture ?? current.device.architecture;
      current.device.appVersion = context.appVersion ?? current.device.appVersion;
      current.device.updatedAt = nowIso?.() ?? nowIso();
      current.events.push({
        id: `identity-event-${Date.now()}-device-seen`,
        type: "device.seen",
        version: 1,
        timestamp: nowIso(),
        actor: createSystemActor(),
        payload: {
          deviceId: current.device.id
        }
      });
    });

    return state.device;
  }

  async function prepareAccountLink(input = {}) {
    const state = await store.update(async (current) => {
      if (!current.identity) {
        throw new Error("No existe una identidad local para preparar el vínculo.");
      }
      if (current.identity.linkedAccountId) {
        throw new Error("La identidad local ya está vinculada a una cuenta.");
      }
      if (current.preparedLink) {
        throw new Error("Ya existe una solicitud local de vínculo preparada.");
      }
      current.preparedLink = createIdentityLink(current.identity, {
        metadata: {
          requestedProvider: typeof input.provider === "string" ? input.provider : null
        }
      });
      current.events.push({
        id: `identity-event-${Date.now()}-link`,
        type: "identity.linkPrepared",
        version: 1,
        timestamp: nowIso(),
        actor: createHumanActor(current.identity, current.profile),
        payload: {
          identityId: current.identity.id,
          preparedLinkId: current.preparedLink.id
        }
      });
    });

    return state.preparedLink;
  }

  async function dispose() {
    return;
  }

  return {
    initialize,
    getSnapshot,
    getOrCreateLocalIdentity,
    getCurrentIdentity,
    getCurrentActor,
    getUserProfile,
    updateUserProfile,
    getCurrentDevice,
    touchCurrentDevice,
    prepareAccountLink,
    getSystemActor: createSystemActor,
    getCodexAgentActor: createCodexAgentActor,
    normalizeLegacyActor,
    dispose
  };
}
