import {
  createTrustedWebError,
  normalizeTrustedWebError,
  validateTrustedWebFetchInput,
  validateTrustedWebSearchInput
} from "./trusted-web-contracts.js";
import {
  assertGroundedConfidence,
  buildCitations,
  buildGroundingBundle,
  createGroundingEvidence,
  detectPromptInjection,
  selectGroundingSources
} from "./trusted-web-grounding.js";
import { buildDeterministicEvidenceSummary } from "./trusted-web-synthesis.js";

function throwIfAborted(signal, requestId) {
  if (!signal?.aborted) return;
  throw createTrustedWebError("WEB_CANCELLED", "La consulta web fue cancelada.", {
    kind: "cancelled",
    requestId,
    safeMessage: "La consulta web fue cancelada.",
    retriable: true
  });
}

function sourceFrom(candidate, fetched) {
  const final = new URL(fetched.finalUrl);
  return {
    id: candidate.id,
    title: fetched.title || candidate.title,
    url: fetched.finalUrl,
    domain: final.hostname.replace(/^www\./, "").toLowerCase(),
    publishedAt: candidate.publishedAt,
    retrievedAt: fetched.retrievedAt,
    sourceType: candidate.sourceType,
    authority: candidate.authority,
    metadata: {
      searchRank: candidate.rank,
      searchProviderUrl: candidate.url,
      truncated: fetched.truncated,
      contentType: fetched.contentType
    }
  };
}

export function createTrustedWebTool(options = {}) {
  if (!options.searchProvider?.search || !options.fetcher?.fetch) {
    throw new TypeError("TrustedWebTool requiere searchProvider y fetcher.");
  }
  const limits = {
    maxSearches: 1,
    maxSources: Math.min(6, Math.max(1, Number(options.maxSources) || 4)),
    maxFetches: Math.min(6, Math.max(1, Number(options.maxFetches) || 4)),
    maxBytes: Math.min(1_500_000, Math.max(16_000, Number(options.maxBytes) || 512_000)),
    fetchTimeoutMs: Math.min(20_000, Math.max(500, Number(options.fetchTimeoutMs) || 8_000))
  };

  async function search(input, execution = {}) {
    throwIfAborted(execution.signal, execution.requestId);
    return options.searchProvider.search(validateTrustedWebSearchInput(input), execution);
  }

  async function fetch(input, execution = {}) {
    throwIfAborted(execution.signal, execution.requestId);
    return options.fetcher.fetch(validateTrustedWebFetchInput(input), execution);
  }

  async function getHealth() {
    const health = (await options.searchProvider.getHealth?.()) ?? { status: "Healthy" };
    return health.status === "Healthy"
      ? { status: "Healthy", metadata: { provider: options.searchProvider.id, limits } }
      : health;
  }

  async function answer(input, execution = {}) {
    const startedAt = Date.now();
    const normalized = validateTrustedWebSearchInput({ ...input, resultLimit: Math.min(input?.resultLimit ?? 6, 10) });
    const warnings = [];
    throwIfAborted(execution.signal, execution.requestId);

    const searchResult = await search(normalized, execution);
    if (!searchResult.items?.length) {
      throw createTrustedWebError("WEB_SEARCH_NO_RESULTS", "El proveedor no devolvio resultados.", {
        provider: options.searchProvider.id,
        kind: "search",
        requestId: execution.requestId,
        safeMessage: "No encontre fuentes publicas suficientes para verificar esta consulta.",
        retriable: true
      });
    }

    const candidates = selectGroundingSources(searchResult, { maxSources: limits.maxSources }).slice(0, limits.maxFetches);
    const outcomes = await Promise.all(
      candidates.map(async (candidate) => {
        throwIfAborted(execution.signal, execution.requestId);
        try {
          const fetched = await fetch({
            url: candidate.url,
            timeoutMs: limits.fetchTimeoutMs,
            maxBytes: limits.maxBytes
          }, execution);
          const source = sourceFrom(candidate, fetched);
          const evidence = createGroundingEvidence(normalized.query, source, fetched);
          const injectionSignals = detectPromptInjection(fetched.text);
          return { source, evidence, injectionSignals, warnings: fetched.warnings ?? [] };
        } catch (error) {
          const normalizedError = normalizeTrustedWebError(error, { requestId: execution.requestId });
          if (normalizedError.code === "WEB_CANCELLED") throw error;
          return { error: normalizedError };
        }
      })
    );

    const sources = [];
    const evidence = [];
    for (const outcome of outcomes) {
      if (outcome.error) {
        warnings.push(`source-fetch-failed:${outcome.error.code}`);
        continue;
      }
      sources.push(outcome.source);
      if (outcome.evidence) evidence.push(outcome.evidence);
      if (outcome.injectionSignals?.length) warnings.push("prompt-injection-content-ignored");
      warnings.push(...(outcome.warnings ?? []));
    }

    let bundle = buildGroundingBundle({
      query: normalized.query,
      searchedAt: searchResult.searchedAt,
      sources,
      evidence,
      warnings: [...(searchResult.warnings ?? []), ...warnings]
    });

    if (!bundle.evidence.length) {
      bundle = buildGroundingBundle({ ...bundle, warnings: [...bundle.warnings, "no-retrieved-evidence"] });
    }

    let synthesis = null;
    if (bundle.evidence.length && options.synthesizer?.synthesize) {
      try {
        synthesis = await options.synthesizer.synthesize({
          query: normalized.query,
          locale: normalized.locale,
          bundle
        }, execution);
      } catch (error) {
        const synthesisError = normalizeTrustedWebError(error, { requestId: execution.requestId });
        if (synthesisError.code === "WEB_CANCELLED") throw error;
        bundle.warnings.push(`synthesis-failed:${synthesisError.code}`);
      }
    }
    synthesis ??= buildDeterministicEvidenceSummary(bundle);

    if (synthesis?.conflicts?.length) {
      bundle = buildGroundingBundle({ ...bundle, conflicts: synthesis.conflicts, warnings: bundle.warnings });
    }
    assertGroundedConfidence(bundle);

    const citations = buildCitations(bundle, synthesis?.sourceIds);
    const hasVerifiedEvidence =
      (bundle.confidence === "Verified" || bundle.confidence === "VerifiedWithConflict") && citations.length > 0;
    const output = synthesis?.answer || "La evidencia recuperada no fue suficiente para construir una respuesta verificable.";
    const confidence = hasVerifiedEvidence ? bundle.confidence : "InsufficientEvidence";
    const verifiedAt = hasVerifiedEvidence ? bundle.verifiedAt : undefined;

    return {
      output,
      confidence,
      grounded: hasVerifiedEvidence,
      verifiedAt,
      sources: bundle.sources,
      citations,
      warnings: Array.from(new Set(bundle.warnings)),
      provider: options.searchProvider.id,
      tool: "TrustedWebTool",
      groundingBundle: { ...bundle, confidence, verifiedAt },
      metadata: {
        requestId: execution.requestId ?? searchResult.requestId ?? null,
        correlationId: execution.correlationId ?? normalized.correlationId ?? null,
        searchProvider: options.searchProvider.id,
        searchesCount: 1,
        fetchesCount: candidates.length,
        sourcesCount: bundle.sources.length,
        evidenceCount: bundle.evidence.length,
        durationMs: Date.now() - startedAt,
        limits
      }
    };
  }

  return { search, fetch, answer, getHealth, limits };
}
