export type VoicePermission = "prompt" | "granted" | "denied" | "unknown";
export type VoiceDevice = { id: string; label: string };
export type VoiceStatus = "idle" | "requesting" | "recording" | "transcribing" | "denied" | "unavailable" | "error";
export type VoiceSnapshot = {
  status: VoiceStatus;
  permission: VoicePermission;
  supported: boolean;
  devices: VoiceDevice[];
  selectedDeviceId: string | null;
  error: string | null;
  interimTranscript: string;
  transcript: string;
};

export type VoiceRecordingHandle = {
  stop: () => Promise<{ audioBase64: string; mimeType: string }>;
  cancel: () => Promise<void>;
  onDeviceEnded?: (listener: () => void) => () => void;
  onTranscript?: (listener: (event: { transcript: string; interimTranscript: string }) => void) => () => void;
};

export type VoiceGateway = {
  inspect: () => Promise<{ supported: boolean; permission: VoicePermission; devices: VoiceDevice[]; reason?: string }>;
  start: (deviceId?: string | null) => Promise<VoiceRecordingHandle>;
  transcribe: (input: { audioBase64: string; mimeType: string; language: string }) => Promise<{ text: string }>;
};

type Listener = (snapshot: VoiceSnapshot) => void;

export class VoiceService {
  private snapshot: VoiceSnapshot = {
    status: "idle",
    permission: "unknown",
    supported: false,
    devices: [],
    selectedDeviceId: null,
    error: null,
    interimTranscript: "",
    transcript: ""
  };
  private listeners = new Set<Listener>();
  private recording: VoiceRecordingHandle | null = null;
  private recordingTimeout: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeDeviceEnded: (() => void) | null = null;
  private unsubscribeTranscript: (() => void) | null = null;

  constructor(
    private readonly gateway?: VoiceGateway,
    private readonly timeoutMs = 120_000,
    private readonly permissionTimeoutMs = 15_000
  ) {}

  getSnapshot() { return this.snapshot; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  private publish(patch: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  async initialize() {
    if (!this.gateway) {
      this.publish({ status: "unavailable", supported: false, permission: "unknown", error: "Este entorno no ofrece captura de voz.", interimTranscript: "", transcript: "" });
      return this.snapshot;
    }
    const readiness = await this.gateway.inspect();
    this.publish({
      supported: readiness.supported,
      permission: readiness.permission,
      devices: readiness.devices,
      selectedDeviceId: this.snapshot.selectedDeviceId ?? readiness.devices[0]?.id ?? null,
      status: readiness.supported ? readiness.permission === "denied" ? "denied" : "idle" : "unavailable",
      error: readiness.reason ?? null,
      interimTranscript: "",
      transcript: ""
    });
    return this.snapshot;
  }

  selectDevice(deviceId: string) {
    if (this.snapshot.status === "recording" || !this.snapshot.devices.some((device) => device.id === deviceId)) return;
    this.publish({ selectedDeviceId: deviceId });
  }

  async start() {
    if (!this.gateway || !this.snapshot.supported) throw new Error(this.snapshot.error ?? "El microfono no esta disponible.");
    if (this.recording) return;
    this.publish({ status: "requesting", error: null, interimTranscript: "", transcript: "" });
    try {
      this.recording = await new Promise<VoiceRecordingHandle>((resolve, reject) => {
        let expired = false;
        const timeout = setTimeout(() => {
          expired = true;
          reject(new Error("El navegador no respondió a la solicitud del micrófono. Revisa el permiso e inténtalo de nuevo."));
        }, this.permissionTimeoutMs);

        this.gateway!.start(this.snapshot.selectedDeviceId).then((handle) => {
          clearTimeout(timeout);
          if (expired) {
            void handle.cancel();
            return;
          }
          resolve(handle);
        }, (cause) => {
          clearTimeout(timeout);
          if (!expired) reject(cause);
        });
      });
      this.unsubscribeDeviceEnded = this.recording.onDeviceEnded?.(() => {
        this.clearRecording();
        this.publish({ status: "unavailable", error: "El microfono se desconecto durante la grabacion." });
      }) ?? null;
      this.unsubscribeTranscript = this.recording.onTranscript?.((event) => {
        this.publish({
          transcript: event.transcript.trim(),
          interimTranscript: event.interimTranscript.trim()
        });
      }) ?? null;
      this.recordingTimeout = setTimeout(() => {
        void this.recording?.cancel().finally(() => {
          this.clearRecording();
          this.publish({ status: "error", error: "La grabacion se detuvo al alcanzar el limite de tiempo." });
        });
      }, this.timeoutMs);
      this.publish({ status: "recording", permission: "granted" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pude acceder al microfono.";
      const denied = /permission denied|permiso denegado|denied|notallowed|not allowed/i.test(message);
      this.clearRecording();
      this.publish({ status: denied ? "denied" : "error", permission: denied ? "denied" : this.snapshot.permission, error: message });
      throw cause;
    }
  }

  async stopAndTranscribe(language = "es") {
    if (!this.gateway || !this.recording) throw new Error("No hay una grabacion activa.");
    const handle = this.recording;
    this.publish({ status: "transcribing", error: null });
    this.clearRecording();
    try {
      const audio = await handle.stop();
      const result = await this.gateway.transcribe({ ...audio, language });
      this.publish({ status: "idle", error: null, transcript: result.text.trim(), interimTranscript: "" });
      return result.text.trim();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pude transcribir la nota de voz.";
      this.publish({ status: "error", error: message });
      throw cause;
    }
  }

  async cancel() {
    const handle = this.recording;
    this.clearRecording();
    await handle?.cancel();
    this.publish({ status: "idle", error: null, interimTranscript: "", transcript: "" });
  }

  private clearRecording(dropHandle = true) {
    if (this.recordingTimeout) clearTimeout(this.recordingTimeout);
    this.recordingTimeout = null;
    this.unsubscribeDeviceEnded?.();
    this.unsubscribeDeviceEnded = null;
    this.unsubscribeTranscript?.();
    this.unsubscribeTranscript = null;
    if (dropHandle) this.recording = null;
  }

  async dispose() {
    await this.cancel();
    this.listeners.clear();
  }
}
