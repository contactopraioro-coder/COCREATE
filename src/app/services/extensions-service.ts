import type { ExtensionCatalog, SkillCatalogItem, UpstreamStabilityService } from "./upstream-stability-service.js";

export class ExtensionsService {
  constructor(private readonly upstream: UpstreamStabilityService) {}

  list() {
    return this.upstream.listExtensions();
  }

  filter(catalog: ExtensionCatalog, query: string, category: "all" | "skills" | "plugins" | "mcp" = "all") {
    return filterExtensionCatalog(catalog, query, category);
  }

  selectableSkill(skill: SkillCatalogItem) {
    return skill.enabled && typeof skill.token === "string" && Boolean(skill.token);
  }
}

export function filterExtensionCatalog(catalog: ExtensionCatalog, query: string, category: "all" | "skills" | "plugins" | "mcp" = "all") {
  const normalized = query.trim().toLowerCase();
  const matches = (values: unknown[]) => !normalized || values.some((value) => String(value ?? "").toLowerCase().includes(normalized));
  return {
    skills: category === "all" || category === "skills"
      ? catalog.skills.data.filter((item) => matches([item.name, item.description, item.scope]))
      : [],
    plugins: category === "all" || category === "plugins"
      ? catalog.plugins.data.filter((item) => matches([item.name, item.provider, item.source, ...item.capabilities]))
      : [],
    mcp: category === "all" || category === "mcp"
      ? catalog.mcp.data.filter((item) => matches([item.name, item.status, item.auth, ...item.tools]))
      : []
  };
}
