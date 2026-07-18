import { ExternalLink, Link2, LoaderCircle, MonitorUp, Play, Settings2 } from "lucide-react";
import { useState } from "react";
import type { ScreenSharingSnapshot } from "../../app/services/screen-sharing-service.js";

type Props = {
  screen: ScreenSharingSnapshot;
  projectPreviewAvailable: boolean;
  onShare: () => void;
  onUseProjectPreview: () => void;
  onOpenUrl: (url: string) => { ok: boolean; error?: string };
  onOpenPermissionSettings: () => void;
};

export function LiveShareChooser({
  screen,
  projectPreviewAvailable,
  onShare,
  onUseProjectPreview,
  onOpenUrl,
  onOpenPermissionSettings
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const requesting = screen.status === "requesting";

  return (
    <section className="live-share-chooser" aria-labelledby="live-share-title">
      <div className="live-share-copy">
        <span className="live-share-orbit"><MonitorUp size={20} /></span>
        <p>Live Coding</p>
        <h2 id="live-share-title">¿Qué quieres mostrarle a CoCreate?</h2>
        <span>La captura solo comienza después de que elijas una superficie en el selector del sistema.</span>
      </div>

      <div className="live-share-primary-options">
        <button type="button" disabled={requesting || !screen.supported} onClick={onShare}>
          <span>{requesting ? <LoaderCircle className="spin" size={18} /> : <MonitorUp size={18} />}</span>
          <strong>Compartir una superficie</strong>
          <small>El sistema te permitirá elegir una pantalla, ventana o pestaña.</small>
        </button>
      </div>

      <div className="live-share-secondary-options">
        {projectPreviewAvailable ? (
          <button type="button" onClick={onUseProjectPreview}><Play size={15} /><span><strong>Usar preview del proyecto</strong><small>Abre la vista que ya vinculaste.</small></span></button>
        ) : null}
        <button type="button" onClick={() => setUrlOpen((current) => !current)}><Link2 size={15} /><span><strong>Abrir una URL</strong><small>Para una superficie web que tú indiques.</small></span></button>
      </div>

      {urlOpen ? (
        <form className="live-url-form" onSubmit={(event) => {
          event.preventDefault();
          const result = onOpenUrl(url);
          setUrlError(result.ok ? null : result.error ?? "No pude abrir esa dirección.");
        }}>
          <ExternalLink size={15} />
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://tu-aplicación.com" aria-label="URL que quieres mostrar" />
          <button type="submit" disabled={!url.trim()}>Abrir</button>
        </form>
      ) : null}

      {screen.error ? (
        <div className="live-share-error" role="alert">
          <span>{screen.error}</span>
          {screen.permission === "denied" ? <button type="button" onClick={onOpenPermissionSettings}><Settings2 size={14} /> Revisar permiso</button> : null}
        </div>
      ) : null}
    </section>
  );
}
