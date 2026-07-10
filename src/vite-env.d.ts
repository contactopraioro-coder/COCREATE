/// <reference types="vite/client" />

declare global {
  interface Window {
    overlayBridge?: {
      getConfig: () => Promise<{
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
        codex: {
          available: boolean;
          binary: string;
          version: string | null;
          license: string;
          source: string;
          mode: string;
          error?: string;
        };
      }>;
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
      getCodexStatus: () => Promise<{
        available: boolean;
        binary: string;
        version: string | null;
        license: string;
        source: string;
        mode: string;
        error?: string;
      }>;
      runCodex: (payload: {
        prompt: string;
      }) => Promise<{
        ok: boolean;
        output: string;
        stderr?: string;
      }>;
      saveRecording: (payload: {
        buffer: Uint8Array;
        mimeType: string;
        suggestedName?: string;
      }) => Promise<{
        filePath: string;
        fileSize: number;
      }>;
      analyzeRecording: (payload: {
        apiKey: string;
        model: string;
        notes: string;
        filePath: string;
        mimeType: string;
      }) => Promise<{
        model: string;
        fileUri: string;
        fileName: string;
        output: string;
      }>;
      copyText: (value: string) => Promise<{ ok: true }>;
      closeApp: () => Promise<void>;
    };
  }
}

export {};
