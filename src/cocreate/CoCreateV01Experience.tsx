import {
  Archive,
  Code2,
  LoaderCircle,
  Mic,
  MoonStar,
  PanelLeftClose,
  Plus,
  Search,
  Send,
  Sparkles,
  SunMedium
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./cocreate-v01.css";

type ThemeMode = "dark" | "light";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
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

const recentChats = [
  {
    title: "CoCreate v0.1",
    preview: "Superficie limpia para codear"
  },
  {
    title: "Live Coding concept",
    preview: "Captura de pantalla a prompt"
  },
  {
    title: "UI shell",
    preview: "Tema oscuro y claro"
  },
  {
    title: "Codex bridge",
    preview: "Conectar CLI y ejecución"
  }
];

export function CoCreateV01Experience() {
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [prompt, setPrompt] = useState("");
  const [activeChat, setActiveChat] = useState(recentChats[0].title);
  const [isChatsCollapsed, setIsChatsCollapsed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      body: "Listo. En web ya puedo responder por API y en desktop puedo usar Codex directamente."
    }
  ]);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    return () => {
      audioRecorderRef.current?.stop();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const appendMessage = (role: ChatMessage["role"], body: string) => {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        role,
        body
      }
    ]);
  };

  const sendPrompt = async () => {
    const text = prompt.trim();
    if (!text || isRunning) return;

    setPrompt("");
    appendMessage("user", text);

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
              history: messages
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
      {!isChatsCollapsed ? <aside className="floating-chat-card" aria-label="Chats recientes">
        <div className="chat-card-head">
          <div className="mini-brand">
            <span />
            <strong>CoCreate</strong>
          </div>
          <button
            type="button"
            title="Ocultar chats"
            onClick={() => setIsChatsCollapsed(true)}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>

        <button className="new-chat-button" type="button" title="Nuevo chat">
          <Plus size={15} />
          <span>Nuevo chat</span>
        </button>

        <label className="chat-search">
          <Search size={15} />
          <input placeholder="Buscar chats" />
        </label>

        <div className="chat-list">
          {recentChats.map((chat) => (
            <button
              key={chat.title}
              className={activeChat === chat.title ? "chat-row active" : "chat-row"}
              type="button"
              onClick={() => setActiveChat(chat.title)}
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
      </aside> : null}

      <header className="v01-topbar">
        <button
          className="brand-mark"
          type="button"
          aria-label="Abrir chats de CoCreate"
          onClick={() => setIsChatsCollapsed((value) => !value)}
        >
          <span className="brand-orbit" />
          <strong>CoCreate</strong>
        </button>

        <h1 className="top-title">Code with intent.</h1>

        <div className="topbar-actions">
          <a href="#/workbench">Workbench</a>
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
          {messages.map((message) => (
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
