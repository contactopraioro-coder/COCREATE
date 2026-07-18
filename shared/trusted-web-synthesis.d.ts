import type { GroundingBundle } from "./trusted-web-contracts.js";

export type TrustedWebSynthesisResult = {
  answer: string;
  sourceIds: string[];
  conflicts: Array<{ claim: string; sourceIds: string[]; description: string }>;
};

export declare function buildTrustedWebSynthesisPrompt(query: string, bundle: GroundingBundle, locale?: string): string;
export declare function normalizeTrustedWebSynthesis(value: unknown, bundle: GroundingBundle): TrustedWebSynthesisResult | null;
export declare function buildDeterministicEvidenceSummary(bundle: GroundingBundle): TrustedWebSynthesisResult | null;
