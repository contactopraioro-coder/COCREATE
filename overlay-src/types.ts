export interface AppConfig {
  outputDir: string;
  defaultGeminiModel: string;
  platform: string;
  stateStorePath: string;
  featureFlags: {
    persistentSessions: boolean;
    liveCompare: boolean;
    realtimeChunks: boolean;
    autoApplyCodex: boolean;
  };
  codex: CodexStatus;
}

export interface CodexStatus {
  available: boolean;
  binary: string;
  version: string | null;
  license: string;
  source: string;
  mode: string;
  error?: string;
}

export interface SaveRecordingResult {
  filePath: string;
  fileSize: number;
}

export interface AnalysisResult {
  model: string;
  fileUri: string;
  fileName: string;
  output: string;
}

export type RecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "ready"
  | "analyzing";
