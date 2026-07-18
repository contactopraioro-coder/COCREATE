import {
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileCode2,
  FolderSearch2,
  PackageOpen,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { useState } from "react";
import type { ApprovalRequest } from "../../app/services/approval-runtime-service.js";
import type { LiveSessionSnapshot, WorkingChange } from "../../app/services/live-coding-session-service.js";
import { LiveDiffViewer } from "./LiveDiffViewer";

type Props = {
  session: LiveSessionSnapshot;
  collapsed: boolean;
  responding: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onApprovalResponse: (request: ApprovalRequest, decision: "approve" | "reject") => void;
};

const changeStatusLabels: Record<WorkingChange["status"], string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  discarded: "Descartado",
  applied: "Aplicado",
  recorded: "Registrado"
};

export function LiveActivityPanel({ session, collapsed, responding, onCollapsedChange, onApprovalResponse }: Props) {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const selectedArtifact = session.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
  const nonFileApproval = session.approvals.find((approval) => !/file|archivo/i.test(`${approval.category} ${approval.action}`));

  if (collapsed) {
    return (
      <aside className="live-activity-panel collapsed" aria-label="Actividad Live">
        <button type="button" aria-label="Abrir actividad" onClick={() => onCollapsedChange(false)}><PanelRightOpen size={17} /></button>
        <span>{session.workingChanges.filter((change) => change.status === "pending").length}</span>
      </aside>
    );
  }

  return (
    <aside className="live-activity-panel" aria-label="Actividad Live">
      <header className="live-panel-heading">
        <span><strong>Actividad</strong><small>{session.modifiedFiles.length} archivos · {session.artifacts.length} artifacts</small></span>
        <button type="button" aria-label="Cerrar actividad" onClick={() => onCollapsedChange(true)}><PanelRightClose size={16} /></button>
      </header>

      <div className="live-panel-scroll">
        {selectedArtifact ? (
          <div className="live-artifact-detail">
            <button type="button" className="live-panel-back" onClick={() => setSelectedArtifactId(null)}><ChevronLeft size={14} /> Volver a actividad</button>
            <LiveDiffViewer artifact={selectedArtifact} />
          </div>
        ) : (
          <>
            <section className="live-panel-section" aria-labelledby="working-changes-title">
              <div className="live-panel-section-title"><span><FileCheck2 size={14} /><strong id="working-changes-title">Working Changes</strong></span><small>{session.workingChanges.length}</small></div>
              {session.workingChanges.length ? session.workingChanges.map((change) => {
                const request = change.approvalId ? session.approvals.find((approval) => approval.approvalId === change.approvalId) : null;
                return (
                  <article key={change.id} className={`live-change-card status-${change.status}`}>
                    <button type="button" className="live-change-summary" disabled={!change.artifactId} onClick={() => change.artifactId && setSelectedArtifactId(change.artifactId)}>
                      <FileCode2 size={14} />
                      <span><strong>{change.title}</strong><small>{change.files.length ? change.files.join(" · ") : "Esperando preview"}</small></span>
                      <span className="change-status">{changeStatusLabels[change.status]}</span>
                      {change.artifactId ? <ChevronRight size={13} /> : null}
                    </button>
                    <div className="live-change-stats">
                      {change.additions !== null ? <b>+{change.additions}</b> : null}
                      {change.deletions !== null ? <i>-{change.deletions}</i> : null}
                    </div>
                    {change.actionable && request ? (
                      <>
                        {!change.reviewable ? <p className="live-change-warning">Codex no publicó un preview. Puedes descartar la propuesta, pero no aprobarla a ciegas.</p> : null}
                        <div className="live-change-actions">
                          <button type="button" className="approve" disabled={responding || !change.reviewable} title={!change.reviewable ? "Se necesita un preview antes de aprobar" : undefined} onClick={() => onApprovalResponse(request, "approve")}>Aprobar cambios</button>
                          <button type="button" disabled={responding} onClick={() => onApprovalResponse(request, "reject")}>Descartar</button>
                        </div>
                      </>
                    ) : null}
                  </article>
                );
              }) : <p className="live-panel-empty">Los cambios propuestos aparecerán aquí antes de aplicarse.</p>}
            </section>

            {nonFileApproval ? (
              <section className="live-panel-section" aria-labelledby="approval-live-title">
                <div className="live-panel-section-title"><span><ShieldCheck size={14} /><strong id="approval-live-title">Aprobación</strong></span></div>
                <article className="live-command-approval">
                  <strong>{nonFileApproval.action}</strong>
                  <p>{nonFileApproval.risk}</p>
                  <div className="live-change-actions">
                    <button type="button" className="approve" disabled={responding} onClick={() => onApprovalResponse(nonFileApproval, "approve")}>Aprobar una vez</button>
                    <button type="button" disabled={responding} onClick={() => onApprovalResponse(nonFileApproval, "reject")}>Cancelar</button>
                  </div>
                </article>
              </section>
            ) : null}

            <section className="live-panel-section" aria-labelledby="modified-files-title">
              <div className="live-panel-section-title"><span><FileCode2 size={14} /><strong id="modified-files-title">Archivos modificados</strong></span><small>{session.modifiedFiles.length}</small></div>
              {session.modifiedFiles.length ? <ul className="live-file-list">{session.modifiedFiles.map((file) => <li key={file}>{file}</li>)}</ul> : <p className="live-panel-empty">Todavía no hay archivos modificados.</p>}
            </section>

            <section className="live-panel-section" aria-labelledby="opened-files-title">
              <div className="live-panel-section-title"><span><FolderSearch2 size={14} /><strong id="opened-files-title">Archivos abiertos</strong></span><small>{session.openedFiles.length}</small></div>
              {session.openedFiles.length ? <ul className="live-file-list">{session.openedFiles.map((file) => <li key={file}>{file}</li>)}</ul> : <p className="live-panel-empty">Aparecerán cuando Codex publique rutas de lectura.</p>}
            </section>

            <section className="live-panel-section" aria-labelledby="artifacts-title">
              <div className="live-panel-section-title"><span><PackageOpen size={14} /><strong id="artifacts-title">Artifacts</strong></span><small>{session.artifacts.length}</small></div>
              {session.artifacts.length ? <div className="live-artifact-list">{session.artifacts.map((artifact) => (
                <button key={artifact.id} type="button" onClick={() => setSelectedArtifactId(artifact.id)}><span><strong>{artifact.title}</strong><small>{artifact.files[0] ?? artifact.type}</small></span><ChevronRight size={13} /></button>
              ))}</div> : <p className="live-panel-empty">Los resultados de la sesión aparecerán aquí.</p>}
            </section>

            <section className="live-panel-section" aria-labelledby="tools-title">
              <div className="live-panel-section-title"><span><Wrench size={14} /><strong id="tools-title">Herramientas</strong></span><small>{session.tools.length}</small></div>
              {session.tools.length ? <ul className="live-tool-list">{session.tools.map((tool) => <li key={tool.id}><span>{tool.label}</span><small>{tool.status}</small></li>)}</ul> : <p className="live-panel-empty">Sin herramientas en uso.</p>}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
