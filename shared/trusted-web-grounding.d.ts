import type {
  Citation,
  GroundingBundle,
  GroundingConflict,
  GroundingEvidence,
  GroundingSource,
  TrustedWebFetchResult,
  TrustedWebSearchItem,
  TrustedWebSearchResult
} from "./trusted-web-contracts.js";

export declare function detectPromptInjection(value: string): string[];
export declare function sanitizeUntrustedWebText(value: string): string;
export declare function selectGroundingSources(
  searchResult: TrustedWebSearchResult,
  options?: { maxSources?: number }
): Array<TrustedWebSearchItem & { authority: string; reliability: number }>;
export declare function createGroundingEvidence(
  query: string,
  source: GroundingSource,
  fetchResult: TrustedWebFetchResult
): GroundingEvidence | null;
export declare function determineGroundingConfidence(
  sources: GroundingSource[],
  evidence: GroundingEvidence[],
  conflicts?: GroundingConflict[]
): GroundingBundle["confidence"];
export declare function buildGroundingBundle(input?: Partial<GroundingBundle>): GroundingBundle;
export declare function buildCitations(bundle: GroundingBundle, sourceIds?: string[]): Citation[];
export declare function assertGroundedConfidence(bundle: GroundingBundle): GroundingBundle;
