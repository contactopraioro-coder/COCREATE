import { Archive, Clock3, Code2, GitPullRequest, MessageSquarePlus, Puzzle } from "lucide-react";
import type { FeatureParityEntry, FeatureRoute } from "../../app/services/feature-parity-service.js";

const icons = {
  "new-task": MessageSquarePlus,
  scheduled: Clock3,
  extensions: Puzzle,
  sites: Archive,
  "pull-requests": GitPullRequest,
  chat: Code2
} as const;

type Props = {
  entries: FeatureParityEntry[];
  activeRoute: FeatureRoute;
  collapsed?: boolean;
  onNavigate: (route: FeatureRoute) => void;
};

export function PrimaryNavigation({ entries, activeRoute, collapsed = false, onNavigate }: Props) {
  return (
    <nav className={collapsed ? "workspace-sidebar-mini" : "workspace-primary-nav"} aria-label="Navegación del producto">
      {entries.map((entry) => {
        const Icon = icons[entry.id];
        const active = activeRoute === entry.route;
        return (
          <button
            key={entry.id}
            className={collapsed
              ? `workspace-mini-icon${active ? " active" : ""}`
              : `workspace-nav-item${active ? " active" : ""}`}
            type="button"
            title={entry.label}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(entry.route)}
          >
            <Icon size={16} />
            {!collapsed ? <span>{entry.label}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
