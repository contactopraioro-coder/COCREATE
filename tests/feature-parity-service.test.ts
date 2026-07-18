import assert from "node:assert/strict";
import test from "node:test";
import { FeatureParityService } from "../src/app/services/feature-parity-service.js";
import { buildUpstreamStabilitySnapshot } from "../shared/upstream-stability.js";
import { emptyExtensionCatalog } from "../src/app/services/upstream-stability-service.js";

function workspace(environment: "desktop" | "web") {
  return {
    environment,
    project: { id: "project-1" },
    runtime: { mode: environment }
  } as any;
}

test("Feature Parity Registry exposes every navigation route without false availability", () => {
  const entries = new FeatureParityService().getEntries({
    environment: "desktop",
    codexStatus: {
      available: true,
      runtimeMode: "app-server",
      version: "0.134.0",
      appServer: { mcp: { configuredServers: 3 } }
    } as any,
    workspace: workspace("desktop")
  });

  assert.deepEqual(entries.map((entry) => entry.id), ["new-task", "scheduled", "extensions", "sites", "pull-requests", "chat"]);
  assert.equal(entries.find((entry) => entry.id === "extensions")?.availability, "Partially available");
  assert.equal(entries.find((entry) => entry.id === "extensions")?.metadata.configuredMcpServers, 3);
  assert.equal(entries.find((entry) => entry.id === "scheduled")?.availability, "Unsupported");
  assert.equal(entries.find((entry) => entry.id === "pull-requests")?.requiredAuth, true);
});

test("Feature Parity Registry never advertises local Codex capabilities on Web", () => {
  const entries = new FeatureParityService().getEntries({
    environment: "web",
    codexStatus: null,
    workspace: workspace("web")
  });

  assert.equal(entries.find((entry) => entry.id === "extensions")?.availability, "Desktop only");
  assert.equal(entries.find((entry) => entry.id === "chat")?.availability, "Available");
  assert.equal(entries.find((entry) => entry.id === "sites")?.availability, "Deferred");
});

test("Feature Registry derives experimental, error and auth states from centralized evidence", () => {
  const upstream = buildUpstreamStabilitySnapshot({
    environment: "desktop",
    upstreamVersion: "0.134.0",
    compatible: true
  }) as any;
  const extensions = emptyExtensionCatalog();
  extensions.mcp.data = [{
    id: "github",
    name: "GitHub",
    type: "mcp-server",
    provider: "Codex App Server",
    status: "ready",
    error: null,
    auth: "unknown",
    toolCount: 1,
    tools: ["list_prs"],
    lastCheckedAt: new Date().toISOString()
  }];
  const service = new FeatureParityService();
  const entries = service.getEntries({
    environment: "desktop",
    codexStatus: { available: true, runtimeMode: "app-server", version: "0.134.0", appServer: { mcp: { configuredServers: 1 } } } as any,
    workspace: workspace("desktop"),
    upstream,
    extensions
  });
  assert.equal(entries.find((entry) => entry.id === "extensions")?.metadata.experimental, true);
  assert.equal(entries.find((entry) => entry.id === "pull-requests")?.availability, "Authentication required");
  assert.equal(entries.find((entry) => entry.id === "pull-requests")?.metadata.githubMcpDetected, true);
  assert.equal(entries.find((entry) => entry.id === "scheduled")?.availability, "Unsupported");
  assert.equal(entries.find((entry) => entry.id === "sites")?.availability, "Deferred");
  assert.equal(JSON.stringify(entries).toLowerCase().includes("token"), false);

  const failed = service.getEntries({
    environment: "desktop",
    codexStatus: { available: true, runtimeMode: "app-server", version: "0.134.0" } as any,
    workspace: workspace("desktop"),
    upstream: { ...upstream, lastError: "contract changed" },
    extensions
  });
  assert.equal(failed.find((entry) => entry.id === "extensions")?.availability, "Error");
});
