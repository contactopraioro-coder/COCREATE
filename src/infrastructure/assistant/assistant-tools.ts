export type DateTimeToolSnapshot = {
  iso: string;
  resolvedAt: string;
  timezone: string;
  timezoneSource: "profile" | "browser" | "system";
  locale: string;
  localDate: string;
  localTime: string;
  dayOfWeek: string;
  monthName: string;
  year: number;
  month: number;
  day: number;
};

export type WorkspaceToolSnapshot = {
  workspace: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  task: Record<string, unknown> | null;
  conversation: Record<string, unknown> | null;
  conversations: Array<Record<string, unknown>>;
};

export type IdentityToolSnapshot = {
  identity: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  device: Record<string, unknown> | null;
};

export type DateTimeTool = {
  getCurrentDateTime: () => Promise<DateTimeToolSnapshot | null>;
};

export type WorkspaceTool = {
  getCurrentWorkspaceContext: () => Promise<WorkspaceToolSnapshot | null>;
};

export type IdentityTool = {
  getCurrentIdentityContext: () => Promise<IdentityToolSnapshot | null>;
};

export type SystemTool = {
  getCurrentSystemContext: () => Promise<Record<string, unknown> | null>;
};

export type { TrustedWebTool } from "../../../shared/trusted-web-contracts.js";

export type FutureMemoryTool = {
  isAvailable: () => boolean;
};
