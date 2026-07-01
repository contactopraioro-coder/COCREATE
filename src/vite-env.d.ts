/// <reference types="vite/client" />

declare global {
  interface Window {
    overlayBridge?: {
      onState: (
        callback: (payload: import("./types").OverlayState) => void
      ) => () => void;
      toggleCollapse: () => Promise<{ collapsed: boolean }>;
      closeApp: () => Promise<void>;
    };
  }
}

export {};
