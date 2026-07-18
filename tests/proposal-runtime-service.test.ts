import assert from "node:assert/strict";
import test from "node:test";
import {
  ProposalRuntimeService,
  type ProposalRecord,
  type ProposalRuntimeGateway
} from "../src/app/services/proposal-runtime-service.js";

function record(id: string, sequence: number, status: ProposalRecord["status"] = "draft", parentId: string | null = null): ProposalRecord {
  const now = "2026-07-17T12:00:00.000Z";
  return {
    version: 1,
    id,
    sequence,
    parentId,
    status,
    instruction: `Proposal ${sequence}`,
    source: "text",
    selectionLabel: null,
    author: "Tester",
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    workspace: { strategy: "temporary-copy-on-write", available: !["applied", "destroyed"].includes(status), dependencyCacheReused: true, restored: false },
    preview: { status: "stopped", url: null, error: null, script: null, port: null, refreshToken: 0, hotReload: false, startedAt: null, durationMs: null, output: "" },
    diff: { files: [], components: [], additions: 0, deletions: 0, preview: "", updatedAt: null },
    validation: { status: "idle", ok: false, checks: [], startedAt: null, completedAt: null, durationMs: null },
    errors: [],
    timeline: [],
    appliedAt: null,
    destroyedAt: null
  };
}

test("ProposalRuntimeService restores the active proposal and chains a new iteration from it", async () => {
  const proposals = [record("proposal-one", 1, "ready")];
  let parentId: string | null | undefined;
  const gateway: ProposalRuntimeGateway = {
    availability: async () => ({ available: true, environment: "desktop", strategy: "temporary-copy-on-write", reason: null }),
    list: async () => proposals,
    create: async (input) => {
      parentId = input.parentId;
      return record("proposal-two", 2, "draft", input.parentId ?? null);
    },
    begin: async (id) => ({ ...record(id, 2, "applying", parentId ?? null), instruction: "Iteración" }),
    complete: async (id) => record(id, 2, "ready", parentId ?? null),
    fail: async (id) => record(id, 2, "failed", parentId ?? null),
    validate: async (id) => record(id, 2, "ready", parentId ?? null),
    approve: async (id) => record(id, 2, "approved", parentId ?? null),
    reject: async (id) => record(id, 2, "rejected", parentId ?? null),
    apply: async (id) => record(id, 2, "applied", parentId ?? null),
    destroy: async (id) => record(id, 2, "destroyed", parentId ?? null),
    startPreview: async (id) => record(id, 2, "ready", parentId ?? null),
    stopPreview: async (id) => record(id, 2, "ready", parentId ?? null),
    restartPreview: async (id) => record(id, 2, "ready", parentId ?? null),
    refreshPreview: async (id) => record(id, 2, "ready", parentId ?? null)
  };
  const service = new ProposalRuntimeService(gateway);
  await service.initialize();
  assert.equal(service.getSnapshot().activeId, "proposal-one");
  const iteration = await service.createIteration({ instruction: "Hazlo más pequeño", source: "voice" });
  assert.equal(parentId, "proposal-one");
  assert.equal(iteration.status, "applying");
  assert.equal(service.getSnapshot().activeId, "proposal-two");
});

test("ProposalRuntimeService exposes an honest Web unavailable state", async () => {
  const gateway = {
    availability: async () => ({ available: false, environment: "web", strategy: "unavailable", reason: "Requiere Desktop." } as const),
    list: async () => []
  } as unknown as ProposalRuntimeGateway;
  const service = new ProposalRuntimeService(gateway);
  const snapshot = await service.initialize();
  assert.equal(snapshot.availability.available, false);
  assert.equal(snapshot.proposals.length, 0);
  assert.match(snapshot.availability.reason ?? "", /Desktop/);
});
