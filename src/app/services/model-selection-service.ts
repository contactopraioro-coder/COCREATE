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

const efforts6 = ["low", "medium", "high", "xhigh", "max", "ultra"];
const efforts5 = ["low", "medium", "high", "xhigh", "max"];
const efforts4 = ["low", "medium", "high", "xhigh"];

// The full Codex model family. The app-server `model/list` only surfaces the
// account's headline model (gpt-5.6-sol) unless hidden models are requested, so
// we keep the known catalog here and always expose it — merging in whatever the
// runtime discovers — so every model Codex accepts via `--model` is selectable.
const FALLBACK_MODELS: CodexModelOption[] = [
  { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "Modelo agentic de codificación de última generación.", isDefault: true, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts6, defaultReasoningEffort: "low" },
  { id: "gpt-5.6-terra", model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", description: "Modelo agentic balanceado para el trabajo diario.", isDefault: false, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts6, defaultReasoningEffort: "medium" },
  { id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", description: "Modelo agentic rápido y económico.", isDefault: false, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts5, defaultReasoningEffort: "medium" },
  { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "Modelo frontera para código complejo e investigación.", isDefault: false, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts4, defaultReasoningEffort: "medium" },
  { id: "gpt-5.4", model: "gpt-5.4", displayName: "GPT-5.4", description: "Modelo sólido para código cotidiano.", isDefault: false, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts4, defaultReasoningEffort: "medium" },
  { id: "gpt-5.4-mini", model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", description: "Modelo pequeño, rápido y económico para tareas simples.", isDefault: false, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts4, defaultReasoningEffort: "medium" },
  { id: "gpt-5.2", model: "gpt-5.2", displayName: "GPT-5.2", description: "Optimizado para trabajo profesional y agentes de larga duración.", isDefault: false, inputModalities: ["text", "image"], supportedReasoningEfforts: efforts4, defaultReasoningEffort: "medium" }
];

export class ModelSelectionService {
  constructor(private readonly listFromRuntime?: () => Promise<{ data: CodexModelOption[]; unavailableReason?: string }>) {}

  // Always exposes the known family; any models the runtime discovers override or
  // extend it (deduped by model id, preserving the known ordering first).
  private merge(discovered: CodexModelOption[]): CodexModelOption[] {
    const byId = new Map<string, CodexModelOption>();
    for (const model of FALLBACK_MODELS) byId.set(model.model, model);
    for (const model of discovered) byId.set(model.model, model);
    return [...byId.values()];
  }

  async list(): Promise<{ models: CodexModelOption[]; reason: string | null }> {
    if (!this.listFromRuntime) {
      return { models: FALLBACK_MODELS, reason: null };
    }
    try {
      const response = await this.listFromRuntime();
      return { models: this.merge(response.data), reason: response.unavailableReason ?? null };
    } catch (cause) {
      return { models: FALLBACK_MODELS, reason: cause instanceof Error ? cause.message : "No pude descubrir modelos de Codex." };
    }
  }

  selectDefault(models: CodexModelOption[]) {
    return models.find((model) => model.isDefault) ?? models[0] ?? null;
  }
}
