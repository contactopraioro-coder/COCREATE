import { BadgeCheck, Circle, CircleAlert, LoaderCircle, Square, TimerReset } from "lucide-react";
import type { LiveSessionSnapshot, LiveTimelineStatus } from "../../app/services/live-coding-session-service.js";
import type { ProposalRecord } from "../../app/services/proposal-runtime-service.js";

type Props = {
  session: LiveSessionSnapshot;
  proposal?: ProposalRecord | null;
  cancelling: boolean;
  onCancel: () => void;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function TimelineIcon({ status }: { status: LiveTimelineStatus }) {
  if (status === "active") return <LoaderCircle className="spin" size={14} />;
  if (status === "waiting") return <CircleAlert size={14} />;
  if (status === "failed") return <CircleAlert size={14} />;
  return <BadgeCheck size={14} />;
}

function proposalTimelineStatus(status: ProposalRecord["status"]): LiveTimelineStatus {
  if (["preparing", "applying", "running"].includes(status)) return "active";
  if (status === "failed") return "failed";
  if (status === "approved") return "waiting";
  return "completed";
}

export function LiveTimeline({ session, proposal, cancelling, onCancel }: Props) {
  const proposalItems = proposal?.timeline.slice(-6).map((item) => ({
    id: item.id,
    label: item.label,
    status: proposalTimelineStatus(item.status),
    source: proposal.source === "voice" ? "voice" : "proposal"
  })) ?? [];
  return (
    <section className={`live-session-card status-${session.status}`} aria-label="Sesión Live" aria-live="polite">
      <header className="live-session-heading">
        <div className="live-session-title">
          <span className={session.status === "running" ? "live-presence-dot active" : "live-presence-dot"} aria-hidden="true" />
          <span><strong>Live</strong><small>{session.currentAction}</small></span>
        </div>
        <div className="live-session-controls">
          <span className="live-duration"><TimerReset size={13} /> {formatDuration(session.durationMs)}</span>
          {session.canCancel ? (
            <button type="button" onClick={onCancel} disabled={cancelling}>
              {cancelling ? <LoaderCircle className="spin" size={13} /> : <Square size={12} fill="currentColor" />}
              Cancelar
            </button>
          ) : null}
        </div>
      </header>

      <div className="live-progress-track" aria-label={`Progreso ${session.progress}%`}>
        <span style={{ width: `${session.progress}%` }} />
      </div>

      <ol className="live-timeline-list">
        {session.timeline.length ? session.timeline.map((item) => (
          <li key={item.id} className={item.status}>
            <TimelineIcon status={item.status} />
            <span>{item.label}</span>
            {item.source === "voice" ? <small>Voz</small> : null}
          </li>
        )) : null}
        {proposalItems.map((item) => (
          <li key={item.id} className={item.status}>
            <TimelineIcon status={item.status} />
            <span>{item.label}</span>
            {item.source === "voice" ? <small>Voz</small> : <small>Proposal</small>}
          </li>
        ))}
        {!session.timeline.length && !proposalItems.length ? (
          <li className="ready"><Circle size={13} /><span>Describe el cambio que quieres realizar</span></li>
        ) : null}
      </ol>
    </section>
  );
}
