import assert from "node:assert/strict";
import test from "node:test";
import { NavigationService, readFeatureRoute, type NavigationGateway } from "../src/app/services/navigation-service.js";

function gateway(initial = "#/chat") {
  let hash = initial;
  const listeners = new Set<() => void>();
  const adapter: NavigationGateway = {
    getHash: () => hash,
    push(route) { hash = `#/${route}`; listeners.forEach((listener) => listener()); },
    replace(route) { hash = `#/${route}`; listeners.forEach((listener) => listener()); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
  return { adapter, setHash(value: string) { hash = value; listeners.forEach((listener) => listener()); } };
}

test("Navigation Service restores valid routes and rejects fictitious ones", () => {
  assert.equal(readFeatureRoute("#/pull-requests"), "pull-requests");
  assert.equal(readFeatureRoute("#/made-up"), "chat");
  assert.equal(readFeatureRoute("#/new-task"), "chat");

  const memory = gateway("#/scheduled");
  const service = new NavigationService(memory.adapter);
  assert.equal(service.getRoute(), "scheduled");
  service.dispose();
});

test("Navigation Service publishes push and back-forward gateway changes", () => {
  const memory = gateway();
  const service = new NavigationService(memory.adapter);
  const routes: string[] = [];
  const unsubscribe = service.subscribe((route) => routes.push(route));
  service.navigate("extensions");
  memory.setHash("#/chat");
  assert.deepEqual(routes, ["chat", "extensions", "chat"]);
  unsubscribe();
  service.dispose();
});

test("Navigation Service survives a Strict Mode style unsubscribe and resubscribe", () => {
  const memory = gateway("#/chat");
  const service = new NavigationService(memory.adapter);
  const first: string[] = [];
  const unsubscribe = service.subscribe((route) => first.push(route));
  unsubscribe();

  const second: string[] = [];
  const unsubscribeAgain = service.subscribe((route) => second.push(route));
  memory.setHash("#/scheduled");

  assert.deepEqual(first, ["chat"]);
  assert.deepEqual(second, ["chat", "scheduled"]);
  unsubscribeAgain();
  service.dispose();
});
