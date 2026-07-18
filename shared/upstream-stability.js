export const UPSTREAM_VALIDATED_VERSION = "0.134.0";

export const UPSTREAM_CAPABILITY_DESCRIPTORS = Object.freeze([
  { id: "plan-mode", flag: "planMode", stability: "experimental", source: "app-server", minimumVersion: "0.134.0", environment: ["desktop"], featureFlag: "experimentalUpstream", authRequired: true, reason: "Codex expone collaboration mode como contrato experimental." },
  { id: "skills", flag: "skills", stability: "experimental", source: "app-server", minimumVersion: "0.134.0", environment: ["desktop"], featureFlag: "experimentalUpstream", authRequired: true, reason: "Skills list y skill input existen en el contrato experimental." },
  { id: "plugins", flag: "plugins", stability: "experimental", source: "app-server", minimumVersion: "0.134.0", environment: ["desktop"], featureFlag: "experimentalUpstream", authRequired: true, reason: "Plugin discovery es experimental y se limita a solo lectura." },
  { id: "mcp", flag: null, stability: "stable", source: "app-server", minimumVersion: "0.134.0", environment: ["desktop"], authRequired: true, reason: "MCP inventory se obtiene mediante la surface fijada de App Server." },
  { id: "scheduled-tasks", flag: "scheduledTasks", stability: "unsupported", source: "app-server", environment: [], reason: "Codex 0.134.0 no expone scheduled tasks." },
  { id: "github-integration", flag: "githubIntegration", stability: "unsupported", source: "mcp", environment: ["desktop"], authRequired: true, reason: "No existe una surface GitHub-specific fijada por CoCreate." },
  { id: "pull-requests", flag: "githubIntegration", stability: "unsupported", source: "mcp", environment: ["desktop"], authRequired: true, reason: "Pull requests dependen de una integracion GitHub autenticada futura." },
  { id: "sites", flag: null, stability: "unsupported", source: "provider", environment: [], reason: "No existe una surface estable de deployments o sites." },
  { id: "native-voice", flag: "nativeVoice", stability: "stable", source: "cocreate", environment: ["desktop", "web"], reason: "Media devices y transcripcion segura son una capability de producto." },
  { id: "native-file-picker", flag: "nativeFilePicker", stability: "stable", source: "cocreate", environment: ["desktop", "web"], reason: "Desktop usa dialog y tokens opacos; Web usa el picker explícito del navegador y contenido validado sin rutas locales." }
]);

export const PARITY_FEATURE_FLAG_KEYS = Object.freeze([
  "planMode",
  "scheduledTasks",
  "skills",
  "plugins",
  "githubIntegration",
  "experimentalUpstream",
  "nativeVoice",
  "nativeFilePicker"
]);

function parseVersion(value) {
  const match = String(value ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareCodexVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function booleanOverride(value) {
  if (value === true || value === "1" || value === "true") return true;
  if (value === false || value === "0" || value === "false") return false;
  return null;
}

export function resolveParityFeatureFlags(options = {}) {
  const environment = options.environment === "web" ? "web" : "desktop";
  const version = options.upstreamVersion ?? null;
  const exactContract = options.compatible === true && compareCodexVersions(version, UPSTREAM_VALIDATED_VERSION) === 0;
  const overrides = options.overrides ?? {};
  const resolved = {};
  const base = {
    experimentalUpstream: environment === "desktop" && exactContract,
    planMode: environment === "desktop" && exactContract,
    skills: environment === "desktop" && exactContract,
    plugins: environment === "desktop" && exactContract,
    scheduledTasks: false,
    githubIntegration: false,
    nativeVoice: true,
    nativeFilePicker: true
  };

  for (const key of PARITY_FEATURE_FLAG_KEYS) {
    const override = booleanOverride(overrides[key]);
    resolved[key] = override ?? base[key];
  }
  if (!resolved.experimentalUpstream || !exactContract || environment !== "desktop") {
    resolved.planMode = false;
    resolved.skills = false;
    resolved.plugins = false;
  }
  resolved.scheduledTasks = false;
  resolved.githubIntegration = false;
  return Object.freeze(resolved);
}

export function buildUpstreamStabilitySnapshot(options = {}) {
  const environment = options.environment === "web" ? "web" : "desktop";
  const upstreamVersion = options.upstreamVersion ?? null;
  const flags = resolveParityFeatureFlags({ ...options, environment, upstreamVersion });
  const descriptors = UPSTREAM_CAPABILITY_DESCRIPTORS.map((descriptor) => {
    const environmentSupported = descriptor.environment.includes(environment);
    const flagEnabled = descriptor.flag ? flags[descriptor.flag] === true : true;
    const minimumComparison = descriptor.minimumVersion
      ? compareCodexVersions(upstreamVersion, descriptor.minimumVersion)
      : 0;
    const minimumSatisfied = minimumComparison !== null && minimumComparison >= 0;
    const usesAppServerContract = descriptor.source === "app-server" || descriptor.source === "mcp";
    const compatible = minimumSatisfied && (
      descriptor.stability === "experimental"
        ? options.compatible === true && compareCodexVersions(upstreamVersion, UPSTREAM_VALIDATED_VERSION) === 0
        : !usesAppServerContract || options.compatible === true
    );
    const enabled = descriptor.stability !== "unsupported" && environmentSupported && flagEnabled && compatible;
    const state = descriptor.stability === "unsupported"
      ? "Unavailable"
      : enabled
        ? descriptor.stability === "experimental" ? "Experimental" : "Enabled"
        : environmentSupported ? "Disabled" : environment === "web" ? "Desktop only" : "Unavailable";
    const compatibilityReason = descriptor.stability === "unsupported"
      ? null
      : !environmentSupported
        ? `La capability solo esta disponible en ${descriptor.environment.join(" y ") || "un entorno compatible"}.`
        : !flagEnabled
          ? `La feature flag ${descriptor.flag} esta desactivada.`
          : minimumComparison === null
            ? descriptor.minimumVersion ? `No se pudo verificar Codex >= ${descriptor.minimumVersion}.` : null
            : minimumComparison < 0
              ? `Requiere Codex >= ${descriptor.minimumVersion}.`
              : usesAppServerContract && options.compatible !== true
                ? `El contrato instalado no coincide con Codex ${UPSTREAM_VALIDATED_VERSION}; la capability fue desactivada.`
                : null;
    return { ...descriptor, enabled, state, upstreamVersion, compatibilityReason, lastError: null };
  });
  return {
    environment,
    upstreamVersion,
    validatedVersion: UPSTREAM_VALIDATED_VERSION,
    compatible: options.compatible === true,
    flags,
    descriptors,
    updatedAt: new Date().toISOString()
  };
}
