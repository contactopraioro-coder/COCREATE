import {
  Archive,
  CalendarClock,
  FolderGit2,
  GitPullRequest,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { FeatureParityEntry, FeatureRoute } from "../../app/services/feature-parity-service.js";
import type { WorkspaceExperienceState } from "../../app/services/workspace-experience-service.js";
import { filterExtensionCatalog } from "../../app/services/extensions-service.js";
import type { ExtensionCatalog, SkillCatalogItem } from "../../app/services/upstream-stability-service.js";

type Props = {
  route: Exclude<FeatureRoute, "chat">;
  entry: FeatureParityEntry;
  workspace: WorkspaceExperienceState;
  busy: boolean;
  error: string | null;
  onCreateProject: (name: string) => Promise<unknown>;
  onSelectProject: (id: string) => Promise<unknown>;
  onCreateTask: (projectId: string, title: string) => Promise<unknown>;
  onOpenChat: () => void;
  extensions: ExtensionCatalog;
  extensionsLoading: boolean;
  selectedSkillNames: string[];
  onToggleSkill: (skill: SkillCatalogItem) => void;
  onRefreshExtensions: () => void;
};

const routeIcons = {
  "new-task": FolderGit2,
  scheduled: CalendarClock,
  extensions: Puzzle,
  sites: Archive,
  "pull-requests": GitPullRequest
} as const;

const routeCopy = {
  scheduled: {
    eyebrow: "Organiza tu trabajo",
    description: "Prepara tareas que CoCreate podrá ejecutar cuando tú decidas.",
    emptyTitle: "Próximamente",
    emptyMessage: "Las tareas programadas estarán disponibles en una próxima versión."
  },
  extensions: {
    eyebrow: "Personaliza CoCreate",
    description: "Descubre las herramientas y skills disponibles para tu trabajo.",
    emptyTitle: "Sin complementos",
    emptyMessage: "Cuando conectes herramientas, aparecerán aquí."
  },
  sites: {
    eyebrow: "Publica tu trabajo",
    description: "Reúne previews y despliegues asociados a tus proyectos.",
    emptyTitle: "Próximamente",
    emptyMessage: "Los despliegues se integrarán en una próxima versión."
  },
  "pull-requests": {
    eyebrow: "Revisa y comparte",
    description: "Sigue el estado de los cambios de tus repositorios.",
    emptyTitle: "Conecta GitHub",
    emptyMessage: "Conecta tu cuenta de GitHub para comenzar."
  }
} as const;

export function FeatureRouteOutlet(props: Props) {
  const [extensionSearch, setExtensionSearch] = useState("");
  const [extensionCategory, setExtensionCategory] = useState<"all" | "skills" | "plugins" | "mcp">("all");
  const deferredSearch = useDeferredValue(extensionSearch);
  const filtered = filterExtensionCatalog(props.extensions, deferredSearch, extensionCategory);
  if (props.route === "new-task") return null;

  const Icon = routeIcons[props.route];
  const copy = routeCopy[props.route];
  return (
    <section className="feature-route capability-route" aria-labelledby={`${props.route}-title`}>
      <div className="feature-route-heading">
        <span className="feature-route-icon"><Icon size={20} /></span>
        <div><p>{copy.eyebrow}</p><h1 id={`${props.route}-title`}>{props.entry.label}</h1><span>{copy.description}</span></div>
      </div>

      {props.route === "extensions" ? (
        <div className="extensions-catalog">
          <div className="extensions-toolbar">
            <label><Search size={14} /><span className="sr-only">Buscar complementos</span><input value={extensionSearch} onChange={(event) => setExtensionSearch(event.target.value)} placeholder="Buscar skills, MCP o plugins" /></label>
            <div className="extensions-filters" aria-label="Filtrar complementos">
              {(["all", "skills", "mcp", "plugins"] as const).map((category) => <button key={category} type="button" className={extensionCategory === category ? "active" : ""} onClick={() => setExtensionCategory(category)}>{category === "all" ? "Todos" : category === "mcp" ? "MCP" : category[0].toUpperCase() + category.slice(1)}</button>)}
            </div>
            {props.workspace.environment === "desktop" ? <button type="button" className="extensions-refresh" disabled={props.extensionsLoading} onClick={props.onRefreshExtensions}><RefreshCw className={props.extensionsLoading ? "spin" : ""} size={14} /> Actualizar</button> : null}
          </div>

          {props.workspace.environment === "web" ? (
            <div className="capability-empty-state"><Sparkles size={28} /><h2>Continúa en CoCreate Desktop</h2><p>Tus herramientas y skills locales aparecerán aquí cuando abras este proyecto en la aplicación de escritorio.</p></div>
          ) : (
            <>
              {(extensionCategory === "all" || extensionCategory === "skills") ? (
                <section className="extension-section" aria-labelledby="skills-catalog-title">
                  <div className="extension-section-heading"><div><h2 id="skills-catalog-title">Skills</h2><span>Elige las que quieras usar en tu próximo mensaje.</span></div></div>
                  {filtered.skills.length ? <div className="extension-card-grid">{filtered.skills.slice(0, 80).map((skill) => {
                    const selected = props.selectedSkillNames.includes(skill.name);
                    return <button key={`${skill.scope}:${skill.name}`} type="button" className={`extension-card selectable${selected ? " selected" : ""}`} disabled={!skill.enabled || !skill.token} aria-pressed={selected} onClick={() => props.onToggleSkill(skill)}><span><strong>{skill.name}</strong></span><p>{skill.description || "Una skill disponible para ampliar este mensaje."}</p><em>{selected ? "Lista para el próximo mensaje" : skill.enabled ? "Seleccionar" : "No disponible"}</em></button>;
                  })}</div> : <p className="extension-empty">No hay skills que coincidan con el filtro.</p>}
                </section>
              ) : null}

              {(extensionCategory === "all" || extensionCategory === "mcp") ? (
                <section className="extension-section" aria-labelledby="mcp-catalog-title">
                  <div className="extension-section-heading"><div><h2 id="mcp-catalog-title">Herramientas conectadas</h2><span>Servicios disponibles para ayudarte en tus proyectos.</span></div></div>
                  {filtered.mcp.length ? <div className="extension-card-grid">{filtered.mcp.map((server) => <article key={server.id} className={`extension-card status-${server.status}`}><span><strong>{server.name}</strong><small>{server.provider}</small></span><p>{server.toolCount} {server.toolCount === 1 ? "herramienta" : "herramientas"}</p>{server.error ? <em>{server.error}</em> : null}</article>)}</div> : <p className="extension-empty">No hay herramientas conectadas todavía.</p>}
                </section>
              ) : null}

              {(extensionCategory === "all" || extensionCategory === "plugins") ? (
                <section className="extension-section" aria-labelledby="plugins-catalog-title">
                  <div className="extension-section-heading"><div><h2 id="plugins-catalog-title">Plugins</h2><span>Extensiones instaladas en tu equipo.</span></div></div>
                  {filtered.plugins.length ? <div className="extension-card-grid">{filtered.plugins.map((plugin) => <article key={plugin.id} className="extension-card"><span><strong>{plugin.name}</strong><small>{plugin.provider}</small></span><p>{plugin.capabilities.slice(0, 4).join(" · ") || "Sin descripción disponible"}</p></article>)}</div> : <p className="extension-empty">No hay plugins instalados todavía.</p>}
                </section>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="capability-empty-state">
          <Icon size={30} />
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyMessage}</p>
        </div>
      )}
    </section>
  );
}
