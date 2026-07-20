import { Loader2 } from "lucide-react";

export type CodexTurnActivity = {
  stage: "starting" | "running";
  /** Latest natural-language narration line Codex emitted (replaces the previous). */
  status: string;
};

export const emptyCodexActivity: CodexTurnActivity = { stage: "starting", status: "" };

/**
 * Reduces a live Codex execution event into the running activity state.
 *
 * We only surface Codex's natural-language narration — the lines it prefixes with
 * "codex" (e.g. "Voy a revisar la estructura…", "Encontré un micrositio…"). The
 * raw tool traffic (shell commands prefixed "exec", command output prefixed
 * "succeeded in…", the startup header, token counts) is intentionally dropped so
 * the chat shows a clean, human-readable status that replaces itself as Codex
 * works — mirroring the Codex CLI experience.
 */
export function reduceCodexActivity(
  previous: CodexTurnActivity | null,
  event: { type: string; message?: string }
): CodexTurnActivity {
  const base = previous ?? emptyCodexActivity;
  if (event.type === "execution.started") {
    return { stage: "starting", status: base.status };
  }
  if (event.type === "execution.progress" && typeof event.message === "string") {
    // Codex narration arrives as "codex\n<the message>". Everything else is noise.
    const match = /^codex\r?\n([\s\S]+)$/.exec(event.message);
    if (match) {
      const text = match[1].trim();
      if (text) return { stage: "running", status: text };
    }
    return { ...base, stage: base.status ? "running" : "starting" };
  }
  return base;
}

type Props = {
  activity: CodexTurnActivity;
};

export function CodexActivityCard({ activity }: Props) {
  const label = activity.status || "Iniciando Codex…";
  return (
    <article className="v01-message assistant codex-activity" role="status" aria-live="polite">
      <div className="codex-activity-head">
        <Loader2 size={15} className="codex-activity-spin" aria-hidden />
        <span className="codex-activity-status">{label}</span>
      </div>
    </article>
  );
}
