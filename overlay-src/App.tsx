import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Clipboard,
  Monitor,
  PauseCircle,
  PlayCircle,
  ScanSearch,
  Square,
  Video,
  X
} from "lucide-react";
import { defaultNotes } from "./mock";
import type { AnalysisResult, AppConfig, RecorderPhase, SaveRecordingResult } from "./types";

const stopTracks = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
};

function inferMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
}

function formatBytes(value: number | null) {
  if (!value) {
    return "sin archivo";
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-3.5-flash");
  const [notes, setNotes] = useState(defaultNotes);
  const [status, setStatus] = useState(
    "Elige una pantalla en macOS, graba tu flujo y luego deja que Gemini redacte prompts listos para Codex."
  );
  const [recordingName, setRecordingName] = useState("sesion-codex");
  const [savedRecording, setSavedRecording] = useState<SaveRecordingResult | null>(null);
  const [lastMimeType, setLastMimeType] = useState("video/webm");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    window.overlayBridge
      ?.getConfig()
      .then((payload) => {
        setConfig(payload);
        setModel(payload.defaultGeminiModel);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "No pude cargar la configuracion local.");
      });
  }, []);

  useEffect(() => {
    const storedApiKey = window.localStorage.getItem("caleidoscopio-gemini-api-key");
    if (storedApiKey) {
      setApiKey(storedApiKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("caleidoscopio-gemini-api-key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    return () => {
      stopTracks(streamRef.current);
      if (previewRef.current) {
        previewRef.current.srcObject = null;
      }
    };
  }, []);

  const canAnalyze = Boolean(savedRecording?.filePath && apiKey.trim() && phase !== "analyzing");
  const isRecording = phase === "recording";

  const metaCards = useMemo(
    () => [
      {
        icon: <Monitor size={18} />,
        label: "Salida local",
        value: config?.outputDir ?? "cargando..."
      },
      {
        icon: <Video size={18} />,
        label: "Ultimo archivo",
        value: savedRecording?.filePath ?? "sin grabacion"
      },
      {
        icon: <Bot size={18} />,
        label: "Modelo",
        value: model
      }
    ],
    [config?.outputDir, model, savedRecording?.filePath]
  );

  const startRecording = async () => {
    setError("");
    setAnalysis(null);
    setSavedRecording(null);
    setIsCopied(false);
    setPhase("requesting");
    setStatus("macOS te pedira elegir la pantalla o ventana que quieres capturar.");

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30
        },
        audio: true
      });

      const mimeType = inferMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      setLastMimeType(mimeType);

      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.muted = true;
        previewRef.current.play().catch(() => {});
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("La grabacion encontro un error del navegador y se detuvo.");
        setPhase("idle");
      };

      recorder.onstop = async () => {
        setPhase("stopping");
        setStatus("Guardando la grabacion en disco para poder enviarla a Gemini.");

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const saved = await window.overlayBridge?.saveRecording({
            buffer: new Uint8Array(arrayBuffer),
            mimeType,
            suggestedName: recordingName
          });

          if (!saved) {
            throw new Error("No pude guardar la grabacion.");
          }

          setSavedRecording(saved);
          setStatus(`Grabacion lista. Archivo guardado en ${saved.filePath}.`);
          setPhase("ready");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "No pude guardar la grabacion.");
          setPhase("idle");
        } finally {
          stopTracks(streamRef.current);
          streamRef.current = null;
        }
      };

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      });

      recorder.start(1000);
      setPhase("recording");
      setStatus("Grabando pantalla. Cuando termines, presiona Detener.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude iniciar la captura de pantalla.");
      setPhase("idle");
      setStatus("No arrancamos. Revisa permisos de Screen Recording en macOS e intenta otra vez.");
      stopTracks(streamRef.current);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
      return;
    }

    setStatus("Deteniendo la captura...");
    mediaRecorderRef.current.stop();
  };

  const runAnalysis = async () => {
    if (!savedRecording?.filePath) {
      return;
    }

    setError("");
    setPhase("analyzing");
    setStatus("Subiendo el video a Gemini, esperando procesamiento y redactando prompts para Codex.");

    try {
      const result = await window.overlayBridge?.analyzeRecording({
        apiKey,
        model,
        notes,
        filePath: savedRecording.filePath,
        mimeType: lastMimeType
      });

      if (!result) {
        throw new Error("Gemini no devolvio un resultado.");
      }

      setAnalysis(result);
      setStatus("Analisis listo. Ya tienes prompts preparados para Codex.");
      setPhase("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude completar el analisis.");
      setPhase("ready");
    }
  };

  const copyOutput = async () => {
    if (!analysis?.output) {
      return;
    }

    await window.overlayBridge?.copyText(analysis.output);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1800);
  };

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Caleidoscopio Recorder</span>
          <h1>Graba tu pantalla y convierte el video en prompts listos para Codex.</h1>
          <p>
            Esta version toma la pantalla que elijas, guarda el video localmente y usa Gemini
            para extraer el objetivo tecnico, el prompt principal y el siguiente prompt de trabajo.
          </p>
        </div>

        <div className="hero-actions">
          <button className="primary-action" onClick={startRecording} disabled={isRecording || phase === "analyzing"}>
            <PlayCircle size={18} />
            <span>{isRecording ? "Grabando" : "Iniciar captura"}</span>
          </button>
          <button className="secondary-action" onClick={stopRecording} disabled={!isRecording}>
            <Square size={18} />
            <span>Detener</span>
          </button>
          <button className="ghost-action" onClick={() => window.overlayBridge?.closeApp()}>
            <X size={18} />
            <span>Cerrar</span>
          </button>
        </div>

        <div className="status-banner">
          <PauseCircle size={18} />
          <span>{status}</span>
        </div>
      </section>

      <section className="workspace-grid">
        <article className="panel preview-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Captura</span>
              <h2>Preview en vivo</h2>
            </div>
            <span className={`phase-chip ${phase}`}>{phase}</span>
          </div>

          <div className="preview-frame">
            <video ref={previewRef} autoPlay playsInline />
            {!isRecording && (
              <div className="preview-placeholder">
                <Monitor size={38} />
                <p>Cuando arranques la grabacion, aqui veras la pantalla elegida.</p>
              </div>
            )}
          </div>

          <div className="preview-controls">
            <label>
              Nombre del archivo
              <input
                value={recordingName}
                onChange={(event) => setRecordingName(event.target.value)}
                placeholder="sesion-codex"
              />
            </label>
            <div className="stats-row">
              <div>
                <span>Tamano</span>
                <strong>{formatBytes(savedRecording?.fileSize ?? null)}</strong>
              </div>
              <div>
                <span>Formato</span>
                <strong>{lastMimeType}</strong>
              </div>
            </div>
          </div>
        </article>

        <article className="panel config-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Gemini</span>
              <h2>Analisis del video</h2>
            </div>
            <button className="analyze-action" onClick={runAnalysis} disabled={!canAnalyze}>
              <ScanSearch size={18} />
              <span>{phase === "analyzing" ? "Analizando..." : "Crear prompts"}</span>
            </button>
          </div>

          <label>
            API key de Google AI Studio
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="AIza..."
            />
          </label>

          <label>
            Modelo
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>

          <label>
            Instrucciones para el analisis
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={10}
            />
          </label>

          <div className="meta-grid">
            {metaCards.map((card) => (
              <div key={card.label} className="meta-card">
                {card.icon}
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>

          {error ? <p className="error-banner">{error}</p> : null}
        </article>
      </section>

      <section className="result-grid">
        <article className="panel result-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Salida</span>
              <h2>Prompts listos para pegar</h2>
            </div>
            <button className="copy-action" onClick={copyOutput} disabled={!analysis?.output}>
              <Clipboard size={18} />
              <span>{isCopied ? "Copiado" : "Copiar"}</span>
            </button>
          </div>

          <pre>{analysis?.output ?? "Todavia no hay analisis. Graba, guarda y luego pulsa Crear prompts."}</pre>
        </article>
      </section>
    </main>
  );
}

export default App;
