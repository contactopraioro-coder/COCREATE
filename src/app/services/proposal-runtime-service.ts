export type ProposalStatus =
  | "draft"
  | "preparing"
  | "applying"
  | "running"
  | "ready"
  | "failed"
  | "rejected"
  | "approved"
  | "applied"
  | "destroyed";

export type ProposalValidationCheck = {
  id: string;
  label: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  output: string;
};

export type ProposalTimelineItem = {
  id: string;
  status: ProposalStatus;
  label: string;
  detail: string | null;
  timestamp: string;
};

export type ProposalRecord = {
  version: 1;
  id: string;
  sequence: number;
  parentId: string | null;
  status: ProposalStatus;
  instruction: string;
  source: "text" | "voice";
  selectionLabel: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  workspace: {
    strategy: "temporary-copy-on-write";
    available: boolean;
    dependencyCacheReused: boolean;
    restored: boolean;
  };
  preview: {
    status: "stopped" | "starting" | "ready" | "failed";
    url: string | null;
    error: string | null;
    script: string | null;
    port: number | null;
    refreshToken: number;
    hotReload: boolean;
    startedAt: string | null;
    durationMs: number | null;
    output: string;
  };
  diff: {
    files: string[];
    components: string[];
    additions: number;
    deletions: number;
    preview: string;
    updatedAt: string | null;
  };
  validation: {
    status: "idle" | "running" | "passed" | "failed";
    ok: boolean;
    checks: ProposalValidationCheck[];
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  };
  errors: string[];
  timeline: ProposalTimelineItem[];
  appliedAt: string | null;
  destroyedAt: string | null;
};

export type ProposalRuntimeAvailability = {
  available: boolean;
  environment: "desktop" | "web";
  strategy: "temporary-copy-on-write" | "unavailable";
  reason: string | null;
};

export type ProposalRuntimeSnapshot = {
  availability: ProposalRuntimeAvailability;
  proposals: ProposalRecord[];
  activeId: string | null;
  busyAction: string | null;
  error: string | null;
};

type ProposalCreateInput = {
  instruction: string;
  source: "text" | "voice";
  selectionLabel?: string | null;
  author?: string | null;
  parentId?: string | null;
};

export type ProposalRuntimeGateway = {
  availability(): Promise<ProposalRuntimeAvailability>;
  list(): Promise<ProposalRecord[]>;
  create(input: ProposalCreateInput): Promise<ProposalRecord>;
  begin(id: string): Promise<ProposalRecord>;
  complete(id: string): Promise<ProposalRecord>;
  fail(id: string, reason: string): Promise<ProposalRecord>;
  validate(id: string): Promise<ProposalRecord>;
  approve(id: string): Promise<ProposalRecord>;
  reject(id: string): Promise<ProposalRecord>;
  apply(id: string): Promise<ProposalRecord>;
  destroy(id: string): Promise<ProposalRecord>;
  startPreview(id: string): Promise<ProposalRecord>;
  stopPreview(id: string): Promise<ProposalRecord>;
  restartPreview(id: string): Promise<ProposalRecord>;
  refreshPreview(id: string): Promise<ProposalRecord>;
};

const unavailableAvailability: ProposalRuntimeAvailability = {
  available: false,
  environment: "web",
  strategy: "unavailable",
  reason: "Las propuestas ejecutables necesitan CoCreate Desktop y una carpeta local asociada al Project."
};

function initialSnapshot(): ProposalRuntimeSnapshot {
  return {
    availability: unavailableAvailability,
    proposals: [],
    activeId: null,
    busyAction: null,
    error: null
  };
}

function activeCandidate(proposals: ProposalRecord[]) {
  return [...proposals].reverse().find((proposal) =>
    proposal.workspace.available && !["rejected", "applied", "destroyed"].includes(proposal.status)
  ) ?? proposals[proposals.length - 1] ?? null;
}

export class ProposalRuntimeService {
  private state = initialSnapshot();
  private readonly listeners = new Set<(snapshot: ProposalRuntimeSnapshot) => void>();

  constructor(private readonly gateway: ProposalRuntimeGateway) {}

  private publish() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private replace(proposal: ProposalRecord) {
    const index = this.state.proposals.findIndex((entry) => entry.id === proposal.id);
    if (index >= 0) this.state.proposals[index] = proposal;
    else this.state.proposals.push(proposal);
    this.state.proposals.sort((left, right) => left.sequence - right.sequence);
    this.state.activeId = proposal.id;
  }

  private async run(action: string, operation: () => Promise<ProposalRecord>) {
    this.state.busyAction = action;
    this.state.error = null;
    this.publish();
    try {
      const proposal = await operation();
      this.replace(proposal);
      return proposal;
    } catch (cause) {
      this.state.error = cause instanceof Error ? cause.message : "Proposal Runtime no pudo completar la operación.";
      throw cause;
    } finally {
      this.state.busyAction = null;
      this.publish();
    }
  }

  async initialize() {
    const availability = await this.gateway.availability();
    const proposals = availability.available ? await this.gateway.list() : [];
    const active = activeCandidate(proposals);
    this.state = { availability, proposals, activeId: active?.id ?? null, busyAction: null, error: null };
    this.publish();
    return this.getSnapshot();
  }

  async createIteration(input: Omit<ProposalCreateInput, "parentId">) {
    const current = this.getActiveProposal();
    const parentId = current?.workspace.available && ["ready", "approved", "draft"].includes(current.status)
      ? current.id
      : null;
    const created = await this.run("preparing", () => this.gateway.create({ ...input, parentId }));
    if (created.status === "failed") throw new Error(created.errors[created.errors.length - 1] ?? "No pude crear el Proposal Workspace.");
    return this.run("applying", () => this.gateway.begin(created.id));
  }

  complete(id: string) {
    return this.run("preview", () => this.gateway.complete(id));
  }

  fail(id: string, reason: string) {
    return this.run("failed", () => this.gateway.fail(id, reason));
  }

  validate(id: string) {
    return this.run("validation", () => this.gateway.validate(id));
  }

  approve(id: string) {
    return this.run("approval", () => this.gateway.approve(id));
  }

  reject(id: string) {
    return this.run("reject", () => this.gateway.reject(id));
  }

  apply(id: string) {
    return this.run("apply", () => this.gateway.apply(id));
  }

  destroy(id: string) {
    return this.run("destroy", () => this.gateway.destroy(id));
  }

  startPreview(id: string) {
    return this.run("preview", () => this.gateway.startPreview(id));
  }

  stopPreview(id: string) {
    return this.run("preview", () => this.gateway.stopPreview(id));
  }

  restartPreview(id: string) {
    return this.run("preview", () => this.gateway.restartPreview(id));
  }

  refreshPreview(id: string) {
    return this.run("preview", () => this.gateway.refreshPreview(id));
  }

  select(id: string) {
    if (!this.state.proposals.some((proposal) => proposal.id === id)) return;
    this.state.activeId = id;
    this.state.error = null;
    this.publish();
  }

  getActiveProposal() {
    return this.state.proposals.find((proposal) => proposal.id === this.state.activeId) ?? null;
  }

  subscribe(listener: (snapshot: ProposalRuntimeSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): ProposalRuntimeSnapshot {
    return structuredClone(this.state);
  }
}
