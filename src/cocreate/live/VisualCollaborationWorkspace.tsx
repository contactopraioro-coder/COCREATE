import {
  ArrowRight,
  Circle,
  Focus,
  Fullscreen,
  Layers3,
  Maximize2,
  Monitor,
  MousePointer2,
  RectangleHorizontal,
  Sparkles,
  Type,
  Undo2
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type {
  VisualAnnotation,
  VisualBounds,
  VisualCollaborationSnapshot,
  VisualComparisonMode,
  VisualPoint,
  VisualTool
} from "../../app/services/visual-collaboration-service.js";
import type { ProposalRuntimeSnapshot } from "../../app/services/proposal-runtime-service.js";
import type { ScreenSharePreference, ScreenSharingSnapshot } from "../../app/services/screen-sharing-service.js";
import type { VoiceSnapshot } from "../../app/services/voice-service.js";
import { LiveInteractionControls, type LiveComposerStage } from "./LiveInteractionControls";
import { LiveShareChooser } from "./LiveShareChooser";
import { VisualPreviewPanel } from "./VisualPreviewPanel";
import { VisualProposalPanel } from "./VisualProposalPanel";

type Props = {
  snapshot: VisualCollaborationSnapshot;
  proposalRuntime: ProposalRuntimeSnapshot;
  screen: ScreenSharingSnapshot;
  stream: MediaStream | null;
  environment: "desktop" | "web";
  projectLinked: boolean;
  voice: VoiceSnapshot;
  voiceElapsedSeconds: number;
  voiceAvailable: boolean;
  voiceHint: string | null;
  voiceHintActionLabel?: string;
  liveStage: LiveComposerStage;
  liveIntentSummary: string[];
  liveWorkingNotes: string[];
  liveObservedElements: string[];
  liveStatusFeed: ReadonlyArray<{ label: string; state: "pending" | "active" | "done" }>;
  liveConfidence: {
    score: number;
    level: "exploring" | "aligned" | "ready";
    rationale: string;
    nextAction: string;
  };
  liveExecutionSuggestions: string[];
  liveTranscriptPreview: string | null;
  instruction: string;
  instructionBusy: boolean;
  onInstructionChange: (value: string) => void;
  onSubmitInstruction: () => void;
  onToggleVoice: () => void;
  onCancelVoice: () => void;
  onStopVoice: () => void;
  onTranscribeAndSend: () => void;
  onShare: (preference: ScreenSharePreference) => void;
  onChangeShare: () => void;
  onStopShare: () => void;
  onTogglePause: () => void;
  onOpenPermissionSettings: () => void;
  onPreviewUrl: (url: string) => { ok: boolean; error?: string };
  onUseProjectPreview: () => void;
  onComparisonMode: (mode: VisualComparisonMode) => void;
  onTool: (tool: VisualTool) => void;
  onHover: (bounds: VisualBounds | null) => void;
  onSelect: (bounds: VisualBounds) => void;
  onMovePointer: (point: VisualPoint | null) => void;
  onAddAnnotation: (kind: VisualAnnotation["kind"], start: VisualPoint, end: VisualPoint) => void;
  onClearAnnotations: () => void;
  onRenameSelection: (label: string) => void;
  onClearSelection: () => void;
  onProposalSelect: (proposalId: string) => void;
  onProposalPreviewStart: (proposalId: string) => void;
  onProposalPreviewStop: (proposalId: string) => void;
  onProposalPreviewRestart: (proposalId: string) => void;
  onProposalPreviewRefresh: (proposalId: string) => void;
  onUndoProposal: () => void;
  onDiscardProposal: () => void;
  onApproveAndDevelop: () => void;
  onLinkProject: () => void;
  onExit: (decision: "keep" | "discard") => void;
};

const tools: Array<{ id: VisualTool; label: string; icon: typeof MousePointer2 }> = [
  { id: "interact", label: "Navegar", icon: MousePointer2 },
  { id: "select", label: "Seleccionar", icon: Focus },
  { id: "pointer", label: "Señalar", icon: Type },
  { id: "arrow", label: "Flecha", icon: ArrowRight },
  { id: "circle", label: "Círculo", icon: Circle },
  { id: "rectangle", label: "Rectángulo", icon: RectangleHorizontal }
];

const comparisonModes: Array<{ id: VisualComparisonMode; label: string; icon: typeof Monitor }> = [
  { id: "current", label: "Current", icon: Monitor },
  { id: "proposal", label: "Proposal", icon: Sparkles },
  { id: "split", label: "Split", icon: Layers3 },
  { id: "overlay", label: "Overlay", icon: Fullscreen }
];

export function VisualCollaborationWorkspace(props: Props) {
  const { snapshot, proposalRuntime, screen } = props;
  const [sourceChosen, setSourceChosen] = useState(false);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [splitPercent, setSplitPercent] = useState(52);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const resizeRef = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (screen.surface) setSourceChosen(true);
  }, [screen.surface]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (compact && snapshot.comparisonMode === "split") props.onComparisonMode("current");
  }, [compact, props.onComparisonMode, snapshot.comparisonMode]);

  const hasCurrent = sourceChosen && Boolean(screen.surface || snapshot.preview.url);
  const activeProposal = proposalRuntime.proposals.find((entry) => entry.id === proposalRuntime.activeId) ?? proposalRuntime.proposals[proposalRuntime.proposals.length - 1] ?? null;
  const activeConceptualProposal = snapshot.proposals.find((entry) => entry.id === snapshot.activeProposalId) ?? snapshot.proposals[snapshot.proposals.length - 1] ?? null;
  const proposalCount = Math.max(proposalRuntime.proposals.length, snapshot.proposals.length);
  const proposalReady = activeProposal?.status === "ready" || activeProposal?.status === "approved" || activeConceptualProposal?.status === "available";

  const share = (preference: ScreenSharePreference) => {
    props.onShare(preference);
  };

  const usePreview = () => {
    setSourceChosen(true);
    props.onUseProjectPreview();
  };

  const openUrl = (url: string) => {
    const result = props.onPreviewUrl(url);
    if (result.ok) setSourceChosen(true);
    return result;
  };

  const moveDivider = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const percent = ((event.clientX - bounds.left) / bounds.width) * 100;
    setSplitPercent(Math.min(72, Math.max(28, percent)));
  };

  return (
    <section ref={workspaceRef} className="live-conversation-workspace" aria-label="Live Coding">
      <header className="live-workspace-header">
        <div className="live-workspace-title">
          <span className={screen.surface ? "live-sharing-dot active" : "live-sharing-dot"} />
          <span><strong>Live Coding</strong><small>{screen.surface?.label ?? (hasCurrent ? snapshot.preview.title : "Elige qué quieres mostrar")}</small></span>
        </div>
        <div className="live-header-actions">
          {screen.surface ? <button type="button" className="live-change-share-button" onClick={props.onChangeShare}>Cambiar pantalla</button> : null}
          {hasCurrent ? <button type="button" aria-label="Pantalla completa" title="Pantalla completa" onClick={() => void workspaceRef.current?.requestFullscreen?.()}><Maximize2 size={15} /></button> : null}
          <button type="button" onClick={() => setExitPromptOpen(true)}>Salir de Live</button>
        </div>
      </header>

      {!hasCurrent ? (
        <LiveShareChooser
          screen={screen}
          projectPreviewAvailable={Boolean(snapshot.preview.url)}
          onShare={() => share("screen")}
          onUseProjectPreview={usePreview}
          onOpenUrl={openUrl}
          onOpenPermissionSettings={props.onOpenPermissionSettings}
        />
      ) : (
        <>
          <div className="live-visual-toolbar">
            <div className="visual-tools" aria-label="Herramientas visuales">
              {tools.map((tool) => {
                const Icon = tool.icon;
                return <button key={tool.id} type="button" className={snapshot.tool === tool.id ? "active" : ""} aria-pressed={snapshot.tool === tool.id} title={tool.label} onClick={() => props.onTool(tool.id)}><Icon size={14} /><span>{tool.label}</span></button>;
              })}
              {snapshot.annotations.length ? <button type="button" title="Borrar anotaciones" onClick={props.onClearAnnotations}><Undo2 size={14} /><span>Limpiar</span></button> : null}
            </div>
            <div className="visual-comparison-switch" aria-label="Comparar vistas">
              {comparisonModes.filter((mode) => !compact || mode.id === "current" || mode.id === "proposal").map((mode) => {
                const Icon = mode.icon;
                return <button key={mode.id} type="button" className={snapshot.comparisonMode === mode.id ? "active" : ""} onClick={() => props.onComparisonMode(mode.id)}><Icon size={13} /> {mode.label}</button>;
              })}
            </div>
          </div>

          <div
            className={`visual-comparison-canvas live-canvas mode-${snapshot.comparisonMode}`}
            style={{ "--live-current-size": `${splitPercent}%` } as CSSProperties}
            onPointerMove={moveDivider}
            onPointerUp={() => { resizeRef.current = false; }}
            onPointerCancel={() => { resizeRef.current = false; }}
          >
            {snapshot.comparisonMode !== "proposal" ? (
              <VisualPreviewPanel
                snapshot={snapshot}
                stream={props.stream}
                sharingPaused={screen.status === "paused"}
                surfaceLabel={screen.surface?.label ?? null}
                observedElements={props.liveObservedElements}
                onTogglePause={props.onTogglePause}
                onStopSharing={() => { setSourceChosen(Boolean(snapshot.preview.url)); props.onStopShare(); }}
                onHover={props.onHover}
                onSelect={props.onSelect}
                onMovePointer={props.onMovePointer}
                onAddAnnotation={props.onAddAnnotation}
                onRenameSelection={props.onRenameSelection}
                onClearSelection={props.onClearSelection}
              />
            ) : null}
            {snapshot.comparisonMode === "split" ? (
              <div
                className="live-split-divider"
                role="separator"
                aria-label="Cambiar tamaño entre Current y Proposal"
                aria-orientation="vertical"
                aria-valuemin={28}
                aria-valuemax={72}
                aria-valuenow={Math.round(splitPercent)}
                tabIndex={0}
                onPointerDown={(event) => { resizeRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") setSplitPercent((current) => Math.max(28, current - 3));
                  if (event.key === "ArrowRight") setSplitPercent((current) => Math.min(72, current + 3));
                }}
              />
            ) : null}
            {snapshot.comparisonMode !== "current" ? (
              <VisualProposalPanel
                runtime={proposalRuntime}
                conceptualProposal={activeConceptualProposal}
                projectLinked={props.projectLinked}
                overlay={snapshot.comparisonMode === "overlay"}
                liveStage={props.liveStage}
                liveIntentSummary={props.liveIntentSummary}
                liveWorkingNotes={props.liveWorkingNotes}
                liveObservedElements={props.liveObservedElements}
                liveStatusFeed={props.liveStatusFeed}
                liveConfidence={props.liveConfidence}
                liveExecutionSuggestions={props.liveExecutionSuggestions}
                liveTranscriptPreview={props.liveTranscriptPreview}
                onSelect={props.onProposalSelect}
                onStartPreview={props.onProposalPreviewStart}
                onStopPreview={props.onProposalPreviewStop}
                onRestartPreview={props.onProposalPreviewRestart}
                onRefreshPreview={props.onProposalPreviewRefresh}
              />
            ) : null}
          </div>

          <LiveInteractionControls
            value={props.instruction}
            selectionLabel={snapshot.selection?.label ?? null}
            iterationCount={proposalCount}
            busy={props.instructionBusy || Boolean(proposalRuntime.busyAction)}
            canUndo={proposalCount > 1}
            canDiscard={proposalCount > 0}
            canDevelop={Boolean(activeProposal && proposalReady)}
            projectLinked={props.projectLinked}
            voice={props.voice}
            voiceElapsedSeconds={props.voiceElapsedSeconds}
            voiceAvailable={props.voiceAvailable}
            voiceHint={props.voiceHint}
            voiceHintActionLabel={props.voiceHintActionLabel}
            stage={props.liveStage}
            transcriptPreview={props.liveTranscriptPreview}
            onValueChange={props.onInstructionChange}
            onSubmit={props.onSubmitInstruction}
            onToggleVoice={props.onToggleVoice}
            onCancelVoice={props.onCancelVoice}
            onStopVoice={props.onStopVoice}
            onTranscribeAndSend={props.onTranscribeAndSend}
            onUndo={props.onUndoProposal}
            onDiscard={props.onDiscardProposal}
            onApproveAndDevelop={props.onApproveAndDevelop}
            onLinkProject={props.onLinkProject}
            onExit={() => setExitPromptOpen(true)}
          />
        </>
      )}

      {exitPromptOpen ? (
        <div className="live-exit-dialog-backdrop" role="presentation">
          <section className="live-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="live-exit-title">
            <h2 id="live-exit-title">¿Quieres conservar esta propuesta?</h2>
            <p>Puedes volver más tarde sin desarrollar nada, o descartar las iteraciones de esta sesión.</p>
            <div>
              <button type="button" onClick={() => setExitPromptOpen(false)}>Seguir en Live</button>
              <button type="button" onClick={() => { setExitPromptOpen(false); props.onExit("discard"); }}>Descartar</button>
              <button type="button" className="primary" onClick={() => { setExitPromptOpen(false); props.onExit("keep"); }}>Conservar borrador</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
