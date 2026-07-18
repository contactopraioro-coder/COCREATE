import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FileDiff,
  LoaderCircle,
  ShieldCheck,
  TerminalSquare
} from "lucide-react";
import { useState } from "react";
import type { ApprovalState } from "../../app/services/approval-runtime-service.js";
import type { WorkspaceExperienceState } from "../../app/services/workspace-experience-service.js";

type Props = {
  state: WorkspaceExperienceState;
  approval: ApprovalState;
  onApprovalResponse: (decision: "approve" | "reject") => Promise<boolean>;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)
    : "";
}

function PlanStatusIcon({ status }: { status: "completed" | "running" | "pending" }) {
  if (status === "completed") return <BadgeCheck size={14} />;
  if (status === "running") return <Circle className="plan-running-dot" size={12} />;
  return <Circle size={12} />;
}

export function WorkspaceWorkPanel({ state, approval, onApprovalResponse }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null);
  // Preserve upstream diagnostics for observability without rendering them in the workspace.
  void state.activities;
  void state.capabilities;
  const pendingApproval = approval.pending &&
    (!approval.pending.threadId || !state.thread.id || approval.pending.threadId === state.thread.id) &&
    (!approval.pending.turnId || !state.turn.id || approval.pending.turnId === state.turn.id)
    ? approval.pending
    : null;
  const hasLiveDetail = Boolean(
    state.activeWork.active ||
    state.plan?.steps.length ||
    state.command ||
    state.tool ||
    pendingApproval ||
    state.approval?.active ||
    state.restoration.status === "interrupted" ||
    approval.result === "error" ||
    approval.result === "expired"
  );

  if (!hasLiveDetail) return null;

  return (
    <aside className="workspace-work-panel workspace-work-panel-live" aria-label="Progreso de la tarea">
      <button type="button" className="work-panel-summary" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
        <span className={`work-state-icon state-${state.activeWork.id}`} aria-hidden="true">
          {state.activeWork.active ? <LoaderCircle className="spin" size={15} /> : <BadgeCheck size={15} />}
        </span>
        <span className="work-panel-title">
          <strong>{state.activeWork.active ? state.activeWork.label : "Requiere atención"}</strong>
          <small>{pendingApproval ? "Esperando tu aprobación" : state.command?.label ?? state.tool?.label ?? ""}</small>
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {expanded ? (
        <div className="work-panel-body" aria-live="polite">
          {state.restoration.status === "interrupted" ? (
            <div className="interrupted-work-state">
              <Clock3 size={15} />
              <span><strong>La tarea anterior se interrumpió</strong><small>Puedes revisar el último cambio o continuar con un nuevo mensaje.</small></span>
            </div>
          ) : null}

          {state.plan?.steps.length ? (
            <section className="work-section work-plan-section" aria-label="Plan de trabajo">
              <div className="work-section-title"><span>Plan</span><small>{state.plan.steps.filter((step) => step.status === "completed").length}/{state.plan.steps.length}</small></div>
              <div className="work-plan-steps">
                {state.plan.steps.map((step) => (
                  <div key={step.id} className={`work-plan-step ${step.status}`}>
                    <PlanStatusIcon status={step.status} />
                    <span>{step.text}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {state.command || state.tool ? (
            <section className="work-section" aria-label="Progreso de herramientas">
              <div className="command-tool-list">
                {state.command ? (
                  <article>
                    <TerminalSquare size={15} />
                    <span><strong>{state.command.label}</strong><small>{state.command.status}</small></span>
                  </article>
                ) : null}
                {state.tool ? (
                  <article>
                    <ShieldCheck size={15} />
                    <span><strong>{state.tool.label}</strong><small>{state.tool.status}</small></span>
                  </article>
                ) : null}
              </div>
            </section>
          ) : null}

          {pendingApproval ? (
            <section className="approval-card" aria-labelledby="approval-title">
              <div className="approval-card-heading">
                <ShieldCheck size={17} />
                <span><strong id="approval-title">CoCreate necesita tu aprobación</strong><small>{pendingApproval.category}</small></span>
              </div>
              <code>{pendingApproval.action}</code>
              <p>{pendingApproval.risk}</p>
              {pendingApproval.reason ? <small>{pendingApproval.reason}</small> : null}
              <div className="approval-actions">
                <button type="button" className="approve" disabled={approval.responding} onClick={() => void onApprovalResponse("approve")}>Aprobar una vez</button>
                <button type="button" disabled={approval.responding} onClick={() => void onApprovalResponse("reject")}>Cancelar</button>
              </div>
              {approval.error ? <div className="approval-error" role="alert">{approval.error}</div> : null}
            </section>
          ) : state.approval?.active ? (
            <div className="approval-card approval-awaiting"><LoaderCircle className="spin" size={15} /> Preparando una solicitud de aprobación...</div>
          ) : null}

          {!pendingApproval && (approval.result === "error" || approval.result === "expired") ? (
            <div className="approval-result result-error" role="alert">
              {approval.error ?? "La aprobación expiró. Intenta nuevamente cuando estés listo."}
            </div>
          ) : null}

          {state.activeWork.active && state.artifacts.length ? (
            <section className="work-section" aria-label="Cambios recientes">
              <div className="work-section-title"><span>Cambios</span><small>{state.artifacts.length}</small></div>
              <div className="artifact-list">
                {state.artifacts.slice(0, 3).map((artifact) => {
                  const isOpen = expandedArtifact === artifact.id;
                  return (
                    <article key={artifact.id} className="artifact-card">
                      <button type="button" aria-expanded={isOpen} onClick={() => setExpandedArtifact(isOpen ? null : artifact.id)}>
                        <FileDiff size={15} />
                        <span><strong>{artifact.title}</strong><small>{formatTimestamp(artifact.timestamp)}</small></span>
                        <span className="artifact-stats">{artifact.additions !== null ? `+${artifact.additions}` : ""}{artifact.deletions !== null ? ` / -${artifact.deletions}` : ""}</span>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      {isOpen ? <div className="artifact-detail">{artifact.files.length ? <ul>{artifact.files.map((file) => <li key={file}>{file}</li>)}</ul> : null}{artifact.preview ? <pre>{artifact.preview}</pre> : null}</div> : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
