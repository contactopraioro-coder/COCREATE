export type ImplementationStatus =
  | "queued"
  | "preparing"
  | "analyzing"
  | "conflict"
  | "applying"
  | "validating"
  | "refreshing"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled"
  | "rolled_back";

export type ImplementationValidationStatus = "idle" | "running" | "passed" | "failed" | "skipped" | "unavailable" | "cancelled";
export type ImplementationConflictResolution = "current" | "proposal" | "cancel";

export type ImplementationChange = {
  id: string;
  path: string;
  newPath: string | null;
  kind: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  size: number;
  risk: "normal" | "high" | "binary";
  applied: boolean;
  skipped: boolean;
};

export type ImplementationConflict = {
  id: string;
  changeId: string | null;
  path: string;
  newPath: string | null;
  severity: "auto_resolvable" | "requires_review" | "blocking";
  kind: string;
  currentState: string;
  proposalState: string;
  risk: string;
  recommendation: string;
  resolution: "current" | "proposal" | null;
};

export type ImplementationValidationCheck = {
  id: string;
  label: string;
  command: string | null;
  durationMs: number;
  status: Exclude<ImplementationValidationStatus, "idle" | "running">;
  summary: string;
  error: string | null;
  evidence: string;
  recommendation: string | null;
};

export type ImplementationOperation = {
  version: 1;
  id: string;
  conversationId: string;
  projectId: string;
  proposalId: string;
  approvedRevisionId: string;
  approvedRevision: {
    instruction: string;
    selectionLabel: string | null;
    source: "text" | "voice";
    approvedAt: string;
  };
  status: ImplementationStatus;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  durationMs: number;
  changedFiles: string[];
  diffSummary: {
    additions: number;
    deletions: number;
    preview: string;
    truncated: boolean;
    files: Array<{
      path: string;
      kind: ImplementationChange["kind"];
      additions: number;
      deletions: number;
      preview: string;
    }>;
  };
  changeSet: ImplementationChange[];
  conflicts: ImplementationConflict[];
  validationSummary: {
    status: ImplementationValidationStatus;
    checks: ImplementationValidationCheck[];
  };
  failure: {
    code: string;
    message: string;
    phase: string;
    rollbackStatus: string;
    retriable: boolean;
  } | null;
  events: Array<{
    id: string;
    type: string;
    label: string;
    detail: string | null;
    timestamp: string;
    path?: string;
    result?: string;
    check?: string;
  }>;
  progress: {
    phase: string;
    label: string;
    completed: number;
    total: number;
  };
  checkpoint: { available: boolean; verified: boolean; createdAt: string | null };
  rollback: { available: boolean; status: string; verified: boolean; message: string | null };
  refresh: { status: string; target: string | null; message: string | null };
  repository: { detected: boolean; statusAvailable: boolean; dirty: boolean; staged: number; untracked: number; operation: string | null };
  recoveryRequired: boolean;
  cancelRequested: boolean;
  restored: boolean;
};

export type ImplementationRuntimeAvailability = {
  available: boolean;
  environment: "desktop" | "web";
  reason: string | null;
};

export type ImplementationRuntimeGateway = {
  availability(): Promise<ImplementationRuntimeAvailability>;
  list(conversationId?: string | null): Promise<ImplementationOperation[]>;
  create(input: { conversationId: string; projectId: string; proposalId: string }): Promise<ImplementationOperation>;
  start(id: string): Promise<ImplementationOperation>;
  resolveConflict(id: string, conflictId: string, resolution: ImplementationConflictResolution): Promise<ImplementationOperation>;
  cancel(id: string): Promise<ImplementationOperation>;
  rollback(id: string): Promise<ImplementationOperation>;
  recover(id: string): Promise<ImplementationOperation>;
  subscribe(listener: (operation: ImplementationOperation) => void): () => void;
};

export type ImplementationRuntimeSnapshot = {
  availability: ImplementationRuntimeAvailability;
  operations: ImplementationOperation[];
  busyAction: string | null;
  error: string | null;
};

const webAvailability: ImplementationRuntimeAvailability = {
  available: false,
  environment: "web",
  reason: "Abre este Project en CoCreate Desktop para implementar la Proposal sobre archivos locales."
};

export class ImplementationRuntimeService {
  private state: ImplementationRuntimeSnapshot = {
    availability: webAvailability,
    operations: [],
    busyAction: null,
    error: null
  };
  private readonly listeners = new Set<(snapshot: ImplementationRuntimeSnapshot) => void>();
  private unsubscribeGateway: (() => void) | null = null;

  constructor(private readonly gateway: ImplementationRuntimeGateway) {}

  private publish() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private replace(operation: ImplementationOperation) {
    const index = this.state.operations.findIndex((entry) => entry.id === operation.id);
    if (index >= 0) this.state.operations[index] = operation;
    else this.state.operations.push(operation);
    this.state.operations.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    this.publish();
  }

  private async run(action: string, operation: () => Promise<ImplementationOperation>) {
    this.state.busyAction = action;
    this.state.error = null;
    this.publish();
    try {
      const result = await operation();
      this.replace(result);
      return result;
    } catch (cause) {
      this.state.error = cause instanceof Error ? cause.message : "Implementation Runtime no pudo completar la operación.";
      this.publish();
      throw cause;
    } finally {
      this.state.busyAction = null;
      this.publish();
    }
  }

  async initialize() {
    this.unsubscribeGateway?.();
    const availability = await this.gateway.availability();
    this.state = {
      availability,
      operations: availability.available ? await this.gateway.list() : [],
      busyAction: null,
      error: null
    };
    this.unsubscribeGateway = availability.available ? this.gateway.subscribe((operation) => this.replace(operation)) : null;
    this.publish();
    return this.getSnapshot();
  }

  async createAndStart(input: { conversationId: string; projectId: string; proposalId: string }) {
    if (!this.state.availability.available) throw new Error(this.state.availability.reason ?? "Implementation Runtime no está disponible.");
    const created = await this.run("create", () => this.gateway.create(input));
    return this.run("start", () => this.gateway.start(created.id));
  }

  continue(id: string) {
    return this.run("start", () => this.gateway.start(id));
  }

  async resolveConflict(id: string, conflictId: string, resolution: ImplementationConflictResolution) {
    const resolved = await this.run("conflict", () => this.gateway.resolveConflict(id, conflictId, resolution));
    if (resolution !== "cancel" && resolved.conflicts.every((conflict) => conflict.resolution)) {
      return this.continue(id);
    }
    return resolved;
  }

  cancel(id: string) {
    return this.run("cancel", () => this.gateway.cancel(id));
  }

  rollback(id: string) {
    return this.run("rollback", () => this.gateway.rollback(id));
  }

  recover(id: string) {
    return this.run("recover", () => this.gateway.recover(id));
  }

  operationsForConversation(conversationId: string | null) {
    if (!conversationId) return [];
    return this.state.operations.filter((operation) => operation.conversationId === conversationId);
  }

  subscribe(listener: (snapshot: ImplementationRuntimeSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.unsubscribeGateway?.();
    this.unsubscribeGateway = null;
    this.listeners.clear();
  }

  getSnapshot(): ImplementationRuntimeSnapshot {
    return structuredClone(this.state);
  }
}
