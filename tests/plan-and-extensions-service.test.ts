import assert from "node:assert/strict";
import test from "node:test";
import { PlanModeService } from "../src/app/services/plan-mode-service.js";
import { ExtensionsService, filterExtensionCatalog } from "../src/app/services/extensions-service.js";
import { emptyExtensionCatalog, type SkillCatalogItem } from "../src/app/services/upstream-stability-service.js";

test("Plan Mode applies an upstream collaboration preset to the next Turn and can exit", () => {
  const service = new PlanModeService({} as any);
  assert.equal(service.createTurnConfiguration(null, "gpt-5", "high"), null);
  assert.deepEqual(service.createTurnConfiguration({
    id: "plan",
    name: "Plan",
    mode: "plan",
    model: "gpt-5",
    reasoningEffort: "medium"
  }, "fallback", "high"), {
    mode: "plan",
    settings: { model: "gpt-5", reasoning_effort: "high", developer_instructions: null }
  });
  assert.deepEqual(service.createTurnConfiguration({
    id: "default",
    name: "Default",
    mode: "default",
    model: null,
    reasoningEffort: null
  }, "gpt-5", ""), {
    mode: "default",
    settings: { model: "gpt-5", reasoning_effort: null, developer_instructions: null }
  });
  assert.throws(() => service.createTurnConfiguration({
    id: "plan",
    name: "Plan",
    mode: "plan",
    model: null,
    reasoningEffort: null
  }, "", ""), /modelo descubierto/);
});

test("Extensions keep Skills, Plugins and MCP as distinct safe searchable domains", () => {
  const catalog = emptyExtensionCatalog();
  const skill: SkillCatalogItem = {
    token: "opaque-token",
    name: "review",
    description: "Review code",
    scope: "repo",
    enabled: true,
    source: "codex-skill",
    stability: "experimental"
  };
  catalog.skills.data = [skill];
  catalog.plugins.data = [{ id: "plugin", name: "Plugin", provider: "Codex", source: "local", version: null, installed: true, enabled: true, availability: "available", auth: "none", capabilities: ["format"] }];
  catalog.mcp.data = [{ id: "github", name: "GitHub", type: "mcp-server", provider: "Codex App Server", status: "ready", error: null, auth: "authenticated", toolCount: 1, tools: ["list_prs"], lastCheckedAt: new Date().toISOString() }];

  assert.deepEqual(filterExtensionCatalog(catalog, "review", "all").skills, [skill]);
  assert.equal(filterExtensionCatalog(catalog, "list_prs", "mcp").mcp[0].name, "GitHub");
  assert.deepEqual(filterExtensionCatalog(catalog, "plugin", "skills").plugins, []);
  const service = new ExtensionsService({} as any);
  assert.equal(service.selectableSkill(skill), true);
  assert.equal(service.selectableSkill({ ...skill, token: null }), false);
});
