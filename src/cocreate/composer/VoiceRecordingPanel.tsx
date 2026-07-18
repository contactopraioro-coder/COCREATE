import { LoaderCircle, Send, Square, X } from "lucide-react";

type Props = {
  elapsedSeconds: number;
  transcribing: boolean;
  statusLabel: string | null;
  transcriptPreview: string | null;
  onCancel: () => void;
  onStop: () => void;
  onTranscribeAndSend: () => void;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function VoiceRecordingPanel({
  elapsedSeconds,
  transcribing,
  statusLabel,
  transcriptPreview,
  onCancel,
  onStop,
  onTranscribeAndSend
}: Props) {
  return (
    <section className="voice-recording-panel" aria-label="Nota de voz activa" aria-live="polite">
      <div className="voice-recording-state">
        <span className="voice-live-dot" aria-hidden="true" />
        <span>
          <strong>{transcribing ? "Transcribiendo" : "Escuchando..."}</strong>
          <small>{formatDuration(elapsedSeconds)}</small>
        </span>
      </div>

      <div className="voice-waveform" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -70}ms` }} />)}
      </div>

      <div className="voice-transcript-preview">
        <strong>{statusLabel ?? (transcribing ? "Entendiendo tu indicación..." : "Habla cuando quieras")}</strong>
        <span>{transcriptPreview?.trim() || "Tu transcripción aparecerá aquí mientras preparamos la siguiente iteración."}</span>
      </div>

      <div className="voice-recording-actions">
        <button type="button" className="voice-text-action" onClick={onCancel} disabled={transcribing}><X size={14} /> Cancelar</button>
        <button type="button" className="voice-text-action" onClick={onStop} disabled={transcribing}><Square size={13} /> Detener</button>
        <button type="button" className="voice-send-action" onClick={onTranscribeAndSend} disabled={transcribing}>
          {transcribing ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
          Transcribir y enviar
        </button>
      </div>
    </section>
  );
}
