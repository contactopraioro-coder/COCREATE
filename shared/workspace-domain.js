export const WORKSPACE_SCHEMA_VERSION = 1;

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createWorkspaceId(seed = createId("workspace")) {
  return `ws-${seed}`;
}

export function createProjectId(seed = createId("project")) {
  return `project-${seed}`;
}

export function createTaskId(seed = createId("task")) {
  return `task-${seed}`;
}

export function createConversationId(seed = createId("conversation")) {
  return `conv-${seed}`;
}

export function createSessionId(seed = createId("session")) {
  return `session-${seed}`;
}

export function createArtifactId(seed = createId("artifact")) {
  return `artifact-${seed}`;
}

export function createActivityId(seed = createId("activity")) {
  return `activity-${seed}`;
}

export function createEventId(seed = createId("event")) {
  return `event-${seed}`;
}

export function createDomainEvent(type, payload = {}) {
  return {
    id: createEventId(),
    type,
    version: 1,
    timestamp: nowIso(),
    workspaceId: typeof payload.workspaceId === "string" ? payload.workspaceId : null,
    actor: payload.actor ?? null,
    entity: payload.entity ?? null,
    data: payload.data ?? {},
    correlationId: typeof payload.correlationId === "string" ? payload.correlationId : null,
    causationId: typeof payload.causationId === "string" ? payload.causationId : null
  };
}

export function canTransitionTaskStatus(current, next) {
  const allowed = {
    draft: ["active", "archived"],
    active: ["blocked", "waiting", "review", "done", "archived"],
    blocked: ["active", "waiting", "review", "archived"],
    waiting: ["active", "blocked", "review", "archived"],
    review: ["active", "done", "archived"],
    done: ["archived"],
    archived: ["active"]
  };

  return (allowed[current] ?? []).includes(next);
}
