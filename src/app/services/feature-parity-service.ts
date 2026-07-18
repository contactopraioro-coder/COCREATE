import type { CodexStatus } from "../../../shared/codex-contracts.js";
import type { WorkspaceExperienceState } from "./workspace-experience-service.js";
import type { ExtensionCatalog, UpstreamStabilityRuntimeSnapshot } from "./upstream-stability-service.js";

export type FeatureRoute = "new-task" | "scheduled" | "extensions" | "sites" | "pull-requests" | "chat";
export type FeatureAvailability =
  | "Available"
  | "Partially available"
  | "Desktop only"
  | "Web only"
  | "Not configured"
  | "Authentication required"
  | "Experimental"
  | "Disabled"
  | "Unsupported"
  | "Error"
  | "Unsupported by current upstream"
  | "Deferred";
export type FeatureStrategy = "Inherited" | "Wrapped" | "Extended" | "Owned by CoCreate" | "Unsupported" | "Deferred";

export type FeatureParityEntry = {
  id: FeatureRoute;
  label: string;
  category: "create" | "product" | "integration";
  upstreamCapability: string | null;
  source: "workspace" | "codex-upstream" | "provider-runtime" | "product-layer" | "external-integration";
  availability: FeatureAvailability;
  environment: "desktop" | "web" | "all";
  status: FeatureStrategy;
  route: FeatureRoute;
  reason: string;
  requiredAuth: boolean;
  metadata: Record<string, string | number | boolean | null>;
};

export type FeatureParityContext = {
  environment: "desktop" | "web";
  codexStatus: CodexStatus | null;
  workspace: WorkspaceExperienceState;
  upstream?: UpstreamStabilityRuntimeSnapshot | null;
  extensions?: ExtensionCatalog | null;
};

function appServerAvailable(context: FeatureParityContext) {
  return context.environment === "desktop" &&
    context.codexStatus?.available === true &&
    context.codexStatus.runtimeMode === "app-server";
}

function mcpCount(status: CodexStatus | null) {
  const value = status?.appServer?.mcp?.configuredServers;
  return Number.isFinite(value) ? Number(value) : 0;
}

export class FeatureParityService {
  getEntries(context: FeatureParityContext): FeatureParityEntry[] {
    const desktopCodex = appServerAvailable(context);
    const configuredMcpServers = mcpCount(context.codexStatus);
    const version = context.codexStatus?.version ?? context.codexStatus?.validatedVersion ?? "0.134.0";
    const descriptor = (id: string) => context.upstream?.descriptors.find((entry) => entry.id === id);
    const mcpDescriptor = descriptor("mcp");
    const githubMcpDetected = context.extensions?.mcp.data.some((entry) => entry.name.toLowerCase() === "github") === true;

    return [
      {
        id: "new-task",
        label: "Nueva tarea",
        category: "create",
        upstreamCapability: "threads",
        source: "workspace",
        availability: "Available",
        environment: "all",
        status: "Extended",
        route: "new-task",
        reason: "Crea una tarea vacía y abre su conversación inmediatamente, sin exigir un proyecto.",
        requiredAuth: false,
        metadata: { projectOptional: true }
      },
      {
        id: "scheduled",
        label: "Programados",
        category: "product",
        upstreamCapability: null,
        source: "codex-upstream",
        availability: descriptor("scheduled-tasks")?.state === "Disabled" ? "Disabled" : "Unsupported",
        environment: "all",
        status: "Unsupported",
        route: "scheduled",
        reason: `Codex ${version} no expone una surface de tareas programadas fijada por CoCreate.`,
        requiredAuth: false,
        metadata: { codexVersion: version, featureFlag: "scheduledTasks", stability: "unsupported" }
      },
      {
        id: "extensions",
        label: "Complementos",
        category: "integration",
        upstreamCapability: "mcp-discovery",
        source: "codex-upstream",
        availability: context.environment === "web"
          ? "Desktop only"
          : context.upstream?.lastError
            ? "Error"
            : desktopCodex && (mcpDescriptor?.enabled ?? true)
              ? "Partially available"
              : "Not configured",
        environment: "desktop",
        status: "Wrapped",
        route: "extensions",
        reason: context.environment === "web"
          ? "Los MCP y skills locales solo pueden descubrirse en CoCreate Desktop."
          : desktopCodex
            ? "MCP discovery está disponible; instalación y configuración permanecen fuera de esta versión."
            : "Inicia Codex App Server para descubrir complementos locales.",
        requiredAuth: false,
        metadata: {
          configuredMcpServers: context.extensions?.mcp.data.length ?? configuredMcpServers,
          skills: context.extensions?.skills.data.length ?? 0,
          plugins: context.extensions?.plugins.data.length ?? 0,
          experimental: descriptor("skills")?.enabled === true || descriptor("plugins")?.enabled === true
        }
      },
      {
        id: "sites",
        label: "Sitios",
        category: "product",
        upstreamCapability: null,
        source: "external-integration",
        availability: "Deferred",
        environment: "all",
        status: "Deferred",
        route: "sites",
        reason: "La versión upstream actual no ofrece una surface estable de sitios o deployments.",
        requiredAuth: false,
        metadata: {}
      },
      {
        id: "pull-requests",
        label: "Pull requests",
        category: "integration",
        upstreamCapability: "github-connector-or-mcp",
        source: "external-integration",
        availability: descriptor("github-integration")?.enabled ? "Partially available" : "Authentication required",
        environment: "all",
        status: "Deferred",
        route: "pull-requests",
        reason: githubMcpDetected
          ? "GitHub MCP fue detectado, pero CoCreate no confirma autenticación ni scopes sin una surface segura dedicada."
          : configuredMcpServers
            ? "Hay MCP configurados, pero ninguno puede asumirse como GitHub autenticado."
          : "Conecta GitHub mediante un connector, MCP o backend seguro para ver pull requests.",
        requiredAuth: true,
        metadata: { configuredMcpServers, githubMcpDetected, featureFlag: "githubIntegration" }
      },
      {
        id: "chat",
        label: "Chat",
        category: "product",
        upstreamCapability: context.environment === "desktop" ? "turns" : "provider-runtime",
        source: context.environment === "desktop" ? "codex-upstream" : "provider-runtime",
        availability: "Available",
        environment: "all",
        status: "Wrapped",
        route: "chat",
        reason: context.environment === "desktop"
          ? "Las conversaciones de Task usan Codex App Server; las consultas locales conservan Trusted Routing."
          : "Web usa Provider Runtime y herramientas locales sin simular App Server.",
        requiredAuth: false,
        metadata: { runtime: context.workspace.runtime.mode }
      }
    ];
  }

  getEntry(route: FeatureRoute, context: FeatureParityContext) {
    return this.getEntries(context).find((entry) => entry.route === route) ?? this.getEntries(context)[5];
  }
}
