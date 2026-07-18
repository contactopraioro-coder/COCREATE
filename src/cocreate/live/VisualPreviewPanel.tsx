import { Crosshair, MousePointer2, Pause, Play, ScanLine, Square } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type {
  VisualAnnotation,
  VisualBounds,
  VisualCollaborationSnapshot,
  VisualPoint
} from "../../app/services/visual-collaboration-service.js";

type Props = {
  snapshot: VisualCollaborationSnapshot;
  stream: MediaStream | null;
  sharingPaused: boolean;
  surfaceLabel: string | null;
  observedElements: string[];
  onTogglePause: () => void;
  onStopSharing: () => void;
  onHover: (bounds: VisualBounds | null) => void;
  onSelect: (bounds: VisualBounds) => void;
  onMovePointer: (point: VisualPoint | null) => void;
  onAddAnnotation: (kind: VisualAnnotation["kind"], start: VisualPoint, end: VisualPoint) => void;
  onRenameSelection: (label: string) => void;
  onClearSelection: () => void;
};

type AnnotationDraft = { start: VisualPoint; end: VisualPoint } | null;

function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>): VisualPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  };
}

function hoverBounds(point: VisualPoint): VisualBounds {
  const width = 0.22;
  const height = 0.12;
  return {
    x: Math.min(1 - width, Math.max(0, point.x - width / 2)),
    y: Math.min(1 - height, Math.max(0, point.y - height / 2)),
    width,
    height
  };
}

function boundsStyle(bounds: VisualBounds) {
  return {
    left: `${bounds.x * 100}%`,
    top: `${bounds.y * 100}%`,
    width: `${bounds.width * 100}%`,
    height: `${bounds.height * 100}%`
  };
}

function annotationGeometry(annotation: VisualAnnotation) {
  const x = Math.min(annotation.start.x, annotation.end.x) * 100;
  const y = Math.min(annotation.start.y, annotation.end.y) * 100;
  const width = Math.max(1, Math.abs(annotation.end.x - annotation.start.x) * 100);
  const height = Math.max(1, Math.abs(annotation.end.y - annotation.start.y) * 100);
  return { left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%` };
}

export function VisualPreviewPanel({
  snapshot,
  stream,
  sharingPaused,
  surfaceLabel,
  observedElements,
  onTogglePause,
  onStopSharing,
  onHover,
  onSelect,
  onMovePointer,
  onAddAnnotation,
  onRenameSelection,
  onClearSelection
}: Props) {
  const [draft, setDraft] = useState<AnnotationDraft>(null);
  const [selectionName, setSelectionName] = useState(snapshot.selection?.label ?? "");
  const [frameMode, setFrameMode] = useState<"contain" | "cover">("contain");
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    setSelectionName(snapshot.selection?.label ?? "");
  }, [snapshot.selection?.id, snapshot.selection?.label]);

  const annotationKind: VisualAnnotation["kind"] | null = snapshot.tool === "arrow" || snapshot.tool === "circle" || snapshot.tool === "rectangle" ? snapshot.tool : null;
  const annotationTool = annotationKind !== null;
  const interactionEnabled = snapshot.tool !== "interact";

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(event);
    if (snapshot.tool === "select") onHover(hoverBounds(point));
    if (snapshot.tool === "pointer") onMovePointer(point);
    if (draft) setDraft({ ...draft, end: point });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!annotationTool) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    setDraft({ start: point, end: point });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (snapshot.tool === "select") {
      onSelect(hoverBounds(pointFromEvent(event)));
      onHover(null);
      return;
    }
    if (annotationTool && draft) {
      onAddAnnotation(annotationKind!, draft.start, pointFromEvent(event));
      setDraft(null);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && snapshot.tool === "select") {
      event.preventDefault();
      onSelect({ x: 0.39, y: 0.44, width: 0.22, height: 0.12 });
    }
    if (event.key === "Escape") {
      onHover(null);
      onMovePointer(null);
    }
  };

  const draftAnnotation: VisualAnnotation | null = draft && annotationKind ? {
    id: "annotation-draft",
    kind: annotationKind,
    start: draft.start,
    end: draft.end,
    createdAt: snapshot.updatedAt
  } : null;
  const annotations = draftAnnotation ? [...snapshot.annotations, draftAnnotation] : snapshot.annotations;

  return (
    <section className="visual-preview-panel" aria-label="Pantalla actual">
      <header className="visual-panel-heading">
        <span><strong>Pantalla actual</strong><small>{surfaceLabel ?? snapshot.preview.title}</small></span>
        {stream ? (
          <span className="live-current-actions">
            <button type="button" onClick={() => setFrameMode((current) => current === "contain" ? "cover" : "contain")} aria-label={frameMode === "contain" ? "Llenar el encuadre" : "Ver superficie completa"} title={frameMode === "contain" ? "Llenar encuadre" : "Ver completa"}>
              <ScanLine size={13} />
            </button>
            <button type="button" onClick={onTogglePause} aria-label={sharingPaused ? "Reanudar visualización" : "Pausar visualización"} title={sharingPaused ? "Reanudar" : "Pausar"}>
              {sharingPaused ? <Play size={13} /> : <Pause size={13} />}
            </button>
            <button type="button" onClick={onStopSharing} aria-label="Dejar de compartir" title="Dejar de compartir"><Square size={11} fill="currentColor" /></button>
          </span>
        ) : <span className="visual-view-size">{snapshot.viewport.width} × {snapshot.viewport.height}</span>}
      </header>

      <div className="visual-preview-stage-wrap">
        <div
          className={`visual-preview-stage viewport-${snapshot.viewport.preset}`}
          style={{ aspectRatio: `${snapshot.viewport.width} / ${snapshot.viewport.height}` }}
        >
          {stream ? (
            <video ref={videoRef} className={`live-shared-video frame-${frameMode}${sharingPaused ? " paused" : ""}`} autoPlay muted playsInline />
          ) : snapshot.preview.url ? (
            <iframe
              key={`${snapshot.preview.url}:${snapshot.preview.refreshToken}`}
              title={`Preview de ${snapshot.preview.title}`}
              src={snapshot.preview.url}
              sandbox="allow-forms allow-modals allow-popups allow-scripts"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="visual-preview-empty">
              <Crosshair size={22} />
              <strong>Comparte una superficie</strong>
              <p>Elige una pantalla, ventana o pestaña para mostrarla aquí.</p>
            </div>
          )}

          {snapshot.selection ? (
            <div className="visual-selection-box selected" style={boundsStyle(snapshot.selection.bounds)}>
              <span>{snapshot.selection.label}</span>
            </div>
          ) : null}
          {snapshot.hoverBounds && snapshot.tool === "select" ? <div className="visual-selection-box hover" style={boundsStyle(snapshot.hoverBounds)} /> : null}

          {snapshot.pointer ? (
            <div className="visual-shared-pointer" style={{ left: `${snapshot.pointer.x * 100}%`, top: `${snapshot.pointer.y * 100}%` }}>
              <MousePointer2 size={19} fill="currentColor" />
              <span>Tú</span>
            </div>
          ) : null}

          <svg className="visual-annotation-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><marker id="visual-arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker></defs>
            {annotations.filter((annotation) => annotation.kind === "arrow").map((annotation) => (
              <line key={annotation.id} x1={annotation.start.x * 100} y1={annotation.start.y * 100} x2={annotation.end.x * 100} y2={annotation.end.y * 100} markerEnd="url(#visual-arrow-head)" />
            ))}
          </svg>
          {annotations.filter((annotation) => annotation.kind !== "arrow").map((annotation) => (
            <div key={annotation.id} className={`visual-annotation-shape ${annotation.kind}`} style={annotationGeometry(annotation)} />
          ))}

          <div
            ref={interactionRef}
            className={`visual-interaction-layer tool-${snapshot.tool}${interactionEnabled ? " enabled" : ""}`}
            aria-label={interactionEnabled ? `Herramienta visual: ${snapshot.tool}` : undefined}
            role={interactionEnabled ? "application" : undefined}
            tabIndex={interactionEnabled ? 0 : -1}
            onKeyDown={handleKeyDown}
            onPointerLeave={() => { onHover(null); if (snapshot.tool === "pointer") onMovePointer(null); }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          />

          {observedElements.length ? (
            <div className="live-observed-overlay" aria-label="Elementos observados">
              <strong>Live está viendo</strong>
              <div>
                {observedElements.map((element) => <span key={element}>{element}</span>)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {snapshot.selection ? (
        <form className="visual-selection-inspector" onSubmit={(event) => { event.preventDefault(); onRenameSelection(selectionName); }}>
          <span><strong>Selección</strong><small>{snapshot.selection.location}</small></span>
          <input value={selectionName} onChange={(event) => setSelectionName(event.target.value)} aria-label="Nombre amigable de la selección" maxLength={80} />
          <button type="submit">Guardar nombre</button>
          <button type="button" className="quiet" onClick={onClearSelection}>Quitar</button>
        </form>
      ) : (
        <p className="visual-preview-hint">
          {snapshot.tool === "interact" ? "Navega y desplázate dentro de tu aplicación." : "La selección visual no lee IDs, clases ni contenido privado del preview."}
        </p>
      )}
    </section>
  );
}
