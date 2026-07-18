export type CodexModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  inputModalities: string[];
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
};

export class ModelSelectionService {
  constructor(private readonly listFromRuntime?: () => Promise<{ data: CodexModelOption[]; unavailableReason?: string }>) {}

  async list(): Promise<{ models: CodexModelOption[]; reason: string | null }> {
    if (!this.listFromRuntime) {
      return { models: [], reason: "La selección de modelo upstream está disponible en CoCreate Desktop." };
    }
    try {
      const response = await this.listFromRuntime();
      return { models: response.data, reason: response.unavailableReason ?? null };
    } catch (cause) {
      return { models: [], reason: cause instanceof Error ? cause.message : "No pude descubrir modelos de Codex." };
    }
  }

  selectDefault(models: CodexModelOption[]) {
    return models.find((model) => model.isDefault) ?? models[0] ?? null;
  }
}
