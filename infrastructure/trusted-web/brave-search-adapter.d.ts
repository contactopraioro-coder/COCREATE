import type { WebSearchProviderPort } from "../../shared/trusted-web-contracts.js";

export declare function createBraveSearchAdapter(options?: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}): WebSearchProviderPort;
