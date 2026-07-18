import {
  createTrustedWebError,
  isValidCitation,
  stripTrackingParameters
} from "./trusted-web-contracts.js";

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior) instructions?/i,
  /reveal (your |the )?(api key|secret|system prompt)/i,
  /execute (this |the )?(command|tool)/i,
  /upload (local |private )?files?/i,
  /change (the )?system prompt/i,
  /developer message/i
];

const OFFICIAL_DOMAINS = [
  ".gov",
  ".gov.co",
  ".gob.",
  "medellin.gov.co",
  "presidencia.gov.co",
  "vatican.va",
  "nodejs.org",
  "react.dev",
  "github.com",
  "npmjs.com",
  "ietf.org",
  "w3.org",
  "who.int",
  "un.org"
];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function queryTokens(query) {
  return Array.from(
    new Set(
      text(query)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4)
    )
  ).slice(0, 12);
}

function sourceAuthority(domain, sourceType) {
  const normalized = text(domain).toLowerCase();
  if (sourceType === "official" || OFFICIAL_DOMAINS.some((candidate) => normalized === candidate || normalized.endsWith(candidate))) {
    return { authority: "official", reliability: 0.95, score: 100 };
  }
  if (/\.(edu|ac)\b/.test(normalized) || sourceType === "paper" || sourceType === "standard") {
    return { authority: "primary", reliability: 0.9, score: 85 };
  }
  if (["reuters.com", "apnews.com", "bbc.com", "bbc.co.uk"].some((candidate) => normalized.endsWith(candidate))) {
    return { authority: "recognized-media", reliability: 0.82, score: 70 };
  }
  return { authority: "secondary", reliability: 0.65, score: 45 };
}

function freshnessScore(publishedAt) {
  if (!publishedAt) return 0;
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  if (ageHours <= 24) return 25;
  if (ageHours <= 168) return 18;
  if (ageHours <= 744) return 10;
  if (ageHours <= 8_760) return 4;
  return -5;
}

export function detectPromptInjection(value) {
  const content = text(value);
  return INJECTION_PATTERNS.filter((pattern) => pattern.test(content)).map((pattern) => pattern.source);
}

export function sanitizeUntrustedWebText(value) {
  const lines = text(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !INJECTION_PATTERNS.some((pattern) => pattern.test(line)));
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

export function selectGroundingSources(searchResult, options = {}) {
  const maxSources = Math.min(6, Math.max(1, Number(options.maxSources) || 4));
  const seenUrls = new Set();
  return (Array.isArray(searchResult?.items) ? searchResult.items : [])
    .filter((item) => {
      const normalized = stripTrackingParameters(item?.url);
      if (!normalized || seenUrls.has(normalized)) return false;
      seenUrls.add(normalized);
      return true;
    })
    .map((item) => {
      const authority = sourceAuthority(item.domain, item.sourceType);
      return {
        item,
        authority,
        score: authority.score + freshnessScore(item.publishedAt) - Math.max(0, Number(item.rank ?? 1) - 1) * 2
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, maxSources)
    .map(({ item, authority }) => ({ ...item, authority: authority.authority, reliability: authority.reliability }));
}

function evidenceWindow(content, query) {
  const safe = sanitizeUntrustedWebText(content);
  if (!safe) return "";
  const lower = safe.toLowerCase();
  const tokens = queryTokens(query);
  const positions = tokens.map((token) => lower.indexOf(token)).filter((position) => position >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, center - 220);
  const end = Math.min(safe.length, start + 850);
  return safe.slice(start, end).trim();
}

export function createGroundingEvidence(query, source, fetchResult) {
  const excerpt = evidenceWindow(fetchResult?.text, query);
  if (!excerpt) return null;
  const authority = sourceAuthority(source.domain, source.sourceType);
  return {
    id: `evidence-${source.id}`,
    sourceId: source.id,
    claim: text(source.title) || `Evidence from ${source.domain}`,
    excerpt,
    publishedAt: source.publishedAt,
    retrievedAt: fetchResult.retrievedAt,
    reliability: authority.reliability,
    metadata: {
      untrustedContent: true,
      promptInjectionSignals: detectPromptInjection(fetchResult.text).length
    }
  };
}

function validateExternalConflicts(conflicts, sourceIds) {
  if (!Array.isArray(conflicts)) return [];
  return conflicts
    .map((conflict) => ({
      claim: text(conflict?.claim).slice(0, 240),
      sourceIds: Array.from(new Set((conflict?.sourceIds ?? []).filter((id) => sourceIds.has(id)))),
      description: text(conflict?.description).slice(0, 500)
    }))
    .filter((conflict) => conflict.claim && conflict.description && conflict.sourceIds.length >= 2);
}

function detectVersionConflict(query, evidence) {
  if (!/(version|versi[oó]n|release|latest|estable)/i.test(query)) return [];
  const byVersion = new Map();
  for (const item of evidence) {
    const versions = item.excerpt.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) ?? [];
    for (const version of versions.slice(0, 3)) {
      const normalized = version.replace(/^v/i, "");
      if (!byVersion.has(normalized)) byVersion.set(normalized, new Set());
      byVersion.get(normalized).add(item.sourceId);
    }
  }
  if (byVersion.size <= 1) return [];
  const sourceIds = Array.from(new Set(Array.from(byVersion.values()).flatMap((ids) => Array.from(ids))));
  if (sourceIds.length < 2) return [];
  return [{
    claim: "latest-version",
    sourceIds,
    description: `Las fuentes recuperadas mencionan versiones distintas: ${Array.from(byVersion.keys()).slice(0, 5).join(", ")}.`
  }];
}

export function determineGroundingConfidence(sources, evidence, conflicts = []) {
  if (!sources.length || !evidence.length) return "InsufficientEvidence";
  if (conflicts.length) return "VerifiedWithConflict";
  const supportedSourceIds = new Set(evidence.map((item) => item.sourceId));
  const supportedSources = sources.filter((source) => supportedSourceIds.has(source.id));
  const hasOfficial = supportedSources.some((source) => source.authority === "official" || source.authority === "primary");
  const independentDomains = new Set(supportedSources.map((source) => source.domain));
  return hasOfficial || independentDomains.size >= 2 ? "Verified" : "InsufficientEvidence";
}

export function buildGroundingBundle(input = {}) {
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const sourceIds = new Set(sources.map((source) => source.id));
  const conflicts = [
    ...validateExternalConflicts(input.conflicts, sourceIds),
    ...detectVersionConflict(text(input.query), evidence)
  ];
  const confidence = determineGroundingConfidence(sources, evidence, conflicts);
  return {
    query: text(input.query),
    searchedAt: text(input.searchedAt) || new Date().toISOString(),
    verifiedAt: confidence === "Verified" || confidence === "VerifiedWithConflict"
      ? text(input.verifiedAt) || new Date().toISOString()
      : undefined,
    sources,
    evidence,
    conflicts,
    confidence,
    warnings: Array.from(new Set(Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : []))
  };
}

export function buildCitations(bundle, sourceIds) {
  const requested = Array.isArray(sourceIds) && sourceIds.length ? new Set(sourceIds) : null;
  const evidenceBySource = new Map();
  for (const evidence of bundle.evidence ?? []) {
    if (!evidenceBySource.has(evidence.sourceId)) evidenceBySource.set(evidence.sourceId, []);
    evidenceBySource.get(evidence.sourceId).push(evidence.id);
  }
  return (bundle.sources ?? [])
    .filter((source) => (!requested || requested.has(source.id)) && evidenceBySource.has(source.id))
    .map((source, index) => ({
      id: `citation-${index + 1}-${source.id}`,
      sourceId: source.id,
      title: source.title,
      url: source.url,
      domain: source.domain,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      claimIds: evidenceBySource.get(source.id)
    }))
    .filter(isValidCitation);
}

export function assertGroundedConfidence(bundle) {
  if ((bundle.confidence === "Verified" || bundle.confidence === "VerifiedWithConflict") &&
      (!bundle.verifiedAt || !bundle.evidence?.length || !bundle.sources?.length)) {
    throw createTrustedWebError("WEB_INSUFFICIENT_EVIDENCE", "Verified requiere fuentes y evidencia.", {
      kind: "grounding",
      safeMessage: "La evidencia recuperada no es suficiente para verificar la respuesta."
    });
  }
  return bundle;
}
