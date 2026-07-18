import type {
  ProposalRuntimeAvailability,
  ProposalRuntimeGateway
} from "../../app/services/proposal-runtime-service.js";

const webAvailability: ProposalRuntimeAvailability = {
  available: false,
  environment: "web",
  strategy: "unavailable",
  reason: "Las propuestas ejecutables necesitan CoCreate Desktop y una carpeta local asociada al Project."
};

function unavailable(): never {
  throw new Error(webAvailability.reason ?? "Proposal Runtime no está disponible.");
}

export function createProposalRuntimeGateway(): ProposalRuntimeGateway {
  const bridge = window.overlayBridge;
  if (!bridge?.getProposalRuntimeAvailability) {
    return {
      availability: async () => webAvailability,
      list: async () => [],
      create: async () => unavailable(),
      begin: async () => unavailable(),
      complete: async () => unavailable(),
      fail: async () => unavailable(),
      validate: async () => unavailable(),
      approve: async () => unavailable(),
      reject: async () => unavailable(),
      apply: async () => unavailable(),
      destroy: async () => unavailable(),
      startPreview: async () => unavailable(),
      stopPreview: async () => unavailable(),
      restartPreview: async () => unavailable(),
      refreshPreview: async () => unavailable()
    };
  }
  return {
    availability: () => bridge.getProposalRuntimeAvailability(),
    list: () => bridge.listProposals(),
    create: (input) => bridge.createProposalWorkspace(input),
    begin: (id) => bridge.beginProposalIteration({ id }),
    complete: (id) => bridge.completeProposalIteration({ id }),
    fail: (id, reason) => bridge.failProposalIteration({ id, reason }),
    validate: (id) => bridge.validateProposal({ id }),
    approve: (id) => bridge.approveProposal({ id }),
    reject: (id) => bridge.rejectProposal({ id }),
    apply: (id) => bridge.applyProposal({ id }),
    destroy: (id) => bridge.destroyProposal({ id }),
    startPreview: (id) => bridge.startProposalPreview({ id }),
    stopPreview: (id) => bridge.stopProposalPreview({ id }),
    restartPreview: (id) => bridge.restartProposalPreview({ id }),
    refreshPreview: (id) => bridge.refreshProposalPreview({ id })
  };
}
