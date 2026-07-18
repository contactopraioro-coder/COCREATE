import type {
  TrustedWebAnswer,
  TrustedWebExecutionOptions,
  TrustedWebFetchInput,
  TrustedWebFetchResult,
  TrustedWebSearchInput,
  TrustedWebSearchResult,
  TrustedWebTool,
  WebSearchProviderPort
} from "./trusted-web-contracts.js";

export declare function createTrustedWebTool(options: {
  searchProvider: WebSearchProviderPort;
  fetcher: { fetch(input: TrustedWebFetchInput, options?: TrustedWebExecutionOptions): Promise<TrustedWebFetchResult> };
  synthesizer?: {
    synthesize(input: Record<string, any>, options?: TrustedWebExecutionOptions): Promise<any>;
  };
  maxSources?: number;
  maxFetches?: number;
  maxBytes?: number;
  fetchTimeoutMs?: number;
}): TrustedWebTool & {
  getHealth(): Promise<Record<string, any>>;
  limits: Record<string, number>;
};

export type { TrustedWebAnswer, TrustedWebSearchInput, TrustedWebSearchResult };
