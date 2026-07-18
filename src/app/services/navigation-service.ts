import type { FeatureRoute } from "./feature-parity-service.js";

const validRoutes = new Set<FeatureRoute>([
  "new-task",
  "scheduled",
  "extensions",
  "sites",
  "pull-requests",
  "chat"
]);

export function readFeatureRoute(hash: string): FeatureRoute {
  const candidate = hash.replace(/^#\/?/, "").split(/[?&]/, 1)[0] as FeatureRoute;
  if (candidate === "new-task") return "chat";
  return validRoutes.has(candidate) ? candidate : "chat";
}

export type NavigationGateway = {
  getHash: () => string;
  push: (route: FeatureRoute) => void;
  replace: (route: FeatureRoute) => void;
  subscribe: (listener: () => void) => () => void;
};

export class NavigationService {
  private listeners = new Set<(route: FeatureRoute) => void>();
  private route: FeatureRoute;
  private unsubscribeGateway: (() => void) | null = null;

  constructor(private readonly gateway: NavigationGateway) {
    this.route = readFeatureRoute(gateway.getHash());
    this.unsubscribeGateway = gateway.subscribe(() => this.publish(readFeatureRoute(gateway.getHash())));
  }

  getRoute() {
    return this.route;
  }

  navigate(route: FeatureRoute, options: { replace?: boolean } = {}) {
    if (!validRoutes.has(route)) return;
    const target = route === "new-task" ? "chat" : route;
    if (readFeatureRoute(this.gateway.getHash()) === target) {
      this.publish(target);
      return;
    }
    if (options.replace) this.gateway.replace(target);
    else this.gateway.push(target);
  }

  subscribe(listener: (route: FeatureRoute) => void) {
    this.listeners.add(listener);
    listener(this.route);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.unsubscribeGateway?.();
    this.unsubscribeGateway = null;
    this.listeners.clear();
  }

  private publish(route: FeatureRoute) {
    this.route = route;
    for (const listener of this.listeners) listener(route);
  }
}
