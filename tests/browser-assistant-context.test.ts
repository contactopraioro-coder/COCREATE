import assert from "node:assert/strict";
import test from "node:test";
import { BrowserIdentityGateway } from "../src/infrastructure/identity/browser-identity-gateway.js";
import { BrowserWorkspaceGateway } from "../src/infrastructure/workspace/browser-workspace-gateway.js";

const values = new Map<string, string>();
const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

test.before(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) {
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          values.set(key, value);
        }
      }
    }
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      language: "es-CO",
      platform: "test-browser",
      userAgent: "CoCreate test browser"
    }
  });
});

test.after(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

test.beforeEach(() => {
  values.clear();
});

test("BrowserIdentityGateway creates and restores a stable local identity", async () => {
  const gateway = new BrowserIdentityGateway();
  const first = await gateway.getBootstrap();
  const second = await gateway.getBootstrap();

  assert.equal(gateway.isAvailable(), true);
  assert.equal(first.identity?.id, second.identity?.id);
  assert.equal(first.profile?.displayName, "Local User");
  assert.equal(first.profile?.locale, "es-CO");
});

test("BrowserWorkspaceGateway provides a verified personal workspace and active conversation", async () => {
  const gateway = new BrowserWorkspaceGateway();
  const initial = await gateway.getBootstrap();
  assert.equal(initial.workspace?.name, "Workspace personal");
  assert.equal(initial.project?.name, "Proyecto Web");
  assert.equal(initial.project?.rootPath, null);

  await gateway.appendMessage("web-chat-1", {
    role: "user",
    body: "hola"
  });
  const updated = await gateway.getBootstrap();
  assert.equal(updated.conversation?.id, "web-chat-1");
  assert.equal(updated.conversations[0]?.messages[0]?.body, "hola");
});

test("BrowserWorkspaceGateway records compact web activity without page content", async () => {
  const gateway = new BrowserWorkspaceGateway();
  const activity = await gateway.recordWebExecution({
    type: "web.execution.completed",
    requestId: "web-browser-1",
    timestamp: "2026-07-16T15:00:01.000Z",
    startedAt: "2026-07-16T15:00:00.000Z",
    provider: "brave-search",
    sourcesCount: 2,
    confidence: "Verified",
    verifiedAt: "2026-07-16T15:00:00.900Z"
  });
  const state = await gateway.getBootstrap();
  assert.match(String(activity?.summary), /2 fuentes públicas/i);
  assert.equal(state.activities.length, 1);
  assert.equal("page" in (state.activities[0]?.metadata as Record<string, unknown>), false);
});
