import { analyzeAssistantIntent } from "../../../shared/trusted-assistant-runtime.js";

export class IntentService {
  analyze(input: { prompt: string; history?: unknown[] }) {
    return analyzeAssistantIntent(input);
  }
}
