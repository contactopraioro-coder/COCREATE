import assert from "node:assert/strict";
import test from "node:test";
import {
  ImplementationRuntimeService,
  type ImplementationOperation,
  type ImplementationRuntimeGateway
} from "../src/app/services/implementation-runtime-service.js";

function operation(overrides: Partial<ImplementationOperation> = {}): ImplementationOperation {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: "implementation-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    proposalId: "proposal-1",
    approvedRevisionId: "revision-1",
    approvedRevision: { instruction: "Ajusta el hero", selectionLabel: "Hero", source: "text", approvedAt: now },
    status: "queued",
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
    durationMs: 0,
    changedFiles: ["src/app.tsx"],
    diffSummary: { additions: 3, deletions: 1, preview: "@@ preview", truncated: false, files: [{ path: "src/app.tsx", kind: "modified", additions: 3, deletions: 1, preview: "@@ preview" }] },
    changeSet: [{ id: "change-1", path: "src/app.tsx", newPath: null, kind: "modified", binary: false, size: 20, risk: "normal", applied: false, skipped: false }],
    conflicts: [],
    validationSummary: { status: "idle", checks: [] },
    failure: null,
    events: [],
    progress: { phase: "queued", label: "Preparando implementación", completed: 0, total: 1 },
    checkpoint: { available: false, verified: false, createdAt: null },
    rollback: { available: false, status: "unavailable", verified: false, message: null },
    refresh: { status: "idle", target: null, message: null },
    repository: { detected: false, statusAvailable: false, dirty: false, staged: 0, untracked: 0, operation: null },
    recoveryRequired: false,
    cancelRequested: false,
    restored: false,
    ...overrides
  };
}

test("Implementation Runtime Service projects gateway events and starts the frozen operation", async () => {
  let listener: (value: ImplementationOperation) => void = () => undefined;
  const calls: string[] = [];
  const gateway: ImplementationRuntimeGateway = {
    availability: async () => ({ available: true, environment: "desktop", reason: null }),
    list: async () => [],
    create: async () => { calls.push("create"); return operation(); },
    start: async () => { calls.push("start"); return operation({ status: "completed", progress: { phase: "completed", label: "Implementación completada", completed: 1, total: 1 } }); },
    resolveConflict: async () => operation(),
    cancel: async () => operation({ status: "cancelled" }),
    rollback: async () => operation({ status: "rolled_back" }),
    recover: async () => operation({ status: "completed" }),
    subscribe: (next) => { listener = next; return () => { listener = () => undefined; }; }
  };
  const service = new ImplementationRuntimeService(gateway);
  await service.initialize();
  listener(operation({ status: "applying", progress: { phase: "applying", label: "Aplicando cambios", completed: 0, total: 1 } }));
  assert.equal(service.operationsForConversation("conversation-1")[0]?.status, "applying");
  const completed = await service.createAndStart({ conversationId: "conversation-1", projectId: "project-1", proposalId: "proposal-1" });
  assert.equal(completed.status, "completed");
  assert.deepEqual(calls, ["create", "start"]);
  service.dispose();
});

test("Implementation Runtime Service remains honest on Web", async () => {
  const gateway = {
    availability: async () => ({ available: false, environment: "web", reason: "Abre Desktop." }),
    list: async () => [],
    subscribe: () => () => undefined
  } as unknown as ImplementationRuntimeGateway;
  const service = new ImplementationRuntimeService(gateway);
  const snapshot = await service.initialize();
  assert.equal(snapshot.availability.available, false);
  await assert.rejects(
    service.createAndStart({ conversationId: "conversation-1", projectId: "project-1", proposalId: "proposal-1" }),
    /Desktop/
  );
});
