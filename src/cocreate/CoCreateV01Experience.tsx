import {
  Archive,
  Code2,
  LoaderCircle,
  Mic,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Sparkles,
  SunMedium
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./cocreate-v01.css";
import { getWebClientId, loadWebState, saveWebState } from "./web-persistence";

type ThemeMode = "dark" | "light";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
};
type ChatThread = {
  id: string;
  title: string;
  preview: string;
};
type ThreadMessages = Record<string, ChatMessage[]>;
type V01Snapshot = {
  theme: ThemeMode;
  prompt: string;
  activeChatId: string;
  isChatsCollapsed: boolean;
  threads: ChatThread[];
  messagesByThread: ThreadMessages;
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
    0: {
      transcript: string;
    };
  }>;
};

const getSpeechRecognition = () => {
  const windowWithSpeech = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };

  return windowWithSpeech.SpeechRecognition ?? windowWithSpeech.webkitSpeechRecognition;
};

const defaultThreadId = "v01-default";
const legacyThreadIds = new Set(["v01-main", "v01-live", "v01-ui", "v01-codex"]);
const legacyThreadTitles = new Set(["CoCreate v0.1", "Live Coding concept", "UI shell", "Codex bridge"]);

const defaultThread: ChatThread = {
  id: defaultThreadId,
  title: "Nuevo chat",
  preview: "Sin mensajes todavía"
};

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  body: "Listo. En web ya puedo responder por API y en desktop puedo usar Codex directamente."
};

const createMessageId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function createInitialMessagesByThread() {
  return {
    [defaultThreadId]: [welcomeMessage]
  };
}

function createInitialThreads() {
  return [defaultThread];
}

function isChatMessage(value: unknown): value is ChatMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ChatMessage).id === "string" &&
      typeof (value as ChatMessage).role === "string" &&
      typeof (value as ChatMessage).body === "string"
  );
}

function readV01Snapshot(value: unknown): V01Snapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<V01Snapshot>;
  const rawThreads = Array.isArray(candidate.threads)
    ? candidate.threads.filter(
        (thread): thread is ChatThread =>
          Boolean(
            thread &&
              typeof thread === "object" &&
              typeof (thread as ChatThread).id === "string" &&
              typeof (thread as ChatThread).title === "string" &&
              typeof (thread as ChatThread).preview === "string"
          )
      )
    : createInitialThreads();

  const threads = rawThreads.filter(
    (thread) => !legacyThreadIds.has(thread.id) && !legacyThreadTitles.has(thread.title)
  );

  const fallbackMessages = createInitialMessagesByThread();
  const messagesByThread =
    candidate.messagesByThread && typeof candidate.messagesByThread === "object"
      ? Object.entries(candidate.messagesByThread).reduce<ThreadMessages>((accumulator, [threadId, messages]) => {
          if (legacyThreadIds.has(threadId)) {
            return accumulator;
          }
          accumulator[threadId] = Array.isArray(messages) ? messages.filter(isChatMessage) : [];
          return accumulator;
        }, fallbackMessages)
      : fallbackMessages;

  const safeThreads = threads.length ? threads : createInitialThreads();

  if (!messagesByThread[safeThreads[0]?.id]) {
    messagesByThread[safeThreads[0]?.id] = [welcomeMessage];
  }

  return {
    theme: candidate.theme === "light" ? "light" : "dark",
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    activeChatId:
      typeof candidate.activeChatId === "string" &&
      candidate.activeChatId &&
      !legacyThreadIds.has(candidate.activeChatId)
        ? candidate.activeChatId
        : safeThreads[0].id,
    isChatsCollapsed: typeof candidate.isChatsCollapsed === "boolean" ? candidate.isChatsCollapsed : false,
    threads: safeThreads,
    messagesByThread
  };
}

export function CoCreateV01Experience() {
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const hasHydratedRef = useRef(false);
  const clientIdRef = useRef("");
  const titleGenerationRef = useRef<Set<string>>(new Set());
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [prompt, setPrompt] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>(createInitialThreads);
  const [activeChatId, setActiveChatId] = useState(defaultThreadId);
  const [isChatsCollapsed, setIsChatsCollapsed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messagesByThread, setMessagesByThread] = useState<ThreadMessages>(createInitialMessagesByThread);
  const [isRunning, setIsRunning] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const activeMessages = messagesByThread[activeChatId] ?? [];
  const visibleThreads = threads.filter((thread) => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return `${thread.title} ${thread.preview}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    clientIdRef.current = getWebClientId();

    let cancelled = false;
    void loadWebState<V01Snapshot>("v01", clientIdRef.current)
      .then((payload) => {
        if (cancelled || !payload.snapshot) {
          return;
        }

        const snapshot = readV01Snapshot(payload.snapshot);
        if (!snapshot) {
          return;
        }

        setTheme(snapshot.theme);
        setPrompt(snapshot.prompt);
        setThreads(snapshot.threads);
        setActiveChatId(snapshot.activeChatId);
        setIsChatsCollapsed(snapshot.isChatsCollapsed);
        setMessagesByThread(snapshot.messagesByThread);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          hasHydratedRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      audioRecorderRef.current?.stop();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  const appendMessage = (role: ChatMessage["role"], body: string) => {
    setMessagesByThread((current) => ({
      ...current,
      [activeChatId]: [
        ...(current[activeChatId] ?? []),
        {
          id: createMessageId(),
          role,
          body
        }
      ]
    }));
  };

  useEffect(() => {
    if (!hasHydratedRef.current || !clientIdRef.current) {
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    const snapshot: V01Snapshot = {
      theme,
      prompt,
      activeChatId,
      isChatsCollapsed,
      threads,
      messagesByThread
    };

    persistTimerRef.current = window.setTimeout(() => {
      void saveWebState("v01", clientIdRef.current, snapshot).catch(() => {});
    }, 300);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [activeChatId, isChatsCollapsed, messagesByThread, prompt, theme, threads]);

  const createChat = () => {
    const nextId = createMessageId();
    const nextThread: ChatThread = {
      id: nextId,
      title: "Nuevo chat",
      preview: "Sin mensajes todavía"
    };

    setThreads((current) => [nextThread, ...current]);
    setMessagesByThread((current) => ({
      ...current,
      [nextId]: [
        {
          id: createMessageId(),
          role: "assistant",
          body: "Nuevo chat creado. Cuéntame qué quieres construir o depurar."
        }
      ]
    }));
    setActiveChatId(nextId);
    setPrompt("");
    setChatSearch("");
  };

  const generateThreadTitle = async (threadId: string, promptText: string, history: ChatMessage[]) => {
    if (titleGenerationRef.current.has(threadId)) {
      return;
    }

    titleGenerationRef.current.add(threadId);

    try {
      const response = await fetch("/api/title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: promptText,
          history,
          clientId: clientIdRef.current
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.title !== "string" || !payload.title.trim()) {
        return;
      }

      const title = payload.title.trim().slice(0, 48);
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                title
              }
            : thread
        )
      );
    } catch {
      return;
    } finally {
      titleGenerationRef.current.delete(threadId);
    }
  };

  const sendPrompt = async () => {
    const text = prompt.trim();
    if (!text || isRunning) return;

    const requestHistory = activeMessages;
    const activeThread = threads.find((thread) => thread.id === activeChatId);
    setPrompt("");
    appendMessage("user", text);
    setThreads((current) =>
      current.map((thread) =>
        thread.id === activeChatId
          ? {
              ...thread,
              title: thread.title === "Nuevo chat" ? "Generando título..." : thread.title,
              preview: text.slice(0, 72)
            }
          : thread
      )
    );

    if (activeThread?.title === "Nuevo chat") {
      void generateThreadTitle(activeChatId, text, requestHistory);
    }

    setIsRunning(true);
    try {
      const result = window.overlayBridge?.runCodex
        ? await window.overlayBridge.runCodex({ prompt: text })
        : await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              prompt: text,
              history: requestHistory,
              clientId: clientIdRef.current
            })
          }).then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error ?? "No pude responder desde CoCreate Web.");
            }
            return payload;
          });

      appendMessage("assistant", result.output);
    } catch (cause) {
      appendMessage(
        "assistant",
        cause instanceof Error ? cause.message : "Codex no pudo completar esta ejecución."
      );
    } finally {
      setIsRunning(false);
    }
  };

  const toggleVoiceNote = () => {
    if (isListening) {
      if (audioRecorderRef.current?.state === "recording") {
        audioRecorderRef.current.stop();
        return;
      }
      setIsListening(false);
      return;
    }

    const Recognition = getSpeechRecognition();
    if (Recognition) {
      const recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "es-CO";
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join(" ")
          .trim();

        if (transcript) {
          setPrompt((current) => `${current}${current ? " " : ""}${transcript}`);
        }
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = async () => {
        setIsListening(false);
        await startRecordedVoiceFallback();
      };
      recognition.start();
      setIsListening(true);
      return;
    }

    void startRecordedVoiceFallback();
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
          }
        } catch (cause) {
          appendMessage(
            "assistant",
            cause instanceof Error
              ? cause.message
              : "No pude capturar la nota de voz. Revisa permisos del micrófono."
          );
        }
      };

      recorder.start();
      setIsListening(true);
      appendMessage("assistant", "Escuchando nota de voz. Pulsa el micrófono otra vez para detener y transcribir.");
    } catch (cause) {
      setIsListening(false);
      appendMessage(
        "assistant",
        cause instanceof Error
          ? cause.message
          : "No pude capturar la nota de voz. Revisa permisos del micrófono."
      );
    }
  };

  return (
    <main className={`v01-page v01-${theme}`}>
      {!isChatsCollapsed ? (
        <aside className="floating-chat-card" aria-label="Chats recientes">
          <div className="chat-card-head">
            <div className="mini-brand">
              <span />
              <strong>CoCreate</strong>
            </div>
            <button type="button" title="Ocultar chats" onClick={() => setIsChatsCollapsed(true)}>
              <PanelLeftClose size={15} />
            </button>
          </div>

          <button className="new-chat-button" type="button" title="Nuevo chat" onClick={createChat}>
            <Plus size={15} />
            <span>Nuevo chat</span>
          </button>

          <label className="chat-search">
            <Search size={15} />
            <input
              placeholder="Buscar chats"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
            />
          </label>

          <div className="chat-list">
            {visibleThreads.map((chat) => (
              <button
                key={chat.id}
                className={activeChatId === chat.id ? "chat-row active" : "chat-row"}
                type="button"
                onClick={() => setActiveChatId(chat.id)}
              >
                <Code2 size={15} />
                <span>
                  <strong>{chat.title}</strong>
                  <small>{chat.preview}</small>
                </span>
              </button>
            ))}
          </div>

          <button className="library-link" type="button">
            <Archive size={15} />
            <span>Biblioteca</span>
          </button>
        </aside>
      ) : null}

      <header className="v01-topbar">
        <div className="topbar-left">
          {isChatsCollapsed ? (
            <button
              className="brand-mark"
              type="button"
              aria-label="Abrir chats de CoCreate"
              onClick={() => setIsChatsCollapsed(false)}
            >
              <span className="brand-orbit" />
              <strong>CoCreate</strong>
            </button>
          ) : (
            <button
              className="sidebar-reveal"
              type="button"
              aria-label="Ocultar chats"
              onClick={() => setIsChatsCollapsed(true)}
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        <h1 className="top-title">Code with intent.</h1>

        <div className="topbar-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
          >
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </header>

      <section className="v01-center">
        <div className="composer-shell">
          <label className="composer-panel">
            <textarea
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  sendPrompt();
                }
              }}
              placeholder="Describe what you want to build, change, or debug..."
            />
          </label>

          <div className="composer-footer">
            <span className="composer-hint">⌘ Enter para enviar</span>

            <div className="composer-actions">
              <button
                className={isListening ? "voice-action active" : "voice-action"}
                type="button"
                onClick={toggleVoiceNote}
                title={isListening ? "Escuchando" : "Nota de voz"}
              >
                <Mic size={15} />
              </button>
              <button className="primary-action" type="button" onClick={sendPrompt} disabled={isRunning}>
                {isRunning ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                <span>{isRunning ? "Running" : "Start"}</span>
              </button>
            </div>
          </div>
        </div>

        <section className="conversation-strip" aria-label="Conversación">
          {activeMessages.map((message) => (
            <article key={message.id} className={`v01-message ${message.role}`}>
              {message.body}
            </article>
          ))}
        </section>

        <button className="send-fab" type="button" title="Enviar" onClick={sendPrompt} disabled={isRunning}>
          {isRunning ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
        </button>
      </section>
    </main>
  );
}
