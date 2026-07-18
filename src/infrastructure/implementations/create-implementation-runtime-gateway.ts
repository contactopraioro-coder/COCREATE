import type {
  ImplementationRuntimeAvailability,
  ImplementationRuntimeGateway
} from "../../app/services/implementation-runtime-service.js";

const webAvailability: ImplementationRuntimeAvailability = {
  available: false,
  environment: "web",
  reason: "Abre este Project en CoCreate Desktop para implementar la Proposal sobre archivos locales."
};

function unavailable(): never {
  throw new Error(webAvailability.reason ?? "Implementation Runtime no está disponible.");
}

export function createImplementationRuntimeGateway(): ImplementationRuntimeGateway {
  const bridge = window.overlayBridge;
  if (!bridge?.getImplementationRuntimeAvailability) {
    return {
      availability: async () => webAvailability,
      list: async () => [],
      create: async () => unavailable(),
      start: async () => unavailable(),
      resolveConflict: async () => unavailable(),
      cancel: async () => unavailable(),
      rollback: async () => unavailable(),
      recover: async () => unavailable(),
      subscribe: () => () => undefined
    };
  }
  return {
    availability: () => bridge.getImplementationRuntimeAvailability(),
    list: (conversationId) => bridge.listImplementationOperations({ conversationId: conversationId ?? null }),
    create: (input) => bridge.createImplementationOperation(input),
    start: (id) => bridge.startImplementationOperation({ id }),
    resolveConflict: (id, conflictId, resolution) => bridge.resolveImplementationConflict({ id, conflictId, resolution }),
    cancel: (id) => bridge.cancelImplementationOperation({ id }),
    rollback: (id) => bridge.rollbackImplementationOperation({ id }),
    recover: (id) => bridge.recoverImplementationOperation({ id }),
    subscribe: (listener) => bridge.onImplementationEvent(listener)
  };
}
