import type {
  ScreenPermissionStatus,
  ScreenSharePreference,
  ScreenSharingGateway
} from "../../app/services/screen-sharing-service.js";

function preferenceConstraints(preference: ScreenSharePreference): DisplayMediaStreamOptions {
  const displaySurface = preference === "tab" ? "browser" : preference === "screen" ? "monitor" : "window";
  return {
    video: { displaySurface } as MediaTrackConstraints,
    audio: false
  };
}

export function createScreenSharingGateway(): ScreenSharingGateway {
  return {
    isSupported() {
      return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
    },
    async getPermissionStatus(): Promise<ScreenPermissionStatus> {
      if (window.overlayBridge?.getScreenCapturePermission) {
        return window.overlayBridge.getScreenCapturePermission();
      }
      return "unknown";
    },
    async request(preference) {
      if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        throw new DOMException("Screen capture is not supported.", "NotSupportedError");
      }
      return navigator.mediaDevices.getDisplayMedia(preferenceConstraints(preference));
    },
    async openPermissionSettings() {
      return window.overlayBridge?.openScreenCaptureSettings?.() ?? false;
    }
  };
}
