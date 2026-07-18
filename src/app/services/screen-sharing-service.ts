export type ScreenSharePreference = "screen" | "window" | "tab";
export type ScreenShareStatus = "idle" | "requesting" | "sharing" | "paused" | "ended" | "cancelled" | "permission-denied" | "unsupported" | "error";
export type ScreenPermissionStatus = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

export type SharedSurface = {
  label: string;
  displaySurface: "browser" | "window" | "monitor" | "application" | "unknown";
  width: number | null;
  height: number | null;
  startedAt: string;
};

export type ScreenSharingSnapshot = {
  supported: boolean;
  status: ScreenShareStatus;
  permission: ScreenPermissionStatus;
  preference: ScreenSharePreference | null;
  surface: SharedSurface | null;
  error: string | null;
  updatedAt: string;
};

export type ScreenSharingGateway = {
  isSupported: () => boolean;
  getPermissionStatus: () => Promise<ScreenPermissionStatus>;
  request: (preference: ScreenSharePreference) => Promise<MediaStream>;
  openPermissionSettings: () => Promise<boolean>;
};

type Listener = (snapshot: ScreenSharingSnapshot) => void;

function nowIso() {
  return new Date().toISOString();
}

function initialSnapshot(supported: boolean): ScreenSharingSnapshot {
  return {
    supported,
    status: supported ? "idle" : "unsupported",
    permission: "unknown",
    preference: null,
    surface: null,
    error: supported ? null : "Este dispositivo no permite compartir pantalla desde CoCreate.",
    updatedAt: nowIso()
  };
}

function safeSurfaceLabel(track: MediaStreamTrack, preference: ScreenSharePreference) {
  const label = track.label.trim().replace(/[\r\n\t]+/g, " ").slice(0, 120);
  if (label) return label;
  if (preference === "window") return "Ventana compartida";
  if (preference === "tab") return "Pestaña compartida";
  return "Pantalla compartida";
}

function displaySurface(track: MediaStreamTrack): SharedSurface["displaySurface"] {
  const value = track.getSettings().displaySurface;
  if (value === "browser" || value === "window" || value === "monitor") return value;
  return "unknown";
}

function normalizedError(cause: unknown) {
  const name = cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : "";
  if (name === "AbortError") {
    return { status: "cancelled" as const, message: "Se cerró el selector sin compartir una superficie." };
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { status: "permission-denied" as const, message: "CoCreate no recibió permiso para compartir esa superficie." };
  }
  if (name === "NotFoundError") {
    return { status: "error" as const, message: "No hay una pantalla, ventana o pestaña disponible para compartir." };
  }
  if (name === "NotReadableError") {
    return { status: "error" as const, message: "La superficie elegida está siendo utilizada por otra aplicación." };
  }
  return {
    status: "error" as const,
    message: cause instanceof Error && cause.message ? cause.message : "No se pudo iniciar la pantalla compartida."
  };
}

export class ScreenSharingService {
  private snapshot: ScreenSharingSnapshot;
  private stream: MediaStream | null = null;
  private listeners = new Set<Listener>();
  private requestSequence = 0;

  constructor(private readonly gateway: ScreenSharingGateway) {
    this.snapshot = initialSnapshot(gateway.isSupported());
  }

  async initialize() {
    if (!this.snapshot.supported) return this.getSnapshot();
    const permission = await this.gateway.getPermissionStatus().catch(() => "unknown" as const);
    this.update({ permission });
    return this.getSnapshot();
  }

  async start(preference: ScreenSharePreference) {
    if (!this.snapshot.supported) return this.getSnapshot();
    const sequence = ++this.requestSequence;
    const previousStream = this.stream;
    const previousSurface = this.snapshot.surface;
    this.update({ status: "requesting", preference, error: null });
    try {
      const stream = await this.gateway.request(preference);
      if (sequence !== this.requestSequence) {
        for (const track of stream.getTracks()) track.stop();
        return this.getSnapshot();
      }
      const track = stream.getVideoTracks()[0];
      if (!track) throw new DOMException("La captura no incluyó video.", "NotFoundError");
      if (previousStream) this.stopStream(previousStream);
      this.stream = stream;
      const settings = track.getSettings();
      track.addEventListener("ended", this.handleTrackEnded, { once: true });
      this.update({
        status: "sharing",
        permission: "granted",
        surface: {
          label: safeSurfaceLabel(track, preference),
          displaySurface: displaySurface(track),
          width: typeof settings.width === "number" ? settings.width : null,
          height: typeof settings.height === "number" ? settings.height : null,
          startedAt: nowIso()
        },
        error: null
      });
    } catch (cause) {
      if (sequence !== this.requestSequence) return this.getSnapshot();
      const failure = normalizedError(cause);
      this.stream = previousStream;
      this.update({
        status: previousStream ? "sharing" : failure.status,
        permission: failure.status === "permission-denied" ? "denied" : this.snapshot.permission,
        surface: previousSurface,
        error: failure.message
      });
    }
    return this.getSnapshot();
  }

  async change(preference: ScreenSharePreference = this.snapshot.preference ?? "screen") {
    return this.start(preference);
  }

  togglePause() {
    if (!this.stream || !this.snapshot.surface) return this.getSnapshot();
    const paused = this.snapshot.status !== "paused";
    for (const track of this.stream.getVideoTracks()) track.enabled = !paused;
    this.update({ status: paused ? "paused" : "sharing" });
    return this.getSnapshot();
  }

  stop(reason: "user" | "mode-exit" | "approval" = "user") {
    this.requestSequence += 1;
    this.stopTracks();
    this.update({
      status: reason === "user" ? "ended" : "idle",
      preference: null,
      surface: null,
      error: null
    });
    return this.getSnapshot();
  }

  async openPermissionSettings() {
    return this.gateway.openPermissionSettings();
  }

  getStream() {
    return this.stream;
  }

  getSnapshot() {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.requestSequence += 1;
    this.stopTracks();
    this.listeners.clear();
  }

  private readonly handleTrackEnded = () => {
    this.stream = null;
    this.update({
      status: "ended",
      preference: null,
      surface: null,
      error: "La pantalla compartida se detuvo. Puedes elegir otra superficie cuando quieras."
    });
  };

  private stopTracks() {
    if (!this.stream) return;
    this.stopStream(this.stream);
    this.stream = null;
  }

  private stopStream(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      track.removeEventListener("ended", this.handleTrackEnded);
      track.stop();
    }
  }

  private update(patch: Partial<ScreenSharingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, updatedAt: nowIso() };
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}
