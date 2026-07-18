export type TrustedWebFreshness = "any" | "today" | "week" | "month" | "year";
export type TrustedWebStatus = "completed" | "unavailable" | "failed" | "cancelled";
export type GroundingConfidence = "Verified" | "VerifiedWithConflict" | "InsufficientEvidence" | "Unavailable";

export type TrustedWebExecutionOptions = {
  signal?: AbortSignal;
  requestId?: string;
  correlationId?: string;
};

export type TrustedWebSearchInput = {
  query: string;
  locale?: string;
  timezone?: string;
  countryHint?: string;
  freshness?: TrustedWebFreshness;
  domains?: string[];
  excludedDomains?: string[];
  resultLimit?: number;
  safeSearch?: boolean;
  intent?: string;
  correlationId?: string;
};

export type TrustedWebSearchItem = {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  publishedAt?: string;
  retrievedAt: string;
  rank: number;
  sourceType?: string;
  metadata?: Record<string, unknown>;
};

export type TrustedWebSearchResult = {
  query: string;
  provider: string;
  searchedAt: string;
  status: TrustedWebStatus;
  items: TrustedWebSearchItem[];
  warnings: string[];
  requestId?: string;
  metadata?: Record<string, unknown>;
};

export type TrustedWebFetchInput = {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  acceptedContentTypes?: string[];
};

export type TrustedWebFetchResult = {
  url: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  text: string;
  retrievedAt: string;
  statusCode: number;
  truncated: boolean;
  warnings: string[];
  metadata?: Record<string, unknown>;
};

export type GroundingSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  publishedAt?: string;
  retrievedAt: string;
  sourceType?: string;
  authority?: string;
  metadata?: Record<string, unknown>;
};

export type GroundingEvidence = {
  id: string;
  sourceId: string;
  claim: string;
  excerpt: string;
  publishedAt?: string;
  retrievedAt: string;
  reliability?: number;
  metadata?: Record<string, unknown>;
};

export type GroundingConflict = {
  claim: string;
  sourceIds: string[];
  description: string;
};

export type GroundingBundle = {
  query: string;
  searchedAt: string;
  verifiedAt?: string;
  sources: GroundingSource[];
  evidence: GroundingEvidence[];
  conflicts: GroundingConflict[];
  confidence: GroundingConfidence;
  warnings: string[];
};

export type Citation = {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  domain: string;
  publishedAt?: string;
  retrievedAt: string;
  claimIds?: string[];
};

export type TrustedWebAnswer = {
  output: string;
  confidence: GroundingConfidence;
  grounded: boolean;
  verifiedAt?: string;
  sources: GroundingSource[];
  citations: Citation[];
  warnings: string[];
  provider: string;
  tool: "TrustedWebTool";
  groundingBundle: GroundingBundle;
  metadata?: Record<string, unknown>;
};

export interface WebSearchProviderPort {
  id: string;
  getHealth?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  search(input: TrustedWebSearchInput, options?: TrustedWebExecutionOptions): Promise<TrustedWebSearchResult>;
}

export interface TrustedWebTool {
  search(input: TrustedWebSearchInput, options?: TrustedWebExecutionOptions): Promise<TrustedWebSearchResult>;
  fetch(input: TrustedWebFetchInput, options?: TrustedWebExecutionOptions): Promise<TrustedWebFetchResult>;
  answer(input: TrustedWebSearchInput, options?: TrustedWebExecutionOptions): Promise<TrustedWebAnswer>;
}

export declare const TRUSTED_WEB_ERROR_CODES: readonly string[];
export declare const TRUSTED_WEB_CONFIDENCE: Set<GroundingConfidence>;
export declare function createTrustedWebRequestId(prefix?: string): string;
export declare function createTrustedWebError(code: string, message: string, options?: Record<string, any>): Error & Record<string, any>;
export declare function normalizeTrustedWebError(error: unknown, context?: Record<string, any>): Record<string, any>;
export declare function validateTrustedWebSearchInput(input?: Partial<TrustedWebSearchInput>): TrustedWebSearchInput;
export declare function validateTrustedWebFetchInput(input?: Partial<TrustedWebFetchInput>): Required<TrustedWebFetchInput>;
export declare function stripTrackingParameters(value: string): string | null;
export declare function isValidCitation(value: unknown): value is Citation;
export declare function normalizeWebConfidence(value: unknown): GroundingConfidence;
