import { useEffect, useMemo, useRef, useState } from "react";

type Phase = "idle" | "requesting" | "recording" | "stopping" | "ready" | "analyzing";

type UploadFileInfo = {
  uri: string;
  name: string;
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

function sanitizeFileName(value: string) {
  const base = value.trim() || "sesion-codex";
  return base.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function buildAnalysisPrompt(userNotes: string) {
  const noteBlock = userNotes.trim()
    ? `Contexto extra del usuario:\n${userNotes.trim()}`
    : "Contexto extra del usuario:\nNo se proporciono contexto adicional.";

  return [
    "Analiza esta grabacion de pantalla como si fueras un operador senior que prepara instrucciones para OpenAI Codex.",
    "Tu objetivo es convertir lo observado en prompts listos para pegar en Codex y ejecutar trabajo tecnico.",
    "Responde en espanol.",
    "Si faltan detalles, haz suposiciones prudentes y decláralas.",
    "Usa exactamente esta estructura Markdown:",
    "# Resumen",
    "# Lo que parece querer el usuario",
    "# Prompt principal para Codex",
    "```text",
    "PROMPT AQUI",
    "```",
    "# Prompt de seguimiento",
    "```text",
    "PROMPT AQUI",
    "```",
    "# Checklist de ejecucion",
    "- item",
    "# Riesgos o vacios",
    "- item",
    noteBlock
  ].join("\n\n");
}

async function startResumableUpload(apiKey: string, blob: Blob, fileName: string) {
  const response = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(blob.size),
      "X-Goog-Upload-Header-Content-Type": blob.type || "video/webm",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      file: {
        display_name: fileName
      }
    })
  });

  if (!response.ok) {
    throw new Error(`No pude iniciar la subida a Gemini (${response.status}).`);
  }

  const uploadUrl = response.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini no devolvio una URL de subida.");
  }

  return uploadUrl;
}

async function uploadFileBytes(uploadUrl: string, blob: Blob): Promise<UploadFileInfo> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(blob.size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: blob
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.file?.uri || !payload?.file?.name) {
    throw new Error("Gemini no acepto el video o no devolvio la referencia del archivo.");
  }

  return payload.file;
}

async function waitForFileActive(apiKey: string, fileName: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      headers: {
        "x-goog-api-key": apiKey
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("No pude consultar el estado del archivo en Gemini.");
    }

    const state = typeof payload?.state === "string" ? payload.state : payload?.state?.name;
    if (state === "ACTIVE") {
      return;
    }
    if (state === "FAILED") {
      throw new Error("Gemini marco el video como FAILED durante el procesamiento.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 5000));
  }

  throw new Error("Gemini no termino de procesar el video a tiempo.");
}

async function createInteraction(
  apiKey: string,
  model: string,
  fileUri: string,
  mimeType: string,
  notes: string
) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          type: "video",
          uri: fileUri,
          mime_type: mimeType
        },
        {
          type: "text",
          text: buildAnalysisPrompt(notes)
        }
      ]
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Gemini no genero el analisis (${response.status}).`);
  }

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const fragments: string[] = [];
  for (const step of payload?.steps ?? []) {
    for (const part of step?.content ?? []) {
      if (part?.type === "text" && typeof part.text === "string") {
        fragments.push(part.text.trim());
      }
    }
  }

  const text = fragments.filter(Boolean).join("\n\n").trim();
  if (!text) {
    throw new Error("Gemini respondio, pero no devolvio texto util.");
  }

  return text;
}

function App() {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-3.5-flash");
  const [notes, setNotes] = useState(`Convierte lo que veas en instrucciones accionables para Codex.
Prioriza:
- objetivo tecnico
- archivos o areas del sistema que parecen implicadas
- pasos concretos de implementacion
- validaciones o pruebas recomendadas`);
  const [recordingName, setRecordingName] = useState("sesion-codex");
  const [status, setStatus] = useState(
    "Pulsa iniciar, comparte tu pantalla y luego deja que Gemini redacte prompts para Codex."
  );
  const [error, setError] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [isCopied, setIsCopied] = useState(false);

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
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [videoUrl]);

  const canAnalyze = Boolean(videoBlob && apiKey.trim() && phase !== "analyzing");
  const fileName = `${sanitizeFileName(recordingName)}.webm`;
  const fileStats = useMemo(
    () => ({
      size: formatBytes(videoBlob?.size ?? null),
      mimeType: videoBlob?.type || "video/webm"
    }),
    [videoBlob]
  );

  const startCapture = async () => {
    setError("");
    setAnalysis("");
    setVideoBlob(null);
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl("");
    }
    setStatus("El navegador te pedira elegir la pantalla o ventana para capturar.");
    setPhase("requesting");

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
      recorderRef.current = recorder;
      chunksRef.current = [];

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

      recorder.onstop = async () => {
        setPhase("stopping");
        setStatus("Preparando el video para analisis.");
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setVideoBlob(blob);
        setVideoUrl(url);
        setStatus("Grabacion lista. Puedes descargarla o analizarla con Gemini.");
        setPhase("ready");
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (previewRef.current) {
          previewRef.current.srcObject = null;
        }
      };

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      });

      recorder.start(1000);
      setPhase("recording");
      setStatus("Grabando pantalla. Cuando termines, pulsa detener.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude iniciar la captura.");
      setStatus("No arrancamos. Revisa permisos del navegador para compartir pantalla.");
      setPhase("idle");
    }
  };

  const stopCapture = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const analyzeVideo = async () => {
    if (!videoBlob) {
      return;
    }

    setError("");
    setPhase("analyzing");
    setStatus("Subiendo el video a Gemini y generando prompts para Codex.");

    try {
      const uploadUrl = await startResumableUpload(apiKey, videoBlob, fileName);
      const file = await uploadFileBytes(uploadUrl, videoBlob);
      await waitForFileActive(apiKey, file.name);
      const output = await createInteraction(apiKey, model, file.uri, videoBlob.type, notes);
      setAnalysis(output);
      setStatus("Analisis listo. Ya puedes copiar el prompt.");
      setPhase("ready");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No pude completar el analisis con Gemini."
      );
      setPhase("ready");
    }
  };

  const copyOutput = async () => {
    if (!analysis) {
      return;
    }

    await navigator.clipboard.writeText(analysis);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1800);
  };

  return (
    <main className="webapp-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Caleidoscopio Web</p>
          <h1>Pruebalo directo en tu pagina.</h1>
          <p className="lead">
            Esta version corre en navegador: graba pantalla, conserva el video localmente y usa
            Gemini para devolverte prompts listos para pegar en Codex.
          </p>
        </div>

        <div className="hero-actions">
          <button className="button primary" onClick={startCapture} disabled={phase === "recording" || phase === "analyzing"}>
            Iniciar captura
          </button>
          <button className="button danger" onClick={stopCapture} disabled={phase !== "recording"}>
            Detener
          </button>
          <button className="button subtle" onClick={analyzeVideo} disabled={!canAnalyze}>
            {phase === "analyzing" ? "Analizando..." : "Crear prompts"}
          </button>
        </div>

        <div className="status-card">
          <span className={`phase-dot ${phase}`} />
          <p>{status}</p>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Preview</p>
              <h2>Grabacion</h2>
            </div>
            <span className="badge">{phase}</span>
          </div>

          <div className="video-stage">
            {phase === "recording" ? (
              <video ref={previewRef} autoPlay playsInline />
            ) : videoUrl ? (
              <video src={videoUrl} controls playsInline />
            ) : (
              <div className="placeholder">
                <strong>Tu video aparecera aqui</strong>
                <span>Comparte una pantalla o ventana para empezar la prueba.</span>
              </div>
            )}
          </div>

          <div className="form-grid">
            <label>
              Nombre del archivo
              <input
                value={recordingName}
                onChange={(event) => setRecordingName(event.target.value)}
                placeholder="sesion-codex"
              />
            </label>

            <div className="stats">
              <div className="stat">
                <span>Tamano</span>
                <strong>{fileStats.size}</strong>
              </div>
              <div className="stat">
                <span>Formato</span>
                <strong>{fileStats.mimeType}</strong>
              </div>
            </div>

            {videoUrl ? (
              <a className="button subtle full" href={videoUrl} download={fileName}>
                Descargar video
              </a>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Gemini</p>
              <h2>Analisis</h2>
            </div>
          </div>

          <div className="form-grid">
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
                rows={10}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            {error ? <p className="error-box">{error}</p> : null}
          </div>
        </article>
      </section>

      <section className="panel output-panel">
        <div className="panel-head">
          <div>
            <p className="kicker">Salida</p>
            <h2>Prompt para Codex</h2>
          </div>
          <button className="button subtle" onClick={copyOutput} disabled={!analysis}>
            {isCopied ? "Copiado" : "Copiar"}
          </button>
        </div>

        <pre>{analysis || "Todavia no hay analisis. Graba un flujo y luego pulsa Crear prompts."}</pre>
      </section>
    </main>
  );
}

export default App;
