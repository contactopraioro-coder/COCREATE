/// <reference types="vite/client" />

declare global {
  interface Window {
    overlayBridge?: {
      getConfig: () => Promise<import("./types").AppConfig>;
      getAppState: () => Promise<{
        state: {
          version: number;
          updatedAt: number;
          activeSessionId: string | null;
          sessions: Array<{
            id: string;
            title: string;
            createdAt: number;
            updatedAt: number;
            renderer: {
              workbench: unknown;
            };
            events: Array<{
              id: string;
              type: string;
              source: string;
              payload: Record<string, unknown>;
              createdAt: number;
            }>;
          }>;
        };
        session: {
          id: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          renderer: {
            workbench: unknown;
          };
          events: Array<{
            id: string;
            type: string;
            source: string;
            payload: Record<string, unknown>;
            createdAt: number;
          }>;
        } | null;
        featureFlags: {
          persistentSessions: boolean;
          liveCompare: boolean;
          realtimeChunks: boolean;
          autoApplyCodex: boolean;
        };
      }>;
      saveRendererState: (payload: {
        title?: string;
        snapshot: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        sessionId: string | null;
        updatedAt: number;
      }>;
      appendAppEvent: (payload: {
        type: string;
        source?: string;
        payload?: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        sessionId: string | null;
      }>;
      getCodexStatus: () => Promise<import("./types").CodexStatus>;
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
