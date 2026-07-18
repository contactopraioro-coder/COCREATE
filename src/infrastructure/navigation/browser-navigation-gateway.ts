import type { FeatureRoute } from "../../app/services/feature-parity-service.js";
import type { NavigationGateway } from "../../app/services/navigation-service.js";

export function createBrowserNavigationGateway(): NavigationGateway {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return {
    getHash: () => window.location.hash,
    push(route: FeatureRoute) {
      window.history.pushState({ cocreateRoute: route }, "", `#/${route}`);
      notify();
    },
    replace(route: FeatureRoute) {
      window.history.replaceState({ cocreateRoute: route }, "", `#/${route}`);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener("hashchange", notify);
          window.removeEventListener("popstate", notify);
        }
      };
    }
  };
}

