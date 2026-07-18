export interface LocalStateStore<TSnapshot> {
  load(): Promise<TSnapshot | null>;
  save(snapshot: TSnapshot): Promise<void>;
}

export interface WorkbenchSnapshotEnvelope<TSnapshot> {
  title?: string;
  snapshot: TSnapshot;
}

export class NullLocalStateStore<TSnapshot> implements LocalStateStore<TSnapshot> {
  async load(): Promise<TSnapshot | null> {
    return null;
  }

  async save(_snapshot: TSnapshot): Promise<void> {
    return;
  }
}

export interface FoundationPreferences {
  theme: string | null;
  activeMode: string | null;
  sidebarCollapsed: boolean | null;
}

export interface FoundationCodexStatusSnapshot {
  available: boolean;
  binary: string;
  version: string | null;
  compatible: boolean;
  validatedVersion: string | null;
  minimumSupportedVersion: string | null;
  error: string | null;
  updatedAt: string;
}

export interface FoundationExecutionSnapshot {
  executionId: string;
  status: string;
  binary: string;
  version: string;
  promptPreview: string;
  outputPreview: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface FoundationStateSnapshot {
  version: number;
  preferences: FoundationPreferences;
  codex: {
    lastKnownStatus: FoundationCodexStatusSnapshot | null;
  };
  recentExecutions: FoundationExecutionSnapshot[];
}

export interface FoundationStateStore extends LocalStateStore<FoundationStateSnapshot> {
  update(mutator: (state: FoundationStateSnapshot) => void | Promise<void>): Promise<FoundationStateSnapshot>;
}
