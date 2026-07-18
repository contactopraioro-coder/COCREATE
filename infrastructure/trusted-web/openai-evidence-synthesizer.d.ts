import type { GroundingBundle } from "../../shared/trusted-web-contracts.js";

export declare function createOpenAIEvidenceSynthesizer(options?: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): {
  id: string;
  model: string;
  synthesize(input: { query: string; locale?: string; bundle: GroundingBundle }, execution?: { signal?: AbortSignal; requestId?: string }): Promise<{
    answer: string;
    sourceIds: string[];
    conflicts: Array<{ claim: string; sourceIds: string[]; description: string }>;
  }>;
};
