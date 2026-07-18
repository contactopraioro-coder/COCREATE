import type { CodexExecutionEvent, CodexStatus } from "./codex-contracts.js";
import type { CoCreateCodexEvent } from "./codex-upstream-contracts.js";

export type ProductStatus =
  | "Idle"
  | "Active"
  | "Restored"
  | "Unknown"
  | "Running"
  | "Waiting"
  | "Completed"
  | "Cancelled"
  | "Failed"
  | "Interrupted"
  | "Warning";
export type CapabilityRegistryEntry = {
  id: string;
  label: string;
  enabled: boolean;
  status: "Enabled" | "Unavailable";
  source: "codex-app-server";
};
export type CapabilityRegistrySnapshot = {
  source: "codex-app-server";
  available: boolean;
  codexVersion: string | null;
  protocolVersion: string | null;
  entries: CapabilityRegistryEntry[];
  enabledCount: number;
  mcpServersConnected: number;
  updatedAt: string;
};
export type CapabilityExposureState = {
  version: 1;
  registry: CapabilityRegistrySnapshot;
  execution: { id: string | null; status: ProductStatus; active: boolean; startedAt: string | null; completedAt: string | null; durationMs: number | null; result: string | null };
  thread: { id: string | null; status: string; active: boolean; origin: "new" | "restored" | null };
  turn: { id: string | null; status: ProductStatus; active: boolean };
  streaming: { active: boolean; chunks: number };
  current: { capability: string | null; label: string | null; status: ProductStatus; timestamp: string | null };
  plan: { explanation: string; steps: Array<{ id: string; text: string; status: "completed" | "running" | "pending" }>; updatedAt: string } | null;
  command: { id: string | null; label: string; status: ProductStatus; command: string; exitCode: number | null; updatedAt: string } | null;
  tool: { label: string; status: ProductStatus; name: string; updatedAt: string } | null;
  diff: { files: string[]; additions: number; deletions: number; size: number; preview: string; truncated: boolean; updatedAt: string } | null;
  patch: { files: string[]; generatedFiles: string[]; changesCount: number; status: ProductStatus; updatedAt: string } | null;
  approval: { active: boolean; status: ProductStatus; label: string; command: string; reason: string; updatedAt: string } | null;
  webSearch: { status: ProductStatus; label: string | null };
  usage: { provider: string | null; model: string | null; tokens: Record<string, unknown> | null; durationMs: number | null; threadId: string | null; turnId: string | null };
  warnings: Array<{ message: string; status: ProductStatus; timestamp: string }>;
  lastActivity: { type: string; summary: string; timestamp: string; executionId: string | null } | null;
  updatedAt: string;
};
export type ProductCapabilityEvent = {
  kind: string;
  technicalType: string;
  timestamp: string;
  executionId: string | null;
  threadId: string | null;
  turnId: string | null;
  capability: string | null;
  label: string | null;
  status: ProductStatus | null;
  data: Record<string, any>;
  activity: { type: string; summary: string } | null;
};

export const CODEX_PRODUCT_EVENT_MAPPING: Readonly<Record<string, string>>;
export declare function summarizeCommand(command: unknown): string;
export declare function summarizeFileChanges(changes: unknown): { files: string[]; generatedFiles: string[]; changesCount: number };
export declare function summarizeUnifiedDiff(value: unknown): { files: string[]; additions: number; deletions: number; size: number; preview: string; truncated: boolean };
export declare function createCapabilityRegistry(status: CodexStatus | null): CapabilityRegistrySnapshot;
export declare function createInitialCapabilityExposure(status?: CodexStatus | null): CapabilityExposureState;
export declare function deriveActiveWorkState(state: CapabilityExposureState): {
  id: "idle" | "preparing" | "planning" | "running" | "waiting-approval" | "applying" | "testing" | "completed" | "cancelled" | "failed" | "interrupted";
  label: string;
  status: ProductStatus;
  active: boolean;
};
export declare function mapUpstreamEventToProductEvent(event: CoCreateCodexEvent): ProductCapabilityEvent | null;
export declare function mapCodexEventToProductEvent(event: CodexExecutionEvent): ProductCapabilityEvent | null;
export declare function reduceCapabilityExposure(state: CapabilityExposureState, event: CodexExecutionEvent): CapabilityExposureState;
