export interface AppConfig {
  outputDir: string;
  defaultGeminiModel: string;
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
