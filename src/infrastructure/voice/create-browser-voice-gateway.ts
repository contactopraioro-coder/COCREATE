import type { VoiceDevice, VoiceGateway, VoicePermission, VoiceRecordingHandle } from "../../app/services/voice-service.js";

type SpeechRecognitionConstructor = new () => SpeechRecognition;
type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionEvent = {
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

function getSpeechRecognition() {
  const windowWithSpeech = window as Window &
    typeof globalThis & {
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
      SpeechRecognition?: SpeechRecognitionConstructor;
    };

  return windowWithSpeech.SpeechRecognition ?? windowWithSpeech.webkitSpeechRecognition;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function inspectPermission(): Promise<VoicePermission> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return status?.state === "granted" || status?.state === "denied" || status?.state === "prompt" ? status.state : "unknown";
  } catch {
    return "unknown";
  }
}

async function listDevices(): Promise<VoiceDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audioinput").map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microfono ${index + 1}`
    }));
  } catch {
    return [];
  }
}

export function createBrowserVoiceGateway(): VoiceGateway | undefined {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return undefined;
  return {
    async inspect() {
      if (window.overlayBridge?.getVoiceStatus) {
        const health = await window.overlayBridge.getVoiceStatus().catch(() => null);
        if (health && health.status !== "Healthy") {
          return {
            supported: false,
            permission: await inspectPermission(),
            devices: await listDevices(),
            reason: health.message ?? "El provider de transcripcion no esta disponible."
          };
        }
      }
      return { supported: true, permission: await inspectPermission(), devices: await listDevices() };
    },
    async start(deviceId) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      const endedListeners = new Set<() => void>();
      const transcriptListeners = new Set<(event: { transcript: string; interimTranscript: string }) => void>();
      let cancelled = false;
      let stopped = false;
      let recognitionStopped = false;
      const Recognition = getSpeechRecognition();
      const recognition = Recognition ? new Recognition() : null;
      recorder.ondataavailable = (event) => { if (!cancelled && event.data.size) chunks.push(event.data); };
      for (const track of stream.getTracks()) track.addEventListener("ended", () => endedListeners.forEach((listener) => listener()), { once: true });
      if (recognition) {
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "es-CO";
        recognition.onresult = (event) => {
          let transcript = "";
          let interimTranscript = "";
          for (const result of Array.from(event.results)) {
            const value = result[0]?.transcript?.trim();
            if (!value) continue;
            if (result.isFinal) transcript = `${transcript} ${value}`.trim();
            else interimTranscript = `${interimTranscript} ${value}`.trim();
          }
          for (const listener of transcriptListeners) listener({ transcript, interimTranscript });
        };
        recognition.onend = () => {
          if (!recognitionStopped && !cancelled && recorder.state !== "inactive") {
            try { recognition.start(); } catch {}
          }
        };
        recognition.onerror = () => undefined;
      }
      recorder.start();
      try { recognition?.start(); } catch {}
      const cleanup = () => stream.getTracks().forEach((track) => track.stop());
      const handle: VoiceRecordingHandle = {
        stop: () => new Promise((resolve, reject) => {
          if (stopped || recorder.state === "inactive") return reject(new Error("La grabacion ya termino."));
          stopped = true;
          recognitionStopped = true;
          try { recognition?.stop(); } catch {}
          recorder.onerror = () => { cleanup(); reject(new Error("La captura de audio fallo.")); };
          recorder.onstop = async () => {
            cleanup();
            const blob = new Blob(chunks, { type: mimeType });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            resolve({ audioBase64: bytesToBase64(bytes), mimeType });
          };
          recorder.stop();
        }),
        async cancel() {
          cancelled = true;
          recognitionStopped = true;
          try { recognition?.stop(); } catch {}
          if (recorder.state !== "inactive") recorder.stop();
          cleanup();
          chunks.length = 0;
        },
        onDeviceEnded(listener) {
          endedListeners.add(listener);
          return () => endedListeners.delete(listener);
        },
        onTranscript(listener) {
          transcriptListeners.add(listener);
          return () => transcriptListeners.delete(listener);
        }
      };
      return handle;
    },
    async transcribe(input) {
      if (window.overlayBridge?.transcribeVoice) {
        const result = await window.overlayBridge.transcribeVoice(input);
        return { text: result.text };
      }
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.text !== "string") throw new Error(payload?.error ?? "No pude transcribir la nota de voz.");
      return { text: payload.text };
    }
  };
}
