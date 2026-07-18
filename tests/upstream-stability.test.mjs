import assert from "node:assert/strict";
import test from "node:test";
import {
  UPSTREAM_VALIDATED_VERSION,
  buildUpstreamStabilitySnapshot,
  compareCodexVersions,
  resolveParityFeatureFlags
} from "../shared/upstream-stability.js";

test("Parity feature flags fail closed by environment and pinned Codex version", () => {
  assert.equal(compareCodexVersions("codex-cli 0.134.0", "0.134.0"), 0);
  assert.equal(compareCodexVersions("0.133.9", "0.134.0"), -1);
  assert.equal(compareCodexVersions("broken", "0.134.0"), null);

  const desktop = resolveParityFeatureFlags({
    environment: "desktop",
    upstreamVersion: UPSTREAM_VALIDATED_VERSION,
    compatible: true
  });
  assert.equal(desktop.planMode, true);
  assert.equal(desktop.skills, true);
  assert.equal(desktop.scheduledTasks, false);
  assert.equal(desktop.githubIntegration, false);

  const mismatch = resolveParityFeatureFlags({
    environment: "desktop",
    upstreamVersion: "0.135.0",
    compatible: false,
    overrides: { planMode: true, experimentalUpstream: true, nativeVoice: false }
  });
  assert.equal(mismatch.planMode, false);
  assert.equal(mismatch.experimentalUpstream, true);
  assert.equal(mismatch.nativeVoice, false);

  const web = resolveParityFeatureFlags({
    environment: "web",
    upstreamVersion: UPSTREAM_VALIDATED_VERSION,
    compatible: true,
    overrides: { skills: true, nativeFilePicker: true }
  });
  assert.equal(web.skills, false);
  assert.equal(web.nativeFilePicker, true);
  const webPicker = buildUpstreamStabilitySnapshot({ environment: "web", compatible: false });
  assert.equal(webPicker.descriptors.find((entry) => entry.id === "native-file-picker")?.state, "Enabled");
});

test("Stability snapshot separates stable, experimental and unsupported capabilities", () => {
  const current = buildUpstreamStabilitySnapshot({
    environment: "desktop",
    upstreamVersion: UPSTREAM_VALIDATED_VERSION,
    compatible: true
  });
  assert.equal(current.descriptors.find((entry) => entry.id === "mcp")?.state, "Enabled");
  assert.equal(current.descriptors.find((entry) => entry.id === "plan-mode")?.state, "Experimental");
  assert.equal(current.descriptors.find((entry) => entry.id === "scheduled-tasks")?.state, "Unavailable");

  const disabled = buildUpstreamStabilitySnapshot({
    environment: "desktop",
    upstreamVersion: UPSTREAM_VALIDATED_VERSION,
    compatible: true,
    overrides: { planMode: false }
  });
  assert.match(disabled.descriptors.find((entry) => entry.id === "plan-mode")?.compatibilityReason ?? "", /feature flag planMode/);

  const old = buildUpstreamStabilitySnapshot({
    environment: "desktop",
    upstreamVersion: "0.133.0",
    compatible: false
  });
  const mcp = old.descriptors.find((entry) => entry.id === "mcp");
  assert.equal(mcp?.enabled, false);
  assert.match(mcp?.compatibilityReason ?? "", /Requiere Codex >= 0\.134\.0/);

  const broken = buildUpstreamStabilitySnapshot({
    environment: "desktop",
    upstreamVersion: "0.135.0",
    compatible: false
  });
  assert.match(broken.descriptors.find((entry) => entry.id === "mcp")?.compatibilityReason ?? "", /contrato instalado no coincide/);
});
