import type { TrustedWebFetchInput, TrustedWebFetchResult } from "../../shared/trusted-web-contracts.js";

export declare function isPublicIpAddress(address: string): boolean;
export declare function validatePublicWebUrl(value: string): URL;
export declare function createPinnedLookup(address: { address: string; family: number }): (
  hostname: string,
  options: { all?: boolean },
  callback: (error: Error | null, address: any, family?: number) => void
) => void;
export declare function createSafeWebFetcher(options?: {
  lookupImpl?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
  requestImpl?: (url: URL, address: { address: string; family: number }, options: Record<string, any>) => Promise<any>;
  maxRedirects?: number;
  maxTextChars?: number;
  userAgent?: string;
}): {
  fetch(input: TrustedWebFetchInput, execution?: { signal?: AbortSignal; requestId?: string }): Promise<TrustedWebFetchResult>;
};
