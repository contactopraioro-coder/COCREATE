import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleStop,
  FileCode2,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import { useState } from "react";
import type {
  ImplementationConflictResolution,
  ImplementationOperation
} from "../../app/services/implementation-runtime-service.js";

type Props = {
  operation: ImplementationOperation;
  busy: boolean;
  onCancel: () => void;
  onResolveConflict: (conflictId: string, resolution: ImplementationConflictResolution) => void;
  onRetry: () => void;
  onRollback: () => void;
  onRecover: () => void;
};

const activeStatuses = new Set(["queued", "preparing", "analyzing", "applying", "validating", "refreshing"]);

function iconFor(operation: ImplementationOperation) {
  if (operation.status === "completed") return <Check size={15} />;
  if (operation.status === "completed_with_warnings" || operation.status === "conflict") return <AlertTriangle size={15} />;
  if (operation.status === "failed") return <XCircle size={15} />;
  if (operation.status === "cancelled" || operation.status === "rolled_back") return <RotateCcw size={15} />;
  return <LoaderCircle className="spin" size={15} />;
}

function summaryFor(operation: ImplementationOperation) {
  const applied = operation.changeSet.filter((entry) => entry.applied).length;
  const skipped = operation.changeSet.filter((entry) => entry.skipped).length;
  if (operation.status === "conflict") return `${operation.conflicts.filter((entry) => !entry.resolution).length} decisión${operation.conflicts.filter((entry) => !entry.resolution).length === 1 ? "" : "es"} pendiente${operation.conflicts.filter((entry) => !entry.resolution).length === 1 ? "" : "s"}`;
  if (operation.status === "completed" || operation.status === "completed_with_warnings") return `${applied} archivo${applied === 1 ? "" : "s"} aplicado${applied === 1 ? "" : "s"}${skipped ? ` · ${skipped} conservado${skipped === 1 ? "" : "s"}` : ""}`;
  if (operation.status === "rolled_back") return "El workspace volvió al checkpoint";
  return operation.progress.label;
}

function fileKindLabel(kind: string) {
  return ({ added: "Nuevo", modified: "Modificado", deleted: "Eliminado", renamed: "Renombrado" })[kind] ?? kind;
}

export function ImplementationProgressCard({ operation, busy, onCancel, onResolveConflict, onRetry, onRollback, onRecover }: Props) {
  const [diffFilter, setDiffFilter] = useState<"all" | ImplementationOperation["changeSet"][number]["kind"]>("all");
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const unresolved = operation.conflicts.filter((conflict) => !conflict.resolution);
  const canRecheckRepository = unresolved.length > 0
    && unresolved.every((conflict) => !conflict.changeId && conflict.kind === "repository_state");
  const isActive = activeStatuses.has(operation.status);
  const canCancel = isActive || operation.status === "conflict";
  const validationChecks = operation.validationSummary.checks;
  const progress = operation.progress.total
    ? Math.min(100, Math.round((operation.progress.completed / operation.progress.total) * 100))
    : isActive ? 12 : 100;
  const filteredDiffFiles = operation.diffSummary.files.filter((file) => diffFilter === "all" || file.kind === diffFilter);
  const selectedDiff = filteredDiffFiles.find((file) => file.path === selectedDiffPath) ?? filteredDiffFiles[0] ?? null;

  return (
    <article className={`implementation-card status-${operation.status}`} aria-label="Implementación de Proposal">
      <header>
        <span className="implementation-status-icon">{iconFor(operation)}</span>
        <span>
          <strong>{operation.progress.label}</strong>
          <small>{summaryFor(operation)}</small>
        </span>
        {canCancel ? <button type="button" disabled={busy} onClick={onCancel}><CircleStop size={14} /> Cancelar</button> : null}
      </header>

      {isActive ? <div className="implementation-progress" aria-label={`Progreso ${progress}%`}><span style={{ width: `${progress}%` }} /></div> : null}

      <p className="implementation-approved-scope">
        <ShieldAlert size={13} />
        <span><strong>Cambio aprobado</strong>{operation.approvedRevision.instruction}</span>
      </p>

      {operation.recoveryRequired ? (
        <div className="implementation-recovery">
          <span>CoCreate se reinició durante esta operación. Revisaré el checkpoint antes de continuar.</span>
          <button type="button" disabled={busy} onClick={onRecover}>Revisar y recuperar</button>
        </div>
      ) : null}

      {operation.status === "conflict" ? (
        <section className="implementation-conflicts" aria-label="Conflictos de implementación">
          <h3>Encontré cambios que se cruzan con la propuesta</h3>
          {unresolved.map((conflict) => (
            <div key={conflict.id} className={`implementation-conflict severity-${conflict.severity}`}>
              <span><FileCode2 size={14} /></span>
              <div>
                <strong>{conflict.path}</strong>
                <p>{conflict.risk}</p>
                <small>{conflict.recommendation}</small>
                {conflict.changeId ? (
                  <div className="implementation-conflict-actions">
                    <button type="button" disabled={busy} onClick={() => onResolveConflict(conflict.id, "current")}>Conservar Current</button>
                    <button type="button" className="primary" disabled={busy} onClick={() => onResolveConflict(conflict.id, "proposal")}>Usar Proposal</button>
                    <button type="button" disabled={busy} onClick={() => onResolveConflict(conflict.id, "cancel")}>Cancelar</button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {canRecheckRepository ? (
            <button type="button" className="implementation-conflict-retry" disabled={busy} onClick={onRetry}>
              Volver a comprobar
            </button>
          ) : null}
        </section>
      ) : null}

      {operation.failure ? (
        <div className="implementation-failure">
          <AlertTriangle size={14} />
          <span><strong>{operation.failure.phase === "applying" && operation.failure.rollbackStatus === "completed" ? "Los cambios fueron revertidos" : "La operación necesita atención"}</strong>{operation.failure.message}</span>
        </div>
      ) : null}

      {(operation.status === "completed" || operation.status === "completed_with_warnings" || operation.status === "rolled_back") ? (
        <div className="implementation-result-summary">
          <strong>{operation.status === "rolled_back" ? "Reversión completada" : operation.status === "completed" ? "La propuesta ya está aplicada" : "Cambios aplicados con advertencias"}</strong>
          <span>{operation.refresh.message ?? "El workspace principal fue actualizado."}</span>
        </div>
      ) : null}

      <details className="implementation-details">
        <summary><ChevronRight size={13} /> Ver archivos y validaciones</summary>
        <div className="implementation-detail-grid">
          <section>
            <h3>Archivos</h3>
            {operation.changeSet.length ? operation.changeSet.map((entry) => (
              <div key={entry.id} className="implementation-file-row">
                <span>{entry.newPath ?? entry.path}</span>
                <small>{fileKindLabel(entry.kind)}{entry.binary ? " · Binario" : ""}{entry.skipped ? " · Current conservado" : ""}</small>
              </div>
            )) : <p>No se detectaron archivos.</p>}
          </section>
          <section>
            <h3>Validaciones</h3>
            {validationChecks.length ? validationChecks.map((check) => (
              <details key={check.id} className={`implementation-check status-${check.status}`}>
                <summary><span>{check.status === "passed" ? "✓" : check.status === "failed" ? "!" : "·"} {check.label}</span><small>{check.status}</small></summary>
                <p>{check.summary}</p>
                {check.evidence ? <pre>{check.evidence}</pre> : null}
                {check.recommendation ? <small>{check.recommendation}</small> : null}
              </details>
            )) : <p>Las validaciones comenzarán después de Apply.</p>}
          </section>
          <section className="implementation-diff-summary">
            <h3>Diff aprobado</h3>
            <p><strong>+{operation.diffSummary.additions}</strong> adiciones · <strong>-{operation.diffSummary.deletions}</strong> eliminaciones</p>
            {operation.diffSummary.files.length ? (
              <>
                <div className="implementation-diff-filters" aria-label="Filtrar diff">
                  {(["all", "added", "modified", "deleted", "renamed"] as const).map((kind) => (
                    <button key={kind} type="button" className={diffFilter === kind ? "active" : ""} aria-pressed={diffFilter === kind} onClick={() => { setDiffFilter(kind); setSelectedDiffPath(null); }}>
                      {kind === "all" ? "Todos" : fileKindLabel(kind)}
                    </button>
                  ))}
                </div>
                <div className="implementation-diff-browser">
                  <nav aria-label="Archivos del diff">
                    {filteredDiffFiles.map((file) => (
                      <button key={file.path} type="button" className={selectedDiff?.path === file.path ? "active" : ""} aria-current={selectedDiff?.path === file.path ? "true" : undefined} onClick={() => setSelectedDiffPath(file.path)}>
                        <span>{file.path}</span><small>+{file.additions} -{file.deletions}</small>
                      </button>
                    ))}
                  </nav>
                  {selectedDiff ? <pre>{selectedDiff.preview}</pre> : <p>No hay archivos para este filtro.</p>}
                </div>
              </>
            ) : operation.diffSummary.preview ? <pre>{operation.diffSummary.preview}</pre> : <p>El cambio solo contiene metadatos o archivos binarios.</p>}
            {operation.diffSummary.truncated ? <small>Preview acotado por seguridad. Los archivos siguen disponibles en el workspace.</small> : null}
          </section>
        </div>
      </details>

      {!isActive && operation.status !== "conflict" && operation.status !== "rolled_back" && operation.rollback.available ? (
        <footer>
          <button type="button" disabled={busy} onClick={onRollback}><RotateCcw size={14} /> Revertir esta implementación</button>
        </footer>
      ) : null}
    </article>
  );
}
