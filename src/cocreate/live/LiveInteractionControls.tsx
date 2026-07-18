import { Link2, LoaderCircle, Mic, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import type { VoiceSnapshot } from "../../app/services/voice-service.js";
import { VoiceRecordingPanel } from "../composer/VoiceRecordingPanel";

export type LiveComposerStage =
  | "idle"
  | "listening"
  | "observing"
  | "transcribing"
  | "understanding"
  | "planning"
  | "updating"
  | "ready"
  | "error";

type Props = {
  value: string;
  selectionLabel: string | null;
  iterationCount: number;
  busy: boolean;
  canUndo: boolean;
  canDiscard: boolean;
  canDevelop: boolean;
  projectLinked: boolean;
  voice: VoiceSnapshot;
  voiceElapsedSeconds: number;
  voiceAvailable: boolean;
  voiceHint: string | null;
  voiceHintActionLabel?: string;
  stage: LiveComposerStage;
  transcriptPreview: string | null;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onToggleVoice: () => void;
  onCancelVoice: () => void;
  onStopVoice: () => void;
  onTranscribeAndSend: () => void;
  onUndo: () => void;
  onDiscard: () => void;
  onApproveAndDevelop: () => void;
  onLinkProject: () => void;
  onExit: () => void;
};

export function LiveInteractionControls(props: Props) {
  const voiceActive = props.voice.status === "recording" || props.voice.status === "transcribing";
  const statusLabel = props.stage === "listening"
    ? "Escuchando..."
    : props.stage === "observing"
      ? "Observando la interfaz..."
    : props.stage === "transcribing"
      ? "Transcribiendo..."
      : props.stage === "understanding"
        ? "Entendiendo tu indicación..."
        : props.stage === "planning"
          ? "Preparando propuesta..."
          : props.stage === "updating"
            ? "Actualizando la propuesta..."
            : props.stage === "error"
              ? "Revisa el micrófono o escribe tu instrucción"
              : null;

  return (
    <section className="live-interaction-controls" aria-label="Controles de Live Coding">
      {voiceActive ? (
        <VoiceRecordingPanel
          elapsedSeconds={props.voiceElapsedSeconds}
          transcribing={props.voice.status === "transcribing"}
          statusLabel={statusLabel}
          transcriptPreview={props.transcriptPreview}
          onCancel={props.onCancelVoice}
          onStop={props.onStopVoice}
          onTranscribeAndSend={props.onTranscribeAndSend}
        />
      ) : (
        <form className="live-instruction-composer" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
          {props.selectionLabel ? <span className="live-selection-chip"><Sparkles size={12} /> {props.selectionLabel}</span> : null}
          <textarea
            value={props.value}
            onChange={(event) => props.onValueChange(event.target.value)}
            placeholder="Describe cómo quieres ajustar la propuesta…"
            aria-label="Instrucción para la propuesta"
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                props.onSubmit();
              }
            }}
          />
          <div className="live-composer-actions">
            {props.voiceAvailable ? <button type="button" className="live-voice-button" onClick={props.onToggleVoice} aria-label="Dar instrucción por voz"><Mic size={15} /></button> : null}
            <button type="submit" className="live-send-instruction" disabled={!props.value.trim() || props.busy}>
              {props.busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
              {props.busy ? "Actualizando" : "Enviar instrucción"}
            </button>
          </div>
        </form>
      )}

      {props.voiceHint ? (
        <div className="live-voice-hint" role="status" aria-live="polite">
          <span>{props.voiceHint}</span>
          {props.voiceHintActionLabel ? (
            <button type="button" onClick={props.onToggleVoice}>
              <Mic size={14} /> {props.voiceHintActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="live-session-actions">
        <span>{props.iterationCount ? `${props.iterationCount} ${props.iterationCount === 1 ? "iteración" : "iteraciones"}` : "Esperando indicaciones"}</span>
        <button type="button" disabled={!props.canUndo || props.busy} onClick={props.onUndo}><RotateCcw size={14} /> Deshacer</button>
        <button type="button" disabled={!props.canDiscard || props.busy} onClick={props.onDiscard}><Trash2 size={14} /> Descartar propuesta</button>
        {!props.projectLinked ? (
          <button type="button" className="live-link-project" onClick={props.onLinkProject}><Link2 size={14} /> Vincular proyecto</button>
        ) : (
          <button type="button" className="live-approve-develop" disabled={!props.canDevelop || props.busy} onClick={props.onApproveAndDevelop}>
            {props.busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
            Aprobar y desarrollar
          </button>
        )}
        <button type="button" className="live-exit-button" onClick={props.onExit}><X size={14} /> Salir de Live</button>
      </div>
    </section>
  );
}
