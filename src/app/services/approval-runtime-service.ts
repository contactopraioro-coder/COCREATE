import type { ApprovalGateway } from "../../infrastructure/approval/approval-gateway.js";

export type ApprovalRequest = {
  approvalId: string;
  category: string;
  action: string;
  risk: string;
  reason: string | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  requestedAt: string;
  expiresAt: string;
};

export type ApprovalState = {
  pending: ApprovalRequest | null;
  responding: boolean;
  result: "approved" | "rejected" | "expired" | "error" | null;
  error: string | null;
};

type Listener = (state: ApprovalState) => void;

export class ApprovalRuntimeService {
  private state: ApprovalState = { pending: null, responding: false, result: null, error: null };
  private listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly gateway: ApprovalGateway) {}

  initialize() {
    if (this.unsubscribe || !this.gateway.isAvailable()) return;
    this.unsubscribe = this.gateway.subscribe((request) => {
      if (this.expiryTimer) clearTimeout(this.expiryTimer);
      this.state = { pending: request, responding: false, result: null, error: null };
      this.emit();
      const delay = Math.max(0, Date.parse(request.expiresAt) - Date.now());
      this.expiryTimer = setTimeout(() => {
        if (this.state.pending?.approvalId !== request.approvalId) return;
        this.state = { pending: null, responding: false, result: "expired", error: "La aprobación expiró y fue rechazada." };
        this.expiryTimer = null;
        this.emit();
      }, delay);
    });
  }

  getSnapshot() {
    return this.state;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async respond(decision: "approve" | "reject") {
    const request = this.state.pending;
    if (!request || this.state.responding || !this.gateway.isAvailable()) return false;
    if (Date.parse(request.expiresAt) <= Date.now()) {
      if (this.expiryTimer) clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
      this.state = { pending: null, responding: false, result: "expired", error: "La aprobación expiró y fue rechazada." };
      this.emit();
      return false;
    }
    this.state = { ...this.state, responding: true, error: null };
    this.emit();
    try {
      const result = await this.gateway.respond(request.approvalId, decision);
      if (!result.ok) throw new Error("La aprobación ya no está activa.");
      this.state = {
        pending: null,
        responding: false,
        result: decision === "approve" ? "approved" : "rejected",
        error: null
      };
      if (this.expiryTimer) clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
      this.emit();
      return true;
    } catch (cause) {
      this.state = {
        ...this.state,
        responding: false,
        result: "error",
        error: cause instanceof Error ? cause.message : "No se pudo responder la aprobación."
      };
      this.emit();
      return false;
    }
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.listeners.clear();
  }
}
