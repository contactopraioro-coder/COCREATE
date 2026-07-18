import { buildUpstreamStabilitySnapshot, type UpstreamStabilitySnapshot } from "../../../shared/upstream-stability.js";

export type PlanModeOption = {
  id: "plan" | "default";
  name: string;
  mode: "plan" | "default";
  model: string | null;
  reasoningEffort: string | null;
};

export type SkillCatalogItem = {
  token: string | null;
  name: string;
  description: string;
  scope: "user" | "repo" | "system" | "admin";
  enabled: boolean;
  source: "codex-skill";
  stability: "experimental";
};

export type PluginCatalogItem = {
  id: string;
  name: string;
  provider: string;
  source: string;
  version: string | null;
  installed: boolean;
  enabled: boolean;
  availability: string;
  auth: string;
  capabilities: string[];
};

export type McpServerCatalogItem = {
  id: string;
  name: string;
  type: "mcp-server";
  provider: string;
  status: "starting" | "ready" | "failed" | "cancelled";
  error: string | null;
  auth: string;
  toolCount: number;
  tools: string[];
  lastCheckedAt: string;
};

export type ExtensionCatalog = {
  skills: { data: SkillCatalogItem[]; errors: Array<{ message?: string; error?: string }>; stability: "experimental" };
  plugins: { data: PluginCatalogItem[]; errors: Array<{ message?: string; error?: string }>; stability: "experimental"; readOnly: true };
  mcp: { data: McpServerCatalogItem[]; errors?: Array<{ message?: string; error?: string }>; stability: "stable" };
  updatedAt: string;
};

export type UpstreamStabilityRuntimeSnapshot = UpstreamStabilitySnapshot & {
  runtime?: { available: boolean; authenticated: boolean; processState: string; restartCount: number };
  lastError?: string | null;
};

export type UpstreamCapabilitiesGateway = {
  getSnapshot: () => Promise<UpstreamStabilityRuntimeSnapshot>;
  listPlanModes: () => Promise<{ ok: boolean; data?: PlanModeOption[]; stability?: "experimental"; error?: string }>;
  listExtensions: () => Promise<({ ok: true } & ExtensionCatalog) | { ok: false; error: string }>;
  refresh: () => Promise<UpstreamStabilityRuntimeSnapshot>;
  subscribe: (listener: (event: Record<string, unknown>) => void) => () => void;
};

export class UpstreamStabilityService {
  constructor(private readonly gateway?: UpstreamCapabilitiesGateway) {}

  async getSnapshot(): Promise<UpstreamStabilityRuntimeSnapshot> {
    if (!this.gateway) {
      return buildUpstreamStabilitySnapshot({ environment: "web", compatible: false, upstreamVersion: null });
    }
    try {
      return await this.gateway.getSnapshot();
    } catch (cause) {
      return {
        ...buildUpstreamStabilitySnapshot({ environment: "desktop", compatible: false, upstreamVersion: null }),
        lastError: cause instanceof Error ? cause.message : "No pude consultar las capabilities upstream."
      };
    }
  }

  async listPlanModes() {
    if (!this.gateway) return { modes: [] as PlanModeOption[], reason: "Plan Mode requiere CoCreate Desktop.", stability: "experimental" as const };
    const result = await this.gateway.listPlanModes();
    return result.ok
      ? { modes: result.data ?? [], reason: null, stability: "experimental" as const }
      : { modes: [] as PlanModeOption[], reason: result.error ?? "Plan Mode no esta disponible.", stability: "experimental" as const };
  }

  async listExtensions(): Promise<ExtensionCatalog> {
    if (!this.gateway) return emptyExtensionCatalog();
    const result = await this.gateway.listExtensions();
    if (!result.ok) {
      const empty = emptyExtensionCatalog();
      empty.mcp.errors = [{ message: result.error }];
      return empty;
    }
    return result;
  }

  refresh() {
    return this.gateway?.refresh() ?? this.getSnapshot();
  }

  subscribe(listener: (event: Record<string, unknown>) => void) {
    return this.gateway?.subscribe(listener) ?? (() => undefined);
  }
}

export function emptyExtensionCatalog(): ExtensionCatalog {
  return {
    skills: { data: [], errors: [], stability: "experimental" },
    plugins: { data: [], errors: [], stability: "experimental", readOnly: true },
    mcp: { data: [], errors: [], stability: "stable" },
    updatedAt: new Date(0).toISOString()
  };
}
