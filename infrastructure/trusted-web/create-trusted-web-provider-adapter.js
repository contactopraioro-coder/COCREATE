import { createFunctionProviderAdapter } from "../../shared/provider-runtime.js";
import { createTrustedWebTool } from "../../shared/trusted-web-tool.js";
import { createBraveSearchAdapter } from "./brave-search-adapter.js";
import { createOpenAIEvidenceSynthesizer } from "./openai-evidence-synthesizer.js";
import { createSafeWebFetcher } from "./safe-web-fetch.js";

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

export function createTrustedWebProviderAdapter(options = {}) {
  const searchProvider = options.searchProvider ?? createBraveSearchAdapter({
    apiKey: options.braveApiKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.searchTimeoutMs
  });
  const fetcher = options.fetcher ?? createSafeWebFetcher({
    maxRedirects: positiveInteger(options.maxRedirects ?? process.env.TRUSTED_WEB_MAX_REDIRECTS, 3, 5)
  });
  const synthesizer = options.synthesizer ?? createOpenAIEvidenceSynthesizer({
    apiKey: options.openAIApiKey,
    model: options.openAIModel,
    fetchImpl: options.fetchImpl
  });
  const tool = createTrustedWebTool({
    searchProvider,
    fetcher,
    synthesizer,
    maxSources: positiveInteger(options.maxSources ?? process.env.TRUSTED_WEB_MAX_SOURCES, 4, 6),
    maxFetches: positiveInteger(options.maxFetches ?? process.env.TRUSTED_WEB_MAX_FETCHES, 4, 6),
    maxBytes: positiveInteger(options.maxBytes ?? process.env.TRUSTED_WEB_MAX_BYTES, 512_000, 1_500_000),
    fetchTimeoutMs: positiveInteger(options.fetchTimeoutMs ?? process.env.TRUSTED_WEB_FETCH_TIMEOUT_MS, 8_000, 20_000)
  });

  return createFunctionProviderAdapter({
    id: "web-tool",
    name: "Trusted Web Tool",
    capabilities: {
      operations: ["search"],
      domains: ["web"],
      streaming: false,
      tools: true,
      reasoning: false,
      multimodal: false,
      embeddings: false
    },
    metadata: {
      implementation: "trusted-web-v1",
      searchProvider: searchProvider.id,
      credentials: "server-only"
    },
    getHealth: () => tool.getHealth(),
    async execute(request) {
      const input = request.input ?? {};
      const answer = await tool.answer({
        query: input.query ?? input.prompt,
        locale: input.locale,
        timezone: input.timezone,
        countryHint: input.countryHint,
        freshness: input.freshness,
        domains: input.domains,
        excludedDomains: input.excludedDomains,
        resultLimit: input.resultLimit,
        safeSearch: input.safeSearch,
        intent: input.intent,
        correlationId: input.correlationId
      }, {
        signal: request.signal,
        requestId: request.requestId,
        correlationId: input.correlationId
      });
      return {
        output: answer.output,
        value: answer,
        model: synthesizer.model ?? null,
        metadata: answer.metadata
      };
    }
  });
}
