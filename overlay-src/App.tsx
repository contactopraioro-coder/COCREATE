import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clipboard,
  Command,
  Compass,
  GitBranch,
  Globe2,
  ImagePlus,
  Mic,
  Monitor,
  MousePointer2,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Square,
  TerminalSquare,
  Upload
} from "lucide-react";
import { defaultNotes } from "./mock";
import type { AnalysisResult, AppConfig, CodexStatus, RecorderPhase, SaveRecordingResult } from "./types";
import { CodexStatusService } from "../src/app/services/codex-status-service";
import { createCodexAdapter } from "../src/infrastructure/codex/create-codex-adapter";

const chats = ["Main", "Caleidoscopio", "Group", "Project"];
const branches = ["main", "ui-shell", "codex-upstream"];

const stopTracks = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

function inferMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
}

function formatBytes(value: number | null) {
  if (!value) return "sin archivo";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const codexAdapterRef = useRef<ReturnType<typeof createCodexAdapter> | null>(null);
  if (!codexAdapterRef.current) {
    codexAdapterRef.current = createCodexAdapter();
  }
  const codexStatusServiceRef = useRef(new CodexStatusService(codexAdapterRef.current));

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [model, setModel] = useState("gemini-3.5-flash");
  const [notes, setNotes] = useState(defaultNotes);
  const [status, setStatus] = useState("CoCreate listo. Conecta Codex upstream o captura contexto.");
  const [recordingName, setRecordingName] = useState("sesion-codex");
  const [savedRecording, setSavedRecording] = useState<SaveRecordingResult | null>(null);
  const [lastMimeType, setLastMimeType] = useState("video/webm");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [activeChat, setActiveChat] = useState(chats[0]);
  const [draftPrompt, setDraftPrompt] = useState(
    ""
  );

  useEffect(() => {
    return () => {
      void codexAdapterRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    window.overlayBridge
      ?.getConfig()
      .then((payload) => {
        setConfig(payload);
        setCodexStatus(payload.codex);
        setModel(payload.defaultGeminiModel);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "No pude cargar la configuracion local.");
      });
  }, []);

  useEffect(() => {
    window.localStorage.removeItem("caleidoscopio-gemini-api-key");
  }, []);

  useEffect(() => {
    return () => {
      stopTracks(streamRef.current);
      if (previewRef.current) previewRef.current.srcObject = null;
    };
  }, []);

  const isRecording = phase === "recording";
  const canAnalyze = Boolean(savedRecording?.filePath && phase !== "analyzing");
  const upstreamReady = Boolean(codexStatus?.available);

  const refreshCodexStatus = async () => {
    const next = await codexStatusServiceRef.current.refreshStatus();
    if (next) setCodexStatus(next);
  };

  const startRecording = async () => {
    setError("");
    setAnalysis(null);
    setSavedRecording(null);
    setIsCopied(false);
    setPhase("requesting");
    setStatus("Elige la pantalla o ventana para capturar contexto.");

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
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
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        setPhase("stopping");
        setStatus("Guardando captura local para analizarla.");

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const saved = await window.overlayBridge?.saveRecording({
            buffer: new Uint8Array(arrayBuffer),
            mimeType,
            suggestedName: recordingName
          });

          if (!saved) throw new Error("No pude guardar la grabacion.");
          setSavedRecording(saved);
          setStatus("Captura lista. Puedes enviarla a Gemini para generar el prompt.");
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
        if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      });

      recorder.start(1000);
      setPhase("recording");
      setStatus("Grabando pantalla y audio.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude iniciar la captura.");
      setPhase("idle");
      setStatus("Revisa permisos de Screen Recording e intenta otra vez.");
      stopTracks(streamRef.current);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      setStatus("Deteniendo captura...");
      mediaRecorderRef.current.stop();
    }
  };

  const runAnalysis = async () => {
    if (!savedRecording?.filePath) return;

    setError("");
    setPhase("analyzing");
    setStatus("Analizando captura y preparando prompt para Codex.");

    try {
      const result = await window.overlayBridge?.analyzeRecording({
        model,
        notes,
        filePath: savedRecording.filePath,
        mimeType: lastMimeType
      });
      if (!result) throw new Error("Gemini no devolvio un resultado.");
      setAnalysis(result);
      setDraftPrompt(result.output);
      setStatus("Prompt generado. Queda listo para enviarlo al adaptador Codex.");
      setPhase("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude completar el analisis.");
      setPhase("ready");
    }
  };

  const copyOutput = async () => {
    const text = analysis?.output ?? draftPrompt;
    await window.overlayBridge?.copyText(text);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1800);
  };

  return (
    <main className="desktop-shell">
      <header className="topbar">
        <div className="window-drag">
          <div className="brand-mark">CC</div>
          <div>
            <strong>CoCreate</strong>
            <span>{config?.platform ?? "desktop"} workspace</span>
          </div>
        </div>
        <div className={`codex-indicator ${upstreamReady ? "ready" : ""}`}>
          <TerminalSquare size={15} />
          <span>{upstreamReady ? codexStatus?.version : "Codex CLI pendiente"}</span>
        </div>
        <div className="top-actions">
          <button title="Codex status" onClick={refreshCodexStatus}>
            <RefreshCw size={16} />
          </button>
          <button title="Settings">
            <Settings size={16} />
          </button>
        </div>
      </header>

      <section className="codex-layout">
        <aside className="sidebar">
          <nav>
            {chats.map((chat) => (
              <button
                key={chat}
                className={activeChat === chat ? "selected" : ""}
                onClick={() => setActiveChat(chat)}
              >
                <Command size={16} />
                <span>{chat}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-section">
            <p>Branches</p>
            {branches.map((branch) => (
              <button key={branch} className="branch-button">
                <GitBranch size={15} />
                <span>{branch}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-stage">
          <div className="ambient-card">
            <span>CoCreate</span>
            <strong>{activeChat}</strong>
            <small>{status}</small>
          </div>

          <div className="center-chat">
            <div className="chat-orb">
              <Bot size={30} />
            </div>
            <h1>What do you want to build?</h1>
            <p>Codex upstream, voice notes, and screen context in one quiet desktop surface.</p>

            <div className="chatbar">
              <textarea
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                placeholder="Ask CoCreate anything..."
                rows={2}
              />

              <div className="chat-actions">
                <div className="left-tools">
                  <button title="Attach source">
                    <ImagePlus size={22} />
                  </button>
                  <button title="Browse context">
                    <Globe2 size={22} />
                  </button>
                  <button title="Voice prompt">
                    <Mic size={22} />
                  </button>
                  <button
                    className={isRecording ? "active" : ""}
                    title={isRecording ? "Stop sharing screen" : "Share screen to edit"}
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={phase === "analyzing"}
                  >
                    {isRecording ? <Square size={22} /> : <Monitor size={22} />}
                  </button>
                </div>

                <button className="send-button" title="Send prompt" onClick={copyOutput}>
                  <Send size={22} />
                </button>
              </div>
            </div>

            <div className="quick-row">
              <button onClick={refreshCodexStatus}>
                <CheckCircle2 size={16} />
                <span>Check Codex</span>
              </button>
              <button onClick={runAnalysis} disabled={!canAnalyze}>
                <Sparkles size={16} />
                <span>Analyze screen</span>
              </button>
              <button onClick={copyOutput}>
                <Clipboard size={16} />
                <span>{isCopied ? "Copied" : "Copy prompt"}</span>
              </button>
            </div>
          </div>

          <div className="context-dock">
            <div>
              <span>Upstream</span>
              <strong>{codexStatus?.mode ?? "cli-upstream"}</strong>
              <small>{codexStatus?.license ?? "Apache-2.0"}</small>
            </div>
            <div>
              <span>Screen</span>
              <strong>{phase}</strong>
              <small>{formatBytes(savedRecording?.fileSize ?? null)}</small>
            </div>
            <div>
              <span>Intent</span>
              <strong>edit</strong>
              <small>{lastMimeType}</small>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <section className="inspector-card">
            <div className="card-header compact">
              <div>
                <span className="eyebrow">Caleidoscopio</span>
                <h2>Screen context</h2>
              </div>
              <span className={`phase-chip ${phase}`}>{phase}</span>
            </div>

            <div className="preview-frame">
              <video ref={previewRef} autoPlay playsInline />
              {!isRecording && (
                <div className="preview-placeholder">
                  <Monitor size={30} />
                  <span>Sin captura activa</span>
                </div>
              )}
            </div>

            <div className="button-row">
              <button className="primary-action" onClick={isRecording ? stopRecording : startRecording} disabled={phase === "analyzing"}>
                {isRecording ? <Square size={16} /> : <Upload size={16} />}
                <span>{isRecording ? "Stop" : "Share screen"}</span>
              </button>
              <button className="ghost-action" onClick={runAnalysis} disabled={!canAnalyze}>
                <Sparkles size={16} />
                <span>Analyze</span>
              </button>
            </div>

            {isRecording ? (
              <button className="danger-action full" onClick={stopRecording}>
                <Square size={16} />
                <span>Stop capture</span>
              </button>
            ) : null}

            <label>
              Archivo
              <input value={recordingName} onChange={(event) => setRecordingName(event.target.value)} />
            </label>

            <div className="mini-grid">
              <div>
                <span>Tamano</span>
                <strong>{formatBytes(savedRecording?.fileSize ?? null)}</strong>
              </div>
              <div>
                <span>Formato</span>
                <strong>{lastMimeType}</strong>
              </div>
            </div>
          </section>

          <section className="inspector-card">
            <div className="card-header compact">
              <div>
                <span className="eyebrow">AI context</span>
                <h2>Model</h2>
              </div>
            </div>
            <label>
              Modelo
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <label>
              Notas
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} />
            </label>
          </section>

          <section className="inspector-card compact-list">
            <div className="card-header compact">
              <div>
                <span className="eyebrow">Editing</span>
                <h2>Live tools</h2>
              </div>
              <MousePointer2 size={16} />
            </div>
            <div className="person-row">
              <strong>Voice</strong>
              <span>Prompt by speaking</span>
            </div>
            <div className="person-row">
              <strong>Screen</strong>
              <span>Edit by pointing</span>
            </div>
            <div className="person-row">
              <strong>Navigator</strong>
              <span>Use page context</span>
            </div>
          </section>
        </aside>
      </section>

      <footer className="statusline">
        <span>{status}</span>
        {error ? <strong>{error}</strong> : null}
      </footer>
    </main>
  );
}

export default App;
