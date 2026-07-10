/// <reference types="vite/client" />

declare global {
  interface Window {
    overlayBridge?: {
      getConfig: () => Promise<import("./types").AppConfig>;
      saveRecording: (payload: {
        buffer: Uint8Array;
        mimeType: string;
        suggestedName?: string;
      }) => Promise<import("./types").SaveRecordingResult>;
      analyzeRecording: (payload: {
        apiKey: string;
        model: string;
        notes: string;
        filePath: string;
        mimeType: string;
      }) => Promise<import("./types").AnalysisResult>;
      copyText: (value: string) => Promise<{ ok: boolean }>;
      closeApp: () => Promise<void>;
    };
  }
}

export {};
