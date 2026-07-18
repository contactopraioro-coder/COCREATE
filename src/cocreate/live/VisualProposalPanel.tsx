import {
  BadgeCheck,
  CircleAlert,
  CircleOff,
  Clock3,
  FileCode2,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square
} from "lucide-react";
import type { ProposalRecord, ProposalRuntimeSnapshot } from "../../app/services/proposal-runtime-service.js";
import type { VisualProposal } from "../../app/services/visual-collaboration-service.js";
import type { LiveComposerStage } from "./LiveInteractionControls";

type Props = {
  runtime: ProposalRuntimeSnapshot;
  conceptualProposal: VisualProposal | null;
  projectLinked: boolean;
  overlay?: boolean;
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
  onSelect: (proposalId: string) => void;
  onStartPreview: (proposalId: string) => void;
  onStopPreview: (proposalId: string) => void;
  onRestartPreview: (proposalId: string) => void;
  onRefreshPreview: (proposalId: string) => void;
};

const statusLabels: Record<ProposalRecord["status"], string> = {
  draft: "Esperando indicaciones",
  preparing: "Preparando propuesta",
  applying: "Actualizando propuesta",
  running: "Preparando propuesta",
  ready: "Propuesta lista",
  failed: "No se pudo generar",
  rejected: "Propuesta descartada",
  approved: "Propuesta aprobada",
  applied: "Desarrollo completado",
  destroyed: "Propuesta descartada"
};

function StatusIcon({ proposal }: { proposal: ProposalRecord }) {
  if (["preparing", "applying", "running"].includes(proposal.status)) return <LoaderCircle className="spin" size={15} />;
  if (proposal.status === "failed") return <CircleAlert size={15} />;
  if (["rejected", "destroyed"].includes(proposal.status)) return <CircleOff size={15} />;
  if (["approved", "applied"].includes(proposal.status)) return <BadgeCheck size={15} />;
  return <Sparkles size={15} />;
}

function ProposalPreview({ proposal, busy, actions }: {
  proposal: ProposalRecord;
  busy: boolean;
  actions: Pick<Props, "onStartPreview" | "onStopPreview" | "onRestartPreview" | "onRefreshPreview">;
}) {
  if (proposal.preview.status === "ready" && proposal.preview.url) {
    return (
      <div className="proposal-live-preview">
        <iframe
          key={`${proposal.id}:${proposal.preview.refreshToken}`}
          src={proposal.preview.url}
          title={`Propuesta ${proposal.sequence}`}
          sandbox="allow-forms allow-modals allow-popups allow-scripts"
          referrerPolicy="no-referrer"
        />
        <div className="proposal-preview-controls">
          <span><i /> Propuesta lista</span>
          <button type="button" disabled={busy} title="Refrescar" onClick={() => actions.onRefreshPreview(proposal.id)}><RefreshCw size={13} /></button>
          <button type="button" disabled={busy} title="Reiniciar" onClick={() => actions.onRestartPreview(proposal.id)}><RotateCcw size={13} /></button>
          <button type="button" disabled={busy} title="Detener" onClick={() => actions.onStopPreview(proposal.id)}><Square size={11} fill="currentColor" /></button>
        </div>
      </div>
    );
  }

  if (["preparing", "applying", "running"].includes(proposal.status) || proposal.preview.status === "starting") {
    return <div className="visual-proposal-empty generating"><LoaderCircle className="spin" size={24} /><strong>Actualizando propuesta</strong><p>CoCreate está trabajando únicamente dentro de la copia aislada.</p></div>;
  }

  if (proposal.status === "failed" || proposal.preview.status === "failed") {
    return <div className="visual-proposal-empty proposal-failed"><CircleAlert size={24} /><strong>No se pudo generar</strong><p>{proposal.errors[proposal.errors.length - 1] ?? proposal.preview.error ?? "La propuesta no produjo una vista verificable."}</p></div>;
  }

  if (proposal.status === "ready" && proposal.preview.status === "stopped") {
    return <div className="visual-proposal-empty"><Play size={22} /><strong>Propuesta lista</strong><p>La vista está detenida. Puedes iniciarla de nuevo sin modificar el proyecto.</p><button type="button" disabled={busy} onClick={() => actions.onStartPreview(proposal.id)}><Play size={13} /> Ver propuesta</button></div>;
  }

  return <div className="visual-proposal-empty generating"><LoaderCircle className="spin" size={23} /><strong>Preparando propuesta</strong><p>La vista aparecerá cuando la iteración produzca un resultado real.</p></div>;
}

function ProposalDetails({ proposal }: { proposal: ProposalRecord }) {
  const validationPassed = proposal.validation?.status === "passed";
  return (
    <div className="proposal-review-drawer">
      <p className="proposal-runtime-target">Instrucción: <strong>{proposal.instruction}</strong>{proposal.selectionLabel ? ` · ${proposal.selectionLabel}` : ""}</p>
      {proposal.diff ? (
        <>
          <div className="proposal-change-summary"><span><FileCode2 size={12} /> {proposal.diff.files.length} archivo{proposal.diff.files.length === 1 ? "" : "s"}</span><b>+{proposal.diff.additions}</b><i>-{proposal.diff.deletions}</i><small>{proposal.diff.files.slice(0, 3).join(" · ")}</small></div>
          <details className="proposal-diff"><summary>Revisar cambios</summary><pre>{proposal.diff.preview}</pre></details>
        </>
      ) : null}
      {proposal.validation ? (
        <div className="proposal-validation" aria-label="Validaciones de la propuesta">
          {proposal.validation.checks.map((check) => <span key={check.id} className={check.status === "passed" ? "passed" : check.status === "skipped" ? "skipped" : "failed"}><i>{check.status === "passed" ? "✓" : check.status === "skipped" ? "·" : "!"}</i>{check.label}</span>)}
          {validationPassed ? <span className="passed"><i>✓</i> Lista para desarrollar</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ConceptualProposal({ proposal, projectLinked }: { proposal: VisualProposal; projectLinked: boolean }) {
  const generating = proposal.status === "generating";
  return (
    <div className="visual-proposal-body">
      <div className={`visual-proposal-card status-${proposal.status}`}>
        <span className="visual-proposal-status">{generating ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{generating ? "Actualizando propuesta" : "Propuesta conceptual lista"}</span>
        <h3>{proposal.instruction}</h3>
        {proposal.selectionLabel ? <p className="visual-proposal-target">Sobre {proposal.selectionLabel}</p> : null}
        <p className="visual-proposal-summary">{proposal.summary || "CoCreate está preparando una interpretación visual de tu instrucción."}</p>
        {!projectLinked ? <small className="visual-proposal-safety">Vincula un proyecto para desarrollar esta propuesta sobre código real.</small> : null}
      </div>
    </div>
  );
}

function LiveStageCard({ stage, lines, workingNotes, observedElements, statusFeed, confidence, executionSuggestions, transcript, projectLinked }: {
  stage: LiveComposerStage;
  lines: string[];
  workingNotes: string[];
  observedElements: string[];
  statusFeed: ReadonlyArray<{ label: string; state: "pending" | "active" | "done" }>;
  confidence: Props["liveConfidence"];
  executionSuggestions: string[];
  transcript: string | null;
  projectLinked: boolean;
}) {
  const title = stage === "listening"
    ? "Escuchando..."
    : stage === "observing"
      ? "Observando la interfaz..."
    : stage === "transcribing"
      ? "Transcribiendo..."
      : stage === "understanding"
        ? "Entendiendo tu solicitud"
        : stage === "planning"
          ? "Preparando propuesta..."
          : stage === "updating"
            ? "Actualizando la propuesta..."
            : stage === "error"
              ? "La propuesta necesita otra indicación"
              : "Esperando indicaciones";

  const copy = stage === "listening"
    ? "CoCreate ya está dentro de la sesión Live. Puedes describir el cambio inmediatamente."
    : stage === "observing"
      ? "Mientras hablas, Live está tomando referencias visibles de la interfaz para acotar mejor la propuesta."
    : stage === "transcribing"
      ? "Estamos convirtiendo tu voz en una instrucción útil para la siguiente iteración."
      : stage === "understanding"
        ? "Esto es lo que CoCreate está interpretando hasta ahora."
        : stage === "planning"
          ? "La intención ya está clara y estamos armando la siguiente revisión."
          : stage === "updating"
            ? "Proposal está aplicando la instrucción sin tocar tu Current."
            : stage === "error"
              ? "Puedes seguir por texto o volver a activar el micrófono cuando quieras."
              : "Habla, escribe o selecciona una zona. Current permanecerá intacto mientras iteramos.";

  return (
    <div className={`visual-proposal-empty live-stage-card stage-${stage}`}>
      {stage === "error" ? <CircleAlert size={22} /> : stage === "idle" ? <Sparkles size={22} /> : <LoaderCircle className={stage === "ready" ? "" : "spin"} size={22} />}
      <strong>{title}</strong>
      <p>{copy}</p>
      <div className="live-status-feed" aria-label="Estado interno de Live">
        {statusFeed.map((item) => <span key={item.label} className={`state-${item.state}`}>{item.label}</span>)}
      </div>
      <section className={`live-doc-section confidence-${confidence.level}`} aria-labelledby="live-confidence-title">
        <h3 id="live-confidence-title">Nivel de confianza</h3>
        <div className="live-confidence-summary">
          <strong>{confidence.level === "ready" ? "Lista para actuar" : confidence.level === "aligned" ? "Problema entendido" : "Explorando el problema"}</strong>
          <span>{Math.round(confidence.score * 100)}%</span>
        </div>
        <p>{confidence.rationale}</p>
        <small>Siguiente paso natural: {confidence.nextAction}</small>
      </section>
      {observedElements.length ? (
        <section className="live-doc-section" aria-labelledby="live-observed-title">
          <h3 id="live-observed-title">Elementos probables</h3>
          <div className="live-observed-list">
            {observedElements.map((element) => <span key={element}>{element}</span>)}
          </div>
        </section>
      ) : null}
      {lines.length ? (
        <section className="live-doc-section" aria-labelledby="live-intent-title">
          <h3 id="live-intent-title">Comprensión en progreso</h3>
          <ul className="live-intent-list" aria-label="Resumen de intención">
            {lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
          </ul>
        </section>
      ) : null}
      {workingNotes.length ? (
        <section className="live-doc-section" aria-labelledby="live-notes-title">
          <h3 id="live-notes-title">Documento vivo</h3>
          <ul className="live-intent-list" aria-label="Notas activas de propuesta">
            {workingNotes.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
          </ul>
        </section>
      ) : null}
      {executionSuggestions.length ? (
        <section className="live-doc-section" aria-labelledby="live-execution-title">
          <h3 id="live-execution-title">Transición a ejecución</h3>
          <ul className="live-intent-list" aria-label="Sugerencias de ejecución">
            {executionSuggestions.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
          </ul>
        </section>
      ) : null}
      {transcript?.trim() ? <div className="live-transcript-card"><strong>Referencia actual</strong><span>{transcript.trim()}</span></div> : null}
      {!projectLinked ? <small>Vincula un proyecto cuando quieras desarrollar la propuesta.</small> : null}
    </div>
  );
}

export function VisualProposalPanel({
  runtime,
  conceptualProposal,
  projectLinked,
  overlay = false,
  liveStage,
  liveIntentSummary,
  liveWorkingNotes,
  liveObservedElements,
  liveStatusFeed,
  liveConfidence,
  liveExecutionSuggestions,
  liveTranscriptPreview,
  ...actions
}: Props) {
  const proposal = runtime.proposals.find((entry) => entry.id === runtime.activeId) ?? runtime.proposals[runtime.proposals.length - 1] ?? null;
  const busy = Boolean(runtime.busyAction);

  return (
    <section className={`visual-proposal-panel proposal-runtime-panel${overlay ? " overlay" : ""}`} aria-label="Propuesta">
      <header className="visual-panel-heading">
        <span><strong>Propuesta</strong><small>{proposal ? `Iteración ${proposal.sequence}` : conceptualProposal ? "Vista conceptual" : "Esperando indicaciones"}</small></span>
        {proposal ? <span className={`visual-proposal-badge status-${proposal.status}`}><StatusIcon proposal={proposal} /> {statusLabels[proposal.status]}</span> : null}
      </header>

      {proposal ? (
        <>
          <div className="visual-proposal-body proposal-runtime-body"><ProposalPreview proposal={proposal} busy={busy} actions={actions} /></div>
          <ProposalDetails proposal={proposal} />
        </>
      ) : conceptualProposal ? (
        <ConceptualProposal proposal={conceptualProposal} projectLinked={projectLinked} />
      ) : (
        <div className="visual-proposal-body">
          <LiveStageCard
            stage={liveStage}
            lines={liveIntentSummary}
            workingNotes={liveWorkingNotes}
            observedElements={liveObservedElements}
            statusFeed={liveStatusFeed}
            confidence={liveConfidence}
            executionSuggestions={liveExecutionSuggestions}
            transcript={liveTranscriptPreview}
            projectLinked={projectLinked}
          />
        </div>
      )}

      {runtime.error ? <p className="proposal-runtime-error" role="alert">{runtime.error}</p> : null}
      {runtime.proposals.length ? (
        <div className="visual-proposal-history" aria-label="Historial de iteraciones">
          {runtime.proposals.slice().reverse().map((entry) => (
            <button key={entry.id} type="button" className={`${entry.id === runtime.activeId ? "active " : ""}status-${entry.status}`} onClick={() => actions.onSelect(entry.id)}>
              <span>{entry.sequence}</span>
              <div><strong>{entry.instruction}</strong><small><Clock3 size={10} /> {statusLabels[entry.status]}{entry.source === "voice" ? " · Voz" : ""}</small></div>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
