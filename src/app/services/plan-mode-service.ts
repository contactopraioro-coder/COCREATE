import type { PlanModeOption, UpstreamStabilityService } from "./upstream-stability-service.js";

export class PlanModeService {
  constructor(private readonly upstream: UpstreamStabilityService) {}

  list() {
    return this.upstream.listPlanModes();
  }

  createTurnConfiguration(option: PlanModeOption | null, model: string, effort: string) {
    if (!option) return null;
    const effectiveModel = option.model || model;
    if (!effectiveModel) throw new Error("Plan Mode requiere un modelo descubierto por Codex.");
    return {
      mode: option.mode,
      settings: {
        model: effectiveModel,
        reasoning_effort: effort || option.reasoningEffort || null,
        developer_instructions: null
      }
    };
  }
}
