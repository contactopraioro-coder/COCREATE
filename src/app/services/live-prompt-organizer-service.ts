export type LiveImprovement = {
  title: string;
  body: string;
  status: "complete" | "in_progress";
  isFollowUp: boolean;
};

export type LiveThreadEntry = {
  id: string;
  prompt: string;
  at: string;
  status: "sent" | "done" | "failed";
  response?: string;
};

export type LiveThread = {
  id: string;
  title: string;
  body: string;
  status: "complete" | "in_progress";
  entries: LiveThreadEntry[];
};

export type LiveDispatch = {
  threadId: string;
  entryId: string;
  title: string;
  prompt: string;
  isFollowUp: boolean;
};

type OrganizeFn = (payload: { transcript: string; cursorContext?: string }) => Promise<{ improvements: LiveImprovement[] }>;

// Stable thread key: accent/case-insensitive slug of the title so the same
// improvement maps to the same thread across re-organizations.
const threadKey = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || title.toLowerCase();

/**
 * Segment-driven orchestrator for Live coding (mirrors Miracle-AI's note
 * orchestrator): on each final transcript segment, re-organize the full
 * transcript into titled improvements, then dispatch the ones that just became
 * complete (or that a follow-up revised). Each improvement is a conversation
 * "thread" of prompts + Codex responses.
 */
export class LivePromptOrganizerService {
  private readonly threads = new Map<string, LiveThread>();
  private readonly lastDispatchedBody = new Map<string, string>();
  private autoExecute = true;
  private seq = 0;

  constructor(private readonly organize: OrganizeFn) {}

  setAutoExecute(value: boolean) {
    this.autoExecute = value;
  }

  getThreads(): LiveThread[] {
    return [...this.threads.values()];
  }

  reset() {
    this.threads.clear();
    this.lastDispatchedBody.clear();
  }

  private buildPrompt(improvement: LiveImprovement, cursorContext: string | undefined, isFollowUp: boolean): string {
    const parts = [improvement.body];
    if (cursorContext) parts.push(`\n\nContexto visual: el usuario señalaba ${cursorContext}.`);
    if (isFollowUp) parts.push("\n\n(Es un ajuste sobre un cambio previo de esta misma sección; no rehagas lo demás.)");
    return parts.join("");
  }

  /**
   * Ingest a (final) transcript segment. Returns the current threads and the set
   * of prompts to dispatch to Codex now.
   */
  async ingest(transcript: string, cursorContext?: string): Promise<{ threads: LiveThread[]; dispatch: LiveDispatch[] }> {
    const text = transcript.trim();
    if (!text) return { threads: this.getThreads(), dispatch: [] };

    const { improvements } = await this.organize({ transcript: text, cursorContext });
    const dispatch: LiveDispatch[] = [];

    for (const improvement of improvements) {
      const key = threadKey(improvement.title);
      let thread = this.threads.get(key);
      if (!thread) {
        thread = { id: key, title: improvement.title, body: improvement.body, status: improvement.status, entries: [] };
        this.threads.set(key, thread);
      }
      thread.title = improvement.title;
      thread.body = improvement.body;
      thread.status = improvement.status;

      // Dispatch a title's prompt when it is complete and its body changed since
      // the last dispatch — first completion, or a follow-up revision.
      const previous = this.lastDispatchedBody.get(key);
      if (improvement.status === "complete" && improvement.body !== previous && this.autoExecute) {
        const isFollowUp = previous !== undefined || improvement.isFollowUp;
        const entryId = `${key}-${this.seq++}`;
        const prompt = this.buildPrompt(improvement, cursorContext, isFollowUp);
        thread.entries.push({ id: entryId, prompt, at: new Date().toISOString(), status: "sent" });
        this.lastDispatchedBody.set(key, improvement.body);
        dispatch.push({ threadId: key, entryId, title: thread.title, prompt, isFollowUp });
      }
    }

    return { threads: this.getThreads(), dispatch };
  }

  recordResult(entryId: string, result: { ok: boolean; response?: string }) {
    for (const thread of this.threads.values()) {
      const entry = thread.entries.find((candidate) => candidate.id === entryId);
      if (entry) {
        entry.status = result.ok ? "done" : "failed";
        entry.response = result.response;
        return;
      }
    }
  }
}
