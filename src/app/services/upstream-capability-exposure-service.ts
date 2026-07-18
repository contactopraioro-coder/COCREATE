import type { CodexExecutionEvent, CodexStatus } from "../../../shared/codex-contracts.js";
import {
  createInitialCapabilityExposure,
  reduceCapabilityExposure,
  type CapabilityExposureState
} from "../../../shared/upstream-capability-exposure.js";

export class UpstreamCapabilityExposureService {
  private snapshot: CapabilityExposureState = createInitialCapabilityExposure();
  private snapshotsByExecution = new Map<string, CapabilityExposureState>();
  private readonly listeners = new Set<(snapshot: CapabilityExposureState) => void>();

  getSnapshot() {
    return this.snapshot;
  }

  getSnapshotForExecution(executionId: string | null | undefined) {
    return executionId ? this.snapshotsByExecution.get(executionId) ?? null : null;
  }

  initialize(status: CodexStatus) {
    this.snapshot = createInitialCapabilityExposure(status);
    this.snapshotsByExecution.clear();
    this.publish();
    return this.snapshot;
  }

  consume(event: CodexExecutionEvent) {
    const executionId = "executionId" in event && typeof event.executionId === "string" ? event.executionId : null;
    const current = executionId
      ? this.snapshotsByExecution.get(executionId) ?? {
          ...createInitialCapabilityExposure(),
          registry: this.snapshot.registry
        }
      : this.snapshot;
    const next = reduceCapabilityExposure(current, event);
    if (next === current) return this.snapshot;
    if (executionId) this.snapshotsByExecution.set(executionId, next);
    this.snapshot = next;
    this.publish();
    return this.snapshot;
  }

  subscribe(listener: (snapshot: CapabilityExposureState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  resetActivity() {
    this.snapshot = {
      ...createInitialCapabilityExposure(),
      registry: this.snapshot.registry
    };
    this.publish();
  }

  private publish() {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
