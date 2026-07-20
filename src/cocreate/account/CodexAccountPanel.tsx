import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, KeyRound, LogIn, Loader2, AlertCircle } from "lucide-react";

type Props = {
  collapsed: boolean;
};

const statusLabel = (status: CodexAuthStatus | null): string => {
  if (!status || status.method === "none") return "Sin conexión a Codex";
  if (status.source === "custom") return "Codex · API key propia";
  if (status.source === "env") return "Codex · API key del proyecto";
  if (status.source === "chatgpt") return "Codex · ChatGPT";
  return "Codex conectado";
};

/**
 * Account / authentication panel for the bottom of the left sidebar.
 *
 * Lets the user (a) sign in with ChatGPT or (b) configure a personal OpenAI API
 * key. If a personal key is set it takes precedence; otherwise the project's
 * .env key is used. All credential handling is delegated to the upstream Codex
 * binary via the main process — this component only calls the bridge and shows
 * the resulting state. Renders nothing outside the desktop (Electron) shell.
 */
export function CodexAccountPanel({ collapsed }: Props) {
  const bridge = typeof window !== "undefined" ? window.overlayBridge : undefined;
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState<null | "chatgpt" | "apikey" | "default">(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!bridge?.getCodexAuthStatus) return;
    try {
      const next = await bridge.getCodexAuthStatus();
      if (mounted.current) setStatus(next);
    } catch {
      /* status is best-effort */
    }
  }, [bridge]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = bridge?.onCodexAuthChanged?.((next) => {
      if (mounted.current) setStatus(next);
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, [bridge, refresh]);

  if (!bridge?.getCodexAuthStatus) return null;

  const run = async (kind: "chatgpt" | "apikey" | "default", action: () => Promise<CodexAuthStatus>) => {
    setBusy(kind);
    setError(null);
    try {
      const next = await action();
      if (mounted.current) {
        setStatus(next);
        if (kind === "apikey") setKeyInput("");
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "No pude completar la operación.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const connected = Boolean(status?.authenticated);

  if (collapsed) {
    return (
      <div className="codex-account codex-account-collapsed" title={statusLabel(status)}>
        <span className={connected ? "codex-account-dot connected" : "codex-account-dot"} aria-hidden />
      </div>
    );
  }

  return (
    <div className="codex-account">
      <button
        type="button"
        className="codex-account-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={connected ? "codex-account-dot connected" : "codex-account-dot"} aria-hidden />
        <span className="codex-account-label">
          <strong>{statusLabel(status)}</strong>
          <small>{connected ? (status?.keyPreview ?? "Sesión activa") : "Conecta para usar Codex"}</small>
        </span>
        <ChevronDown size={15} className={expanded ? "codex-account-chevron open" : "codex-account-chevron"} />
      </button>

      {expanded ? (
        <div className="codex-account-body">
          <button
            type="button"
            className="codex-account-action"
            disabled={busy !== null}
            onClick={() => void run("chatgpt", () => bridge.loginCodexChatgpt())}
          >
            {busy === "chatgpt" ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
            <span>Conectar con ChatGPT</span>
          </button>

          <form
            className="codex-account-key-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!keyInput.trim() || busy !== null) return;
              void run("apikey", () => bridge.loginCodexApiKey({ apiKey: keyInput.trim() }));
            }}
          >
            <label className="codex-account-field">
              <KeyRound size={14} />
              <input
                type="password"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="API key personalizada (sk-…)"
                aria-label="API key personalizada de OpenAI"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" disabled={!keyInput.trim() || busy !== null}>
              {busy === "apikey" ? <Loader2 size={14} className="spin" /> : "Guardar"}
            </button>
          </form>

          <p className="codex-account-hint">
            {status?.hasCustomKey
              ? "Usando tu API key personalizada."
              : status?.hasEnvKey
                ? "Usando la API key del proyecto (.env). Ingresa una key para reemplazarla."
                : "No hay API key configurada. Ingresa una o inicia sesión con ChatGPT."}
          </p>

          {status?.hasCustomKey ? (
            <button
              type="button"
              className="codex-account-secondary"
              disabled={busy !== null}
              onClick={() => void run("default", () => bridge.useDefaultCodexKey())}
            >
              {busy === "default" ? <Loader2 size={14} className="spin" /> : null}
              Usar la API key del proyecto
            </button>
          ) : null}

          {error ? (
            <div className="codex-account-error" role="alert">
              <AlertCircle size={14} /> {error}
            </div>
          ) : connected ? (
            <div className="codex-account-ok">
              <CheckCircle2 size={14} /> Codex está listo.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
