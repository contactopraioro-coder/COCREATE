import type { WorkspaceArtifactItem } from "../../app/services/workspace-experience-service.js";
import { parseUnifiedDiffPreview } from "../../app/services/diff-preview-service.js";

type Props = {
  artifact: WorkspaceArtifactItem;
};

export function LiveDiffViewer({ artifact }: Props) {
  const lines = artifact.preview ? parseUnifiedDiffPreview(artifact.preview) : [];
  return (
    <section className="live-artifact-viewer" aria-label={`Vista de ${artifact.title}`}>
      <header>
        <span><strong>{artifact.title}</strong><small>{artifact.files.length ? artifact.files.join(" · ") : "Artifact"}</small></span>
        <span className="live-diff-stats">
          {artifact.additions !== null ? <b>+{artifact.additions}</b> : null}
          {artifact.deletions !== null ? <i>-{artifact.deletions}</i> : null}
        </span>
      </header>
      {lines.length ? (
        <div className="live-unified-diff" role="table" aria-label="Cambios de código">
          {lines.map((line) => (
            <div key={line.id} className={`diff-line ${line.kind}`} role="row">
              <span className="diff-line-number" role="cell">{line.oldLine ?? ""}</span>
              <span className="diff-line-number" role="cell">{line.newLine ?? ""}</span>
              <code role="cell">{line.text || " "}</code>
            </div>
          ))}
        </div>
      ) : artifact.preview ? (
        <pre className="live-artifact-output">{artifact.preview}</pre>
      ) : (
        <p className="live-panel-empty">El upstream no publicó un preview para este artifact.</p>
      )}
    </section>
  );
}
