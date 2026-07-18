import {
  Archive,
  Bot,
  Box,
  ChevronDown,
  CircleHelp,
  Code2,
  Compass,
  FileCode2,
  ImagePlus,
  LayoutPanelLeft,
  Library,
  LogOut,
  Mic,
  MoonStar,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Share2,
  Sparkles,
  Square,
  SunMedium,
  TerminalSquare,
  User,
  Users,
  Wand2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  CodexExecutionHandle,
  CodexExecutionEvent,
  CodexStatus
} from "../../shared/codex-contracts";
import { CodexExecutionService } from "../app/services/codex-execution-service";
import { CodexStatusService } from "../app/services/codex-status-service";
import { createCodexAdapter } from "../infrastructure/codex/create-codex-adapter";
import "./cocreate.css";
import { getWebClientId, loadWebState, saveWebState } from "./web-persistence";

type ThemeMode = "dark" | "light";
type RecorderPhase = "idle" | "requesting" | "recording" | "stopping" | "ready" | "analyzing";
type ActiveMode = "chat" | "live" | "cocoding";
type MessageRole = "assistant" | "user" | "system";

type AppConfig = {
  outputDir: string;
  defaultGeminiModel: string;
  workingDirectory?: string;
  appVersion?: string;
  runtimeVersion?: string;
  platform: string;
  stateStorePath: string;
  featureFlags: FeatureFlags;
  codex: CodexStatus;
};

type SaveRecordingResult = {
  filePath: string;
  fileSize: number;
};

type AnalysisResult = {
  model: string;
  fileName: string;
  output: string;
  provider?: string;
  requestId?: string;
};

type FeatureFlags = {
  persistentSessions: boolean;
  liveCompare: boolean;
  realtimeChunks: boolean;
  autoApplyCodex: boolean;
};

type Thread = {
  id: string;
  title: string;
  preview: string;
};

type ChatMessage = {
  id: string;
  role: MessageRole;
  body: string;
};

type ThreadMessages = Record<string, ChatMessage[]>;

type PersistedWorkbenchSnapshot = {
  theme: ThemeMode;
  activeMode: ActiveMode;
  threads: Thread[];
  messagesByThread: ThreadMessages;
  activeThreadId: string;
  activeTool: string;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  profileOpen: boolean;
  searchOpen: boolean;
  webEnabled: boolean;
  prompt: string;
  phase: RecorderPhase;
  status: string;
  model: string;
  notes: string;
  recordingName: string;
  savedRecording: SaveRecordingResult | null;
  lastMimeType: string;
  error: string;
};

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEvent = {
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

const defaultNotes = [
  "Analiza la pantalla como contexto de desarrollo para CoCreate.",
  "Devuelve un prompt accionable para Codex.",
  "Incluye archivos probables, cambios visuales, riesgos y checklist."
].join("\n");

const initialThreads: Thread[] = [
  {
    id: "main",
    title: "Nuevo workspace",
    preview: "Construir una experiencia CoCreate limpia"
  },
  {
    id: "live",
    title: "Live Coding",
    preview: "Captura pantalla y convierte el video en prompt"
  },
  {
    id: "cocoding",
    title: "Co-Coding",
    preview: "Sesión colaborativa con assistant y participantes"
  }
];

const leftNav = [
  { id: "new", label: "Nuevo chat", icon: Plus },
  { id: "search", label: "Buscar chats", icon: Search },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "projects", label: "Proyectos", icon: FileCode2 },
  { id: "schedule", label: "Programación", icon: TerminalSquare },
  { id: "addons", label: "Complementos", icon: Box },
  { id: "images", label: "Imágenes", icon: ImagePlus },
  { id: "gpts", label: "GPTs", icon: Bot },
  { id: "sites", label: "Sitios", icon: Compass },
  { id: "more", label: "Más", icon: MoreHorizontal }
];

const quickPrompts = [
  "Build a clean dashboard shell",
  "Review this repo and suggest the next product step",
  "Create a lightweight auth flow"
];

const collaborators = ["Martin", "Assistant", "Ana", "Sara"];

const formatBytes = (value: number | null) => {
  if (!value) return "sin archivo";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const inferMimeType = () => {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
};

const stopTracks = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const createId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

const getSpeechRecognition = () => {
  const windowWithSpeech = window as Window &
    typeof globalThis & {
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
      SpeechRecognition?: SpeechRecognitionConstructor;
    };

  return windowWithSpeech.SpeechRecognition ?? windowWithSpeech.webkitSpeechRecognition;
};

const defaultMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    body: "CoCreate listo. Escribe una tarea, adjunta contexto o usa Live Coding para traer una captura como prompt."
  }
];

const isThread = (value: unknown): value is Thread =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Thread).id === "string" &&
      typeof (value as Thread).title === "string" &&
      typeof (value as Thread).preview === "string"
  );

const isMessage = (value: unknown): value is ChatMessage =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ChatMessage).id === "string" &&
      typeof (value as ChatMessage).role === "string" &&
      typeof (value as ChatMessage).body === "string"
  );

const buildSnapshot = (input: PersistedWorkbenchSnapshot): PersistedWorkbenchSnapshot => ({
  ...input,
  threads: input.threads.length ? input.threads : initialThreads,
  messagesByThread: Object.keys(input.messagesByThread).length ? input.messagesByThread : { [initialThreads[0].id]: defaultMessages }
});

const readSnapshot = (value: unknown): PersistedWorkbenchSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PersistedWorkbenchSnapshot> & {
    messages?: unknown[];
  };
  const messagesByThread =
    candidate.messagesByThread && typeof candidate.messagesByThread === "object"
      ? Object.entries(candidate.messagesByThread).reduce<ThreadMessages>((accumulator, [threadId, messages]) => {
          accumulator[threadId] = Array.isArray(messages) ? messages.filter(isMessage) : [];
          return accumulator;
        }, {})
      : {};

  const legacyMessages = Array.isArray(candidate.messages) ? candidate.messages.filter(isMessage) : defaultMessages;

  return buildSnapshot({
    theme: candidate.theme === "light" ? "light" : "dark",
    activeMode:
      candidate.activeMode === "live" || candidate.activeMode === "cocoding" ? candidate.activeMode : "chat",
    threads: Array.isArray(candidate.threads) ? candidate.threads.filter(isThread) : initialThreads,
    messagesByThread: {
      [initialThreads[0].id]: legacyMessages,
      ...messagesByThread
    },
    activeThreadId:
      typeof candidate.activeThreadId === "string" && candidate.activeThreadId
        ? candidate.activeThreadId
        : initialThreads[0].id,
    activeTool: typeof candidate.activeTool === "string" ? candidate.activeTool : "new",
    sidebarCollapsed: typeof candidate.sidebarCollapsed === "boolean" ? candidate.sidebarCollapsed : false,
    rightPanelOpen: typeof candidate.rightPanelOpen === "boolean" ? candidate.rightPanelOpen : true,
    profileOpen: typeof candidate.profileOpen === "boolean" ? candidate.profileOpen : false,
    searchOpen: typeof candidate.searchOpen === "boolean" ? candidate.searchOpen : false,
    webEnabled: typeof candidate.webEnabled === "boolean" ? candidate.webEnabled : false,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    phase:
      candidate.phase === "requesting" ||
      candidate.phase === "recording" ||
      candidate.phase === "stopping" ||
      candidate.phase === "ready" ||
      candidate.phase === "analyzing"
        ? candidate.phase
        : "idle",
    status: typeof candidate.status === "string" ? candidate.status : "Listo para crear.",
    model: typeof candidate.model === "string" && candidate.model ? candidate.model : "gemini-3.5-flash",
    notes: typeof candidate.notes === "string" ? candidate.notes : defaultNotes,
    recordingName:
      typeof candidate.recordingName === "string" && candidate.recordingName
        ? candidate.recordingName
        : "cocreate-live-coding",
    savedRecording:
      candidate.savedRecording &&
      typeof candidate.savedRecording === "object" &&
      typeof candidate.savedRecording.filePath === "string" &&
      typeof candidate.savedRecording.fileSize === "number"
        ? candidate.savedRecording
        : null,
    lastMimeType: typeof candidate.lastMimeType === "string" ? candidate.lastMimeType : "video/webm",
    error: typeof candidate.error === "string" ? candidate.error : ""
  });
};

export function CoCreateExperience() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const hasHydratedRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const clientIdRef = useRef("");
  const codexAdapterRef = useRef<ReturnType<typeof createCodexAdapter> | null>(null);
  if (!codexAdapterRef.current) {
    codexAdapterRef.current = createCodexAdapter();
  }
  const codexExecutionServiceRef = useRef(new CodexExecutionService(codexAdapterRef.current));
  const codexStatusServiceRef = useRef(new CodexStatusService(codexAdapterRef.current));
  const activeExecutionRef = useRef<CodexExecutionHandle | null>(null);

  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [activeMode, setActiveMode] = useState<ActiveMode>("chat");
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [messagesByThread, setMessagesByThread] = useState<ThreadMessages>({ [initialThreads[0].id]: defaultMessages });
  const [activeThreadId, setActiveThreadId] = useState(initialThreads[0].id);
  const [activeTool, setActiveTool] = useState("new");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [webEnabled, setWebEnabled] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [status, setStatus] = useState("Listo para crear.");
  const [model, setModel] = useState("gemini-3.5-flash");
  const [notes, setNotes] = useState(defaultNotes);
  const [recordingName, setRecordingName] = useState("cocreate-live-coding");
  const [savedRecording, setSavedRecording] = useState<SaveRecordingResult | null>(null);
  const [lastMimeType, setLastMimeType] = useState("video/webm");
  const [isListening, setIsListening] = useState(false);
  const [isRunningCodex, setIsRunningCodex] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
  const messages = messagesByThread[activeThreadId] ?? defaultMessages;
  const isRecording = phase === "recording";
  const canAnalyze = Boolean(savedRecording?.filePath && phase !== "analyzing");
  const codexReady = Boolean(codexStatus?.available);

  useEffect(() => {
    let cancelled = false;
    clientIdRef.current = getWebClientId();

    const bootstrap = async () => {
      if (!window.overlayBridge) {
        try {
          const persisted = await loadWebState<PersistedWorkbenchSnapshot>("workbench", clientIdRef.current);
          if (cancelled) return;

          const snapshot = readSnapshot(persisted.snapshot);
          if (snapshot) {
            setTheme(snapshot.theme);
            setActiveMode(snapshot.activeMode);
            setThreads(snapshot.threads);
            setMessagesByThread(snapshot.messagesByThread);
            setActiveThreadId(snapshot.activeThreadId);
            setActiveTool(snapshot.activeTool);
            setSidebarCollapsed(snapshot.sidebarCollapsed);
            setRightPanelOpen(snapshot.rightPanelOpen);
            setProfileOpen(snapshot.profileOpen);
            setSearchOpen(snapshot.searchOpen);
            setWebEnabled(true);
            setPrompt(snapshot.prompt);
            setPhase(snapshot.phase === "recording" ? "idle" : snapshot.phase);
            setStatus("Sesión web restaurada.");
            setModel(snapshot.model || "gemini-3.5-flash");
            setNotes(snapshot.notes);
            setRecordingName(snapshot.recordingName);
            setSavedRecording(snapshot.savedRecording);
            setLastMimeType(snapshot.lastMimeType);
            setError(snapshot.error);
          } else {
            setStatus("Modo browser activo. Electron habilita Live Coding completo.");
          }
        } catch {
          if (!cancelled) {
            setStatus("Modo browser activo. Electron habilita Live Coding completo.");
          }
        } finally {
          if (!cancelled) {
            hasHydratedRef.current = true;
          }
        }
        return;
      }

      try {
        const payload = await window.overlayBridge.getConfig();
        if (cancelled) return;
        setConfig(payload);
        setCodexStatus(payload.codex);
        setModel(payload.defaultGeminiModel);

        const persisted = await window.overlayBridge.getAppState();
        if (cancelled) return;
        setSessionId(persisted.session?.id ?? null);

        const snapshot = readSnapshot(persisted.session?.renderer?.workbench);
        if (snapshot) {
          setTheme(snapshot.theme);
          setActiveMode(snapshot.activeMode);
          setThreads(snapshot.threads);
          setMessagesByThread(snapshot.messagesByThread);
          setActiveThreadId(snapshot.activeThreadId);
          setActiveTool(snapshot.activeTool);
          setSidebarCollapsed(snapshot.sidebarCollapsed);
          setRightPanelOpen(snapshot.rightPanelOpen);
          setProfileOpen(snapshot.profileOpen);
          setSearchOpen(snapshot.searchOpen);
          setWebEnabled(snapshot.webEnabled);
          setPrompt(snapshot.prompt);
          setPhase(snapshot.phase === "recording" ? "idle" : snapshot.phase);
          setStatus("Sesión restaurada. Listo para continuar.");
          setModel(snapshot.model || payload.defaultGeminiModel);
          setNotes(snapshot.notes);
          setRecordingName(snapshot.recordingName);
          setSavedRecording(snapshot.savedRecording);
          setLastMimeType(snapshot.lastMimeType);
          setError(snapshot.error);
        }
      } catch {
        if (!cancelled) {
          setStatus("Modo browser activo. Electron habilita Live Coding completo.");
        }
      } finally {
        hasHydratedRef.current = true;
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      void codexExecutionServiceRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    window.localStorage.removeItem("caleidoscopio-gemini-api-key");
  }, []);

  useEffect(() => {
    return () => {
      stopTracks(streamRef.current);
      audioRecorderRef.current?.stop();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.stop();
      if (previewRef.current) previewRef.current.srcObject = null;
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    const snapshot = buildSnapshot({
      theme,
      activeMode,
      threads,
      messagesByThread,
      activeThreadId,
      activeTool,
      sidebarCollapsed,
      rightPanelOpen,
      profileOpen,
      searchOpen,
      webEnabled,
      prompt,
      phase: phase === "recording" ? "ready" : phase,
      status,
      model,
      notes,
      recordingName,
      savedRecording,
      lastMimeType,
      error
    });

    persistTimerRef.current = window.setTimeout(() => {
      if (window.overlayBridge?.saveRendererState) {
        void window.overlayBridge
          .saveRendererState({
            title: activeThread?.title ?? "Workspace principal",
            snapshot
          })
          .then((result) => {
            if (result?.sessionId) {
              setSessionId(result.sessionId);
            }
          })
          .catch(() => {});
        return;
      }

      if (clientIdRef.current) {
        void saveWebState("workbench", clientIdRef.current, snapshot).catch(() => {});
      }
    }, 350);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [
    activeMode,
    activeThread?.title,
    activeThreadId,
    activeTool,
    error,
    lastMimeType,
    messagesByThread,
    model,
    notes,
    phase,
    profileOpen,
    prompt,
    recordingName,
    rightPanelOpen,
    sidebarCollapsed,
    savedRecording,
    searchOpen,
    status,
    theme,
    threads,
    webEnabled
  ]);

  const appendEvent = (type: string, payload: Record<string, unknown> = {}) => {
    void window.overlayBridge?.appendAppEvent?.({
      type,
      source: "renderer",
      payload: {
        sessionId,
        ...payload
      }
    });
  };

  const appendMessage = (role: MessageRole, body: string) => {
    setMessagesByThread((current) => ({
      ...current,
      [activeThreadId]: [...(current[activeThreadId] ?? []), { id: createId(), role, body }]
    }));
  };

  const appendMessageToThread = (threadId: string, role: MessageRole, body: string, id = createId()) => {
    setMessagesByThread((current) => ({
      ...current,
      [threadId]: [...(current[threadId] ?? []), { id, role, body }]
    }));
    return id;
  };

  const replaceMessageBody = (threadId: string, messageId: string, body: string) => {
    setMessagesByThread((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).map((message) =>
        message.id === messageId
          ? {
              ...message,
              body
            }
          : message
      )
    }));
  };

  const createThread = () => {
    const nextId = createId();
    const next: Thread = {
      id: nextId,
      title: "Nuevo chat",
      preview: "Sin mensajes todavía"
    };
    setThreads((current) => [next, ...current]);
    setActiveThreadId(next.id);
    setSidebarCollapsed(false);
    setPrompt("");
    setMessagesByThread((current) => ({
      ...current,
      [nextId]: [
        {
          id: createId(),
          role: "assistant",
          body: "Nuevo chat creado. Puedo ayudarte a diseñar, codear, revisar o convertir una captura en prompt."
        }
      ]
    }));
    setStatus("Nuevo chat creado.");
    appendEvent("thread.created", { threadId: next.id, title: next.title });
  };

  const handleNavAction = (id: string) => {
    setActiveTool(id);
    if (id === "new") createThread();
    if (id === "search") setSearchOpen((value) => !value);
    if (id === "images") appendMessage("system", "Herramienta de imágenes activada para esta conversación.");
    if (id === "addons") setRightPanelOpen(true);
    if (id === "more") setProfileOpen((value) => !value);
    if (!["new", "search", "images", "addons", "more"].includes(id)) {
      setStatus(`${leftNav.find((item) => item.id === id)?.label ?? "Herramienta"} abierto.`);
      setRightPanelOpen(true);
    }
    appendEvent("nav.action", { id });
  };

  const refreshCodexStatus = async () => {
    try {
      const next = await codexStatusServiceRef.current.refreshStatus();
      setCodexStatus(next);
      setStatus(next.available ? "Codex CLI detectado." : next.error ?? "Codex CLI no está disponible en PATH.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pude consultar el estado de Codex.";
      setError(message);
      setStatus("No pude consultar el estado de Codex.");
    }
  };

  const analyzeSavedRecording = async (saved: SaveRecordingResult, mimeType: string) => {
    setPhase("analyzing");
    setStatus("Analizando captura con Gemini.");
    setError("");

    try {
      const result = await window.overlayBridge?.analyzeRecording({
        model,
        notes,
        filePath: saved.filePath,
        mimeType
      });

      if (!result) throw new Error("Gemini no devolvió un resultado.");
      insertLiveCodingPrompt(result);
      appendEvent("analysis.generated", {
        model: result.model,
        fileName: result.fileName
      });
      setPhase("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude analizar la captura.");
      setPhase("ready");
    }
  };

  const insertLiveCodingPrompt = (result: AnalysisResult) => {
    setPrompt(result.output);
    appendMessage("assistant", "Live Coding generó un prompt desde la captura y lo insertó en la barra de código.");
    setStatus("Prompt de Live Coding insertado.");
  };

  const startLiveCoding = async () => {
    setActiveMode("live");
    setRightPanelOpen(true);
    setError("");

    if (!window.overlayBridge) {
      setStatus("Abre CoCreate en Electron para guardar y analizar capturas.");
    }

    setPhase("requesting");
    setStatus("Elige una pantalla o ventana para Live Coding.");
    appendEvent("live.start.requested", {
      compareEnabled: config?.featureFlags.liveCompare ?? false,
      realtimeChunksEnabled: config?.featureFlags.realtimeChunks ?? false
    });

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true
      });
      const mimeType = inferMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });

      streamRef.current = stream;
      recorderRef.current = recorder;
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
        setStatus("Guardando captura.");

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const saved = await window.overlayBridge?.saveRecording({
            buffer: new Uint8Array(arrayBuffer),
            mimeType,
            suggestedName: recordingName
          });

          if (!saved) throw new Error("No pude guardar la grabación en Electron.");
          setSavedRecording(saved);
          await analyzeSavedRecording(saved, mimeType);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "No pude guardar la captura.");
          setPhase("idle");
        } finally {
          stopTracks(streamRef.current);
          streamRef.current = null;
          if (previewRef.current) previewRef.current.srcObject = null;
        }
      };

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      });

      recorder.start(1000);
      setPhase("recording");
      setStatus("Live Coding grabando pantalla y audio.");
      appendEvent("live.recording.started", { mimeType });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pude iniciar Live Coding.");
      setPhase("idle");
      stopTracks(streamRef.current);
    }
  };

  const stopLiveCoding = () => {
    if (recorderRef.current?.state === "recording") {
      setStatus("Deteniendo Live Coding.");
      appendEvent("live.recording.stopping");
      recorderRef.current.stop();
    }
  };

  const toggleLiveCoding = () => {
    if (isRecording) stopLiveCoding();
    else startLiveCoding();
  };

  const runManualAnalysis = async () => {
    if (!savedRecording) return;
    await analyzeSavedRecording(savedRecording, lastMimeType);
  };

  const toggleCoCoding = () => {
    const nextMode = activeMode === "cocoding" ? "chat" : "cocoding";
    setActiveMode(nextMode);
    setRightPanelOpen(true);
    setStatus(nextMode === "cocoding" ? "Co-Coding activo." : "Co-Coding pausado.");
    appendMessage("system", nextMode === "cocoding" ? "Co-Coding activo con 4 participantes." : "Co-Coding pausado.");
    appendEvent("cocoding.toggled", { active: nextMode === "cocoding" });
  };

  const toggleVoice = () => {
    if (isListening) {
      if (audioRecorderRef.current?.state === "recording") {
        setStatus("Procesando nota de voz.");
        audioRecorderRef.current.stop();
        return;
      }
      recognitionRef.current?.stop();
      setIsListening(false);
      setStatus("Dictado pausado.");
      appendEvent("voice.stopped");
      return;
    }

    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      void startRecordedVoiceFallback();
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "es-CO";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) setPrompt((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => {
      setIsListening(false);
      void startRecordedVoiceFallback();
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setStatus("Dictado activo.");
    appendEvent("voice.started");
  };

  const startRecordedVoiceFallback = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });

      audioStreamRef.current = stream;
      audioRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsListening(false);
        stream.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;

        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          const audioBase64 = btoa(
            new Uint8Array(arrayBuffer).reduce((acc, value) => acc + String.fromCharCode(value), "")
          );

          const result = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              audioBase64,
              mimeType,
              language: "es"
            })
          }).then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error ?? "No pude transcribir la nota de voz.");
            }
            return payload;
          });

          if (typeof result.text === "string" && result.text.trim()) {
            setPrompt((current) => `${current}${current ? " " : ""}${result.text.trim()}`);
            setStatus("Nota de voz transcrita.");
            appendEvent("voice.transcribed", {
              provider: result.provider ?? "api"
            });
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "No pude capturar la nota de voz.";
          setStatus(message);
          appendMessage("assistant", message);
          appendEvent("voice.error", { message });
        }
      };

      recorder.start();
      setIsListening(true);
      setStatus("Grabando nota de voz. Pulsa otra vez para detener.");
      appendEvent("voice.recording.started");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pude capturar la nota de voz.";
      setStatus(message);
      appendMessage("assistant", message);
      appendEvent("voice.error", { message });
    }
  };

  const cancelPromptExecution = async () => {
    const activeExecution = activeExecutionRef.current;
    if (!activeExecution) {
      return;
    }

    setStatus("Cancelando ejecución de Codex.");
    await codexExecutionServiceRef.current.cancelExecution(activeExecution.executionId, "user-requested");
  };

  const sendPrompt = async () => {
    if (isRunningCodex) {
      await cancelPromptExecution();
      return;
    }

    const text = prompt.trim();
    if (!text) return;
    const targetThreadId = activeThreadId;
    const assistantMessageId = createId();
    let streamedOutput = "";

    appendMessage("user", text);
    appendMessageToThread(targetThreadId, "assistant", "", assistantMessageId);
    appendEvent("prompt.submitted", {
      threadId: targetThreadId,
      activeMode,
      promptPreview: text.slice(0, 280)
    });
    setThreads((current) =>
      current.map((thread) =>
        thread.id === targetThreadId
          ? {
              ...thread,
              title: thread.title === "Nuevo chat" ? text.slice(0, 36) : thread.title,
              preview: text.slice(0, 72)
            }
          : thread
      )
    );

    setPrompt("");
    setError("");
    window.overlayBridge?.copyText(text);

    setIsRunningCodex(true);
    setStatus(window.overlayBridge ? "Codex está ejecutando el prompt." : "CoCreate Web está respondiendo.");

    try {
      const handle = await codexExecutionServiceRef.current.executePrompt(
        {
          prompt: text,
          origin: window.overlayBridge ? "desktop-renderer" : "web-renderer",
          metadata: {
            clientId: clientIdRef.current,
            history: messages
          }
        },
        (event: CodexExecutionEvent) => {
          switch (event.type) {
            case "execution.started":
              setStatus(window.overlayBridge ? "Codex está ejecutando el prompt." : "CoCreate Web está respondiendo.");
              break;
            case "execution.output":
              streamedOutput += event.chunk;
              replaceMessageBody(targetThreadId, assistantMessageId, streamedOutput.trimStart());
              break;
            case "execution.progress":
              if (event.message.trim()) {
                setStatus(event.message.trim());
              }
              break;
            case "execution.completed":
              replaceMessageBody(targetThreadId, assistantMessageId, event.output);
              setStatus(window.overlayBridge ? "Codex terminó la ejecución." : "CoCreate Web respondió.");
              break;
            case "execution.cancelled":
              replaceMessageBody(
                targetThreadId,
                assistantMessageId,
                streamedOutput.trim() || "Ejecución cancelada por el usuario."
              );
              setStatus("Ejecución cancelada.");
              break;
            case "execution.failed":
              replaceMessageBody(
                targetThreadId,
                assistantMessageId,
                streamedOutput.trim() || event.error.safeMessage
              );
              setError(event.error.safeMessage);
              setStatus("Codex no pudo completar la ejecución.");
              break;
            case "codex.statusChanged":
              setCodexStatus(event.status);
              break;
          }
        }
      );

      activeExecutionRef.current = handle;
      const terminalEvent = await handle.completed;

      if (terminalEvent.type === "execution.completed") {
        appendEvent("codex.completed", {
          ok: true,
          executionId: terminalEvent.executionId,
          outputPreview: terminalEvent.output.slice(0, 280)
        });
      } else if (terminalEvent.type === "execution.cancelled") {
        appendEvent("codex.cancelled", {
          executionId: terminalEvent.executionId,
          reason: terminalEvent.reason ?? "user-requested"
        });
      } else {
        appendEvent("codex.failed", {
          executionId: terminalEvent.executionId,
          message: terminalEvent.error.safeMessage
        });
      }

      if (window.overlayBridge) {
        await refreshCodexStatus();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Codex no pudo ejecutar el prompt.";
      setError(message);
      replaceMessageBody(targetThreadId, assistantMessageId, message);
      setStatus("Codex no pudo completar la ejecución.");
      appendEvent("codex.failed", { message });
    } finally {
      activeExecutionRef.current = null;
      setIsRunningCodex(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files);
    setAttachments((current) => [...current, ...nextFiles]);
    appendMessage("system", `Adjuntaste ${nextFiles.map((file) => file.name).join(", ")}.`);
    appendEvent("attachments.added", {
      count: nextFiles.length,
      names: nextFiles.map((file) => file.name)
    });
  };

  return (
    <main className={`workspace workspace-${theme} ${sidebarCollapsed ? "workspace-sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-top">
          <div className="sidebar-header">
            <button className="brand-mark" type="button" onClick={createThread} title="CoCreate">
              <span className="brand-orbit" />
              {!sidebarCollapsed ? <strong>CoCreate</strong> : null}
            </button>
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              title={sidebarCollapsed ? "Abrir barra lateral" : "Cerrar barra lateral"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          <nav className="primary-nav" aria-label="Navegación principal">
            {leftNav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={activeTool === item.id ? "nav-item active" : "nav-item"}
                  type="button"
                  onClick={() => handleNavAction(item.id)}
                  title={item.label}
                >
                  <Icon size={17} />
                  {!sidebarCollapsed ? <span>{item.label}</span> : null}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="recent-panel">
          {!sidebarCollapsed ? <div className="rail-label">Conversaciones</div> : null}
          {searchOpen ? (
            <label className="sidebar-search">
              <Search size={15} />
              {!sidebarCollapsed ? <input placeholder="Buscar..." autoFocus /> : null}
            </label>
          ) : null}
          <div className="thread-list">
            {threads.map((thread) => (
              <button
                key={thread.id}
                className={activeThreadId === thread.id ? "thread-button active" : "thread-button"}
                type="button"
                onClick={() => setActiveThreadId(thread.id)}
                title={thread.title}
              >
                <LayoutPanelLeft size={16} />
                {!sidebarCollapsed ? (
                  <>
                    <span>{thread.title}</span>
                    <small>{thread.preview}</small>
                  </>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="profile-zone">
          <button className="upgrade-button" type="button" onClick={() => setActiveTool("plan")}>
            <Sparkles size={15} />
            {!sidebarCollapsed ? "Mejorar plan" : null}
          </button>
          <button className="profile-button" type="button" onClick={() => setProfileOpen((value) => !value)}>
            <span className="avatar">M</span>
            {!sidebarCollapsed ? <span>Martin</span> : null}
            {!sidebarCollapsed ? <ChevronDown size={14} /> : null}
          </button>
          {profileOpen ? (
            <div className="profile-menu">
              <button type="button">
                <User size={15} />
                Perfil
              </button>
              <button type="button">
                <Wand2 size={15} />
                Personalizar
              </button>
              <button type="button">
                <Settings size={15} />
                Configuración
              </button>
              <button type="button">
                <CircleHelp size={15} />
                Ayuda
              </button>
              <button type="button">
                <LogOut size={15} />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="app-surface">
        <header className="workspace-topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            title={sidebarCollapsed ? "Abrir barra lateral" : "Cerrar barra lateral"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <div className="thread-heading">
            <span>{activeMode === "chat" ? "Chat" : activeMode === "live" ? "Live Coding" : "Co-Coding"}</span>
            <strong>{activeThread.title}</strong>
          </div>

          <div className="top-actions">
            <button
              className={activeMode === "live" ? "mode-button active" : "mode-button"}
              type="button"
              onClick={toggleLiveCoding}
              title={isRecording ? "Detener Live Coding" : "Iniciar Live Coding"}
            >
              {isRecording ? <Square size={16} /> : <Share2 size={16} />}
              <span>Live</span>
            </button>
            <button
              className={activeMode === "cocoding" ? "mode-button active" : "mode-button"}
              type="button"
              onClick={toggleCoCoding}
              title="Co-Coding"
            >
              <Users size={16} />
              <span>Co-Coding</span>
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
            >
              {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setRightPanelOpen((value) => !value)}
              title="Herramientas"
            >
              <PanelRightOpen size={16} />
            </button>
          </div>
        </header>

        <main className="conversation">
          <div className="conversation-inner">
            <div className="assistant-symbol">
              <Code2 size={25} />
            </div>

            <div className="message-stack">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  {message.body}
                </article>
              ))}
            </div>
          </div>
        </main>

        <section className="composer-shell">
          {attachments.length ? (
            <div className="attachment-row">
              {attachments.map((file) => (
                <span key={`${file.name}-${file.size}`}>{file.name}</span>
              ))}
            </div>
          ) : null}

          <label className="composer-panel">
            <textarea
              rows={4}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask CoCreate to build, change, debug, or explain..."
            />
          </label>

          <div className="composer-footer">
            <div className="left-tools">
              <input
                ref={fileInputRef}
                className="hidden-file"
                type="file"
                multiple
                onChange={(event) => handleFiles(event.target.files)}
              />
              <button type="button" title="Adjuntar archivos" onClick={() => fileInputRef.current?.click()}>
                <Paperclip size={17} />
              </button>
              <button type="button" title="Crear imagen" onClick={() => handleNavAction("images")}>
                <ImagePlus size={17} />
              </button>
              <button
                className={webEnabled ? "active" : ""}
                type="button"
                title="Buscar en web"
                onClick={() => {
                  setWebEnabled((value) => !value);
                  setStatus(webEnabled ? "Búsqueda web desactivada." : "Búsqueda web activada para este prompt.");
                }}
              >
                <Compass size={17} />
              </button>
              <button
                className={isListening ? "active" : ""}
                type="button"
                title={isListening ? "Pausar nota de voz" : "Nota de voz"}
                onClick={toggleVoice}
              >
                <Mic size={17} />
              </button>
            </div>

            <div className="right-tools">
              <button
                className={activeMode === "cocoding" ? "tool-pill active" : "tool-pill"}
                type="button"
                onClick={toggleCoCoding}
              >
                <Users size={16} />
                Co-Coding
              </button>
              <button
                className={activeMode === "live" || isRecording ? "tool-pill active" : "tool-pill"}
                type="button"
                onClick={toggleLiveCoding}
                disabled={phase === "requesting" || phase === "analyzing"}
              >
                {isRecording ? <Square size={16} /> : <Share2 size={16} />}
                {isRecording ? "Stop Live" : "Live Coding"}
              </button>
              <button className="send-button" type="button" onClick={sendPrompt} title={isRunningCodex ? "Cancelar" : "Enviar"}>
                {isRunningCodex ? <Square size={17} /> : <Send size={17} />}
              </button>
            </div>
          </div>

          <div className="quick-actions">
            {quickPrompts.map((item) => (
              <button key={item} type="button" onClick={() => setPrompt(item)}>
                {item}
              </button>
            ))}
          </div>
        </section>

        <footer className="statusline">
          <span>{status}</span>
          {error ? <strong>{error}</strong> : null}
        </footer>
      </section>

      {rightPanelOpen ? (
        <aside className="inspector">
          <section className="inspector-section">
            <div className="section-head">
              <span>Modelo</span>
              <strong>{model}</strong>
            </div>
            <label>
              Modelo
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
          </section>

          <section className="inspector-section">
            <div className="section-head">
              <span>Codex</span>
              <strong>{codexReady ? "Conectado" : "Pendiente"}</strong>
            </div>
            <button className="panel-action" type="button" onClick={refreshCodexStatus}>
              <TerminalSquare size={16} />
              Revisar CLI
            </button>
            <small>{codexStatus?.version ?? codexStatus?.error ?? config?.platform ?? "Browser preview"}</small>
          </section>

          <section className="inspector-section">
            <div className="section-head">
              <span>Live Coding</span>
              <strong>{phase}</strong>
            </div>
            <div className="preview-frame">
              <video ref={previewRef} autoPlay playsInline />
              {!isRecording ? <span>Sin captura activa</span> : null}
            </div>
            <div className="panel-actions">
              <button className="panel-action" type="button" onClick={toggleLiveCoding}>
                {isRecording ? <Square size={16} /> : <Share2 size={16} />}
                {isRecording ? "Detener" : "Compartir"}
              </button>
              <button className="panel-action" type="button" onClick={runManualAnalysis} disabled={!canAnalyze}>
                <Sparkles size={16} />
                Analizar
              </button>
            </div>
            <label>
              Nombre
              <input value={recordingName} onChange={(event) => setRecordingName(event.target.value)} />
            </label>
            <label>
              Notas
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} />
            </label>
            <small>{formatBytes(savedRecording?.fileSize ?? null)} · {lastMimeType}</small>
          </section>

          <section className="inspector-section">
            <div className="section-head">
              <span>Co-Coding</span>
              <strong>{activeMode === "cocoding" ? "Activo" : "Listo"}</strong>
            </div>
            <div className="participant-list">
              {collaborators.map((person) => (
                <div key={person} className="participant-row">
                  <span>{person[0]}</span>
                  <strong>{person}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="inspector-section compact">
            <div className="section-head">
              <span>Más</span>
              <strong>{leftNav.find((item) => item.id === activeTool)?.label ?? "Herramientas"}</strong>
            </div>
            <button className="panel-action" type="button">
              <Archive size={16} />
              Biblioteca
            </button>
            <button className="panel-action" type="button">
              <Settings size={16} />
              Configuración
            </button>
          </section>
        </aside>
      ) : null}
    </main>
  );
}
