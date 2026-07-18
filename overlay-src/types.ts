import type { CodexStatus as SharedCodexStatus } from "../shared/codex-contracts";

export interface AppConfig {
  outputDir: string;
  defaultGeminiModel: string;
  workingDirectory?: string;
  appVersion?: string;
  runtimeVersion?: string;
  platform: string;
  stateStorePath: string;
  foundationStorePath?: string;
  featureFlags: {
    persistentSessions: boolean;
    liveCompare: boolean;
    realtimeChunks: boolean;
    autoApplyCodex: boolean;
  };
  codex: CodexStatus;
}

export type CodexStatus = SharedCodexStatus;

export interface SaveRecordingResult {
  filePath: string;
  fileSize: number;
}

export interface AnalysisResult {
  model: string;
  fileName: string;
  output: string;
  provider?: string;
  requestId?: string;
}

export type RecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "ready"
  | "analyzing";
