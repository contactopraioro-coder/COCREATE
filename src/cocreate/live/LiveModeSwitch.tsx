import { MessageCircle, Radio } from "lucide-react";
import type { WorkspaceMode } from "../../app/services/live-coding-session-service.js";

type Props = {
  mode: WorkspaceMode;
  liveAvailable: boolean;
  unavailableReason?: string;
  onChange: (mode: WorkspaceMode) => void;
};

export function LiveModeSwitch({ mode, liveAvailable, unavailableReason, onChange }: Props) {
  return (
    <nav className="workspace-mode-switch" aria-label="Modo de trabajo">
      <button type="button" className={mode === "chat" ? "active" : ""} aria-pressed={mode === "chat"} onClick={() => onChange("chat")}>
        <MessageCircle size={14} />
        <span>Chat</span>
      </button>
      <button
        type="button"
        className={mode === "live" ? "active" : ""}
        aria-pressed={mode === "live"}
        disabled={!liveAvailable}
        title={!liveAvailable ? unavailableReason : "Abrir Live"}
        onClick={() => onChange("live")}
      >
        <Radio size={14} />
        <span>Live</span>
      </button>
    </nav>
  );
}
