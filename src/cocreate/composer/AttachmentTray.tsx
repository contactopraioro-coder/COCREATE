import { CircleCheck, FileText, FolderOpen, Image as ImageIcon, LoaderCircle, Paperclip, Plus, X } from "lucide-react";
import type { ComposerAttachment } from "../../app/services/attachment-service.js";

type AttachmentProgress = {
  processed: number;
  total: number;
};

type Props = {
  attachments: ComposerAttachment[];
  error: string | null;
  progress: AttachmentProgress | null;
  onAdd: () => void;
  onRemove: (token: string) => void;
};

function attachmentLabel(attachment: ComposerAttachment) {
  if (attachment.kind === "folder") return "Carpeta";
  if (attachment.kind === "image") return "Imagen";
  return "Archivo";
}

export function AttachmentTray({ attachments, error, progress, onAdd, onRemove }: Props) {
  if (!attachments.length && !error && !progress) return null;

  return (
    <section className="attachment-tray-shell" aria-label="Archivos para el siguiente mensaje">
      <div className="attachment-tray-heading">
        <span>
          <Paperclip size={14} aria-hidden="true" />
          <strong>{attachments.length ? `${attachments.length} ${attachments.length === 1 ? "archivo listo" : "archivos listos"}` : "Preparando archivos"}</strong>
        </span>
        <button type="button" onClick={onAdd}><Plus size={13} /> Agregar</button>
      </div>

      {progress ? (
        <div className="attachment-progress" role="status" aria-live="polite">
          <div><LoaderCircle className="spin" size={13} /><span>Preparando {progress.processed} de {progress.total}</span></div>
          <span className="attachment-progress-track"><i style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }} /></span>
        </div>
      ) : null}

      {attachments.length ? (
        <div className="attachment-list">
          {attachments.map((attachment) => (
            <article key={attachment.token} className={`attachment-item kind-${attachment.kind}`}>
              <span className="attachment-item-preview">
                {attachment.kind === "image" && attachment.previewUrl
                  ? <img src={attachment.previewUrl} alt="" />
                  : attachment.kind === "folder" ? <FolderOpen size={17} /> : attachment.kind === "image" ? <ImageIcon size={17} /> : <FileText size={17} />}
              </span>
              <span className="attachment-item-copy">
                <strong>{attachment.name}</strong>
                <small>{attachmentLabel(attachment)}{attachment.size ? ` · ${Math.max(1, Math.round(attachment.size / 1024))} KB` : ""}</small>
              </span>
              <CircleCheck className="attachment-ready" size={14} aria-label="Listo" />
              <button type="button" aria-label={`Quitar ${attachment.name}`} onClick={() => onRemove(attachment.token)}><X size={13} /></button>
            </article>
          ))}
        </div>
      ) : null}

      {error ? <div className="composer-attachment-error" role="alert">{error}</div> : null}
    </section>
  );
}
