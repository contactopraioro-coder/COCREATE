import { redactCodexDiagnostic } from "../../../shared/codex-upstream-contracts.js";

export type VisualComparisonMode = "current" | "proposal" | "split" | "overlay";
export type VisualTool = "interact" | "select" | "pointer" | "arrow" | "circle" | "rectangle";
export type VisualProposalStatus = "generating" | "available" | "approved" | "discarded";
export type VisualInstructionSource = "text" | "voice";
export type VisualEnvironment = "desktop" | "web";

export type VisualPoint = { x: number; y: number };
export type VisualBounds = { x: number; y: number; width: number; height: number };

export type VisualSelection = {
  id: string;
  label: string;
  kind: "element" | "region";
  bounds: VisualBounds;
  location: string;
  previewTitle: string;
  createdAt: string;
};

export type VisualAnnotation = {
  id: string;
  kind: "arrow" | "circle" | "rectangle";
  start: VisualPoint;
  end: VisualPoint;
  createdAt: string;
};

export type VisualProposal = {
  id: string;
  sequence: number;
  title: string;
  instruction: string;
  source: VisualInstructionSource;
  selectionLabel: string | null;
  selectionLocation: string | null;
  status: VisualProposalStatus;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VisualTimelineItem = {
  id: string;
  label: string;
  timestamp: string;
  source: "session" | "selection" | "annotation" | "proposal" | "voice";
};

export type VisualViewport = {
  preset: "desktop" | "tablet" | "mobile" | "custom";
  width: number;
  height: number;
};

export type VisualPreviewState = {
  url: string | null;
  title: string;
  history: string[];
  historyIndex: number;
  refreshToken: number;
};

export type VisualCollaborationSnapshot = {
  version: 1;
  sessionId: string | null;
  active: boolean;
  contextKey: string | null;
  startedAt: string | null;
  updatedAt: string;
  persistVersion: number;
  comparisonMode: VisualComparisonMode;
  viewport: VisualViewport;
  tool: VisualTool;
  preview: VisualPreviewState;
  selection: VisualSelection | null;
  hoverBounds: VisualBounds | null;
  pointer: VisualPoint | null;
  annotations: VisualAnnotation[];
  proposals: VisualProposal[];
  activeProposalId: string | null;
  timeline: VisualTimelineItem[];
};

export type VisualCollaborationPersistedSnapshot = Omit<
  VisualCollaborationSnapshot,
  "tool" | "hoverBounds" | "pointer" | "annotations"
>;

export type VisualInstructionContext = {
  mode: "visual-collaboration";
  preview: { title: string; location: string | null; viewport: string };
  selection: { label: string; location: string; kind: "element" | "region" } | null;
  annotations: Array<{ kind: VisualAnnotation["kind"]; start: VisualPoint; end: VisualPoint }>;
  workspace: { project: string | null; task: string | null; conversation: string | null };
};

const DEFAULT_VIEWPORT: VisualViewport = { preset: "desktop", width: 1440, height: 900 };
const EMPTY_PREVIEW: VisualPreviewState = {
  url: null,
  title: "Aplicación actual",
  history: [],
  historyIndex: -1,
  refreshToken: 0
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function normalizedPoint(point: VisualPoint): VisualPoint {
  return { x: clamp(point.x), y: clamp(point.y) };
}

function normalizedBounds(bounds: VisualBounds): VisualBounds {
  const x = clamp(bounds.x);
  const y = clamp(bounds.y);
  return {
    x,
    y,
    width: clamp(bounds.width, 0.01, 1 - x),
    height: clamp(bounds.height, 0.01, 1 - y)
  };
}

function safeText(value: unknown, fallback: string, limit = 180) {
  const redacted = redactCodexDiagnostic(typeof value === "string" ? value : "", limit)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return redacted || fallback;
}

function locationFromBounds(bounds: VisualBounds) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const horizontal = centerX < 0.34 ? "izquierda" : centerX > 0.66 ? "derecha" : "centro";
  const vertical = centerY < 0.34 ? "parte superior" : centerY > 0.66 ? "parte inferior" : "centro";
  return vertical === "centro" && horizontal === "centro" ? "centro de la vista" : `${vertical}, ${horizontal}`;
}

function safePreviewUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function previewTitle(urlValue: string) {
  const url = new URL(urlValue);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return safeText(`${url.host}${path}`, "Aplicación actual", 100);
}

function proposalTitle(instruction: string, sequence: number) {
  const words = instruction.split(/\s+/).filter(Boolean).slice(0, 7).join(" ");
  return safeText(words, `Propuesta ${sequence}`, 72);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function initialSnapshot(): VisualCollaborationSnapshot {
  const timestamp = nowIso();
  return {
    version: 1,
    sessionId: null,
    active: false,
    contextKey: null,
    startedAt: null,
    updatedAt: timestamp,
    persistVersion: 0,
    comparisonMode: "split",
    viewport: { ...DEFAULT_VIEWPORT },
    tool: "interact",
    preview: { ...EMPTY_PREVIEW, history: [] },
    selection: null,
    hoverBounds: null,
    pointer: null,
    annotations: [],
    proposals: [],
    activeProposalId: null,
    timeline: []
  };
}

function isComparisonMode(value: unknown): value is VisualComparisonMode {
  return value === "current" || value === "proposal" || value === "split" || value === "overlay";
}

function isProposalStatus(value: unknown): value is VisualProposalStatus {
  return value === "generating" || value === "available" || value === "approved" || value === "discarded";
}

export function getVisualCollaborationAvailability(
  environment: VisualEnvironment,
  _previewUrl: string | null,
  _applicationOrigin: string | null
) {
  return {
    environment,
    interactivePreview: true,
    regionSelection: true,
    semanticSelection: false,
    screenCapture: true,
    reason: "La captura requiere una elección explícita en el selector seguro del sistema."
  };
}

export class VisualCollaborationService {
  private state = initialSnapshot();

  private touch(persistent: boolean, timestamp = nowIso()) {
    this.state.updatedAt = timestamp;
    if (persistent) this.state.persistVersion += 1;
  }

  private timeline(label: string, source: VisualTimelineItem["source"], timestamp = nowIso()) {
    this.state.timeline.push({ id: id("visual-event"), label: safeText(label, "Actividad visual"), timestamp, source });
    this.state.timeline = this.state.timeline.slice(-80);
  }

  start(contextKey: string, timestamp = nowIso()) {
    const safeContext = safeText(contextKey, "workspace", 240);
    if (!this.state.active || this.state.contextKey !== safeContext) {
      if (this.state.contextKey && this.state.contextKey !== safeContext) {
        this.state.selection = null;
        this.state.proposals = [];
        this.state.activeProposalId = null;
        this.state.timeline = [];
        this.state.preview = { ...EMPTY_PREVIEW, history: [] };
      }
      this.state.sessionId = id("visual-session");
      this.state.startedAt = timestamp;
      this.state.contextKey = safeContext;
      this.state.annotations = [];
      this.state.pointer = null;
      this.state.hoverBounds = null;
      this.timeline("Colaboración visual iniciada", "session", timestamp);
    }
    this.state.active = true;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  end(timestamp = nowIso()) {
    if (this.state.active) this.timeline("Colaboración visual finalizada", "session", timestamp);
    this.state.active = false;
    this.state.tool = "interact";
    this.state.annotations = [];
    this.state.pointer = null;
    this.state.hoverBounds = null;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  setPreviewUrl(value: string, timestamp = nowIso()) {
    const url = safePreviewUrl(value);
    if (!url) return { ok: false as const, error: "Usa una dirección http o https válida." };
    const history = this.state.preview.history.slice(0, this.state.preview.historyIndex + 1);
    if (history[history.length - 1] !== url) history.push(url);
    this.state.preview = {
      url,
      title: previewTitle(url),
      history: history.slice(-20),
      historyIndex: Math.min(history.length - 1, 19),
      refreshToken: this.state.preview.refreshToken + 1
    };
    this.state.selection = null;
    this.timeline(`Vista actual conectada: ${this.state.preview.title}`, "session", timestamp);
    this.touch(true, timestamp);
    return { ok: true as const, snapshot: this.getSnapshot() };
  }

  describeSharedSurface(label: string, timestamp = nowIso()) {
    const title = safeText(label, "Pantalla compartida", 100);
    if (this.state.preview.url === null && this.state.preview.title === title) return this.getSnapshot();
    this.state.preview = {
      ...this.state.preview,
      url: null,
      title,
      refreshToken: this.state.preview.refreshToken + 1
    };
    this.timeline("Pantalla compartida seleccionada", "session", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  navigatePreview(direction: "back" | "forward", timestamp = nowIso()) {
    const offset = direction === "back" ? -1 : 1;
    const index = Math.min(this.state.preview.history.length - 1, Math.max(0, this.state.preview.historyIndex + offset));
    const url = this.state.preview.history[index];
    if (!url || index === this.state.preview.historyIndex) return this.getSnapshot();
    this.state.preview.historyIndex = index;
    this.state.preview.url = url;
    this.state.preview.title = previewTitle(url);
    this.state.preview.refreshToken += 1;
    this.state.selection = null;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  refreshPreview(timestamp = nowIso()) {
    this.state.preview.refreshToken += 1;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  setComparisonMode(mode: VisualComparisonMode, timestamp = nowIso()) {
    this.state.comparisonMode = mode;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  setViewport(viewport: VisualViewport, timestamp = nowIso()) {
    this.state.viewport = {
      preset: viewport.preset,
      width: Math.round(clamp(viewport.width, 320, 2560)),
      height: Math.round(clamp(viewport.height, 480, 1600))
    };
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  setTool(tool: VisualTool) {
    this.state.tool = tool;
    this.state.hoverBounds = null;
    this.state.pointer = tool === "pointer" ? this.state.pointer : null;
    this.touch(false);
    return this.getSnapshot();
  }

  setHover(bounds: VisualBounds | null) {
    this.state.hoverBounds = bounds ? normalizedBounds(bounds) : null;
    this.touch(false);
    return this.getSnapshot();
  }

  select(bounds: VisualBounds, label = "Elemento seleccionado", kind: VisualSelection["kind"] = "region", timestamp = nowIso()) {
    const normalized = normalizedBounds(bounds);
    this.state.selection = {
      id: id("visual-selection"),
      label: safeText(label, "Elemento seleccionado", 80),
      kind,
      bounds: normalized,
      location: locationFromBounds(normalized),
      previewTitle: this.state.preview.title,
      createdAt: timestamp
    };
    this.timeline(`${this.state.selection.label} seleccionado`, "selection", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  renameSelection(label: string, timestamp = nowIso()) {
    if (!this.state.selection) return this.getSnapshot();
    this.state.selection.label = safeText(label, "Elemento seleccionado", 80);
    this.timeline(`Selección nombrada: ${this.state.selection.label}`, "selection", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  clearSelection(timestamp = nowIso()) {
    this.state.selection = null;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  movePointer(point: VisualPoint | null) {
    this.state.pointer = point ? normalizedPoint(point) : null;
    this.touch(false);
    return this.getSnapshot();
  }

  addAnnotation(kind: VisualAnnotation["kind"], start: VisualPoint, end: VisualPoint, timestamp = nowIso()) {
    this.state.annotations.push({ id: id("visual-annotation"), kind, start: normalizedPoint(start), end: normalizedPoint(end), createdAt: timestamp });
    this.state.annotations = this.state.annotations.slice(-30);
    this.timeline("Anotación temporal añadida", "annotation", timestamp);
    this.touch(false, timestamp);
    return this.getSnapshot();
  }

  clearAnnotations() {
    this.state.annotations = [];
    this.touch(false);
    return this.getSnapshot();
  }

  beginProposal(instruction: string, source: VisualInstructionSource, timestamp = nowIso()) {
    const safeInstruction = safeText(instruction, "Nueva propuesta visual", 4_000);
    const sequence = this.state.proposals.length + 1;
    const proposal: VisualProposal = {
      id: id("visual-proposal"),
      sequence,
      title: proposalTitle(safeInstruction, sequence),
      instruction: safeInstruction,
      source,
      selectionLabel: this.state.selection?.label ?? null,
      selectionLocation: this.state.selection?.location ?? null,
      status: "generating",
      summary: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.state.proposals.push(proposal);
    this.state.proposals = this.state.proposals.slice(-30);
    this.state.activeProposalId = proposal.id;
    this.timeline(source === "voice" ? "Propuesta de voz en preparación" : "Propuesta visual en preparación", source === "voice" ? "voice" : "proposal", timestamp);
    this.touch(true, timestamp);
    return { proposal: clone(proposal), snapshot: this.getSnapshot() };
  }

  completeProposal(proposalId: string, summary: string, timestamp = nowIso()) {
    const proposal = this.state.proposals.find((entry) => entry.id === proposalId);
    if (!proposal) return this.getSnapshot();
    proposal.status = "available";
    proposal.summary = safeText(summary, "La propuesta está lista para revisar.", 2_000);
    proposal.updatedAt = timestamp;
    this.timeline("Propuesta visual disponible", "proposal", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  failProposal(proposalId: string, reason: string, timestamp = nowIso()) {
    const proposal = this.state.proposals.find((entry) => entry.id === proposalId);
    if (!proposal) return this.getSnapshot();
    proposal.status = "discarded";
    proposal.summary = safeText(reason, "No fue posible preparar la propuesta.", 500);
    proposal.updatedAt = timestamp;
    this.timeline("La propuesta no pudo completarse", "proposal", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  decideProposal(proposalId: string, decision: "approve" | "discard", timestamp = nowIso()) {
    const proposal = this.state.proposals.find((entry) => entry.id === proposalId);
    if (!proposal || proposal.status === "generating") return this.getSnapshot();
    proposal.status = decision === "approve" ? "approved" : "discarded";
    proposal.updatedAt = timestamp;
    this.timeline(decision === "approve" ? "Idea aprobada para el siguiente paso" : "Propuesta descartada", "proposal", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  selectProposal(proposalId: string, timestamp = nowIso()) {
    if (!this.state.proposals.some((entry) => entry.id === proposalId)) return this.getSnapshot();
    this.state.activeProposalId = proposalId;
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  undoProposal(timestamp = nowIso()) {
    const activeIndex = this.state.proposals.findIndex((entry) => entry.id === this.state.activeProposalId);
    const index = activeIndex >= 0 ? activeIndex : this.state.proposals.length - 1;
    if (index <= 0) return this.getSnapshot();
    this.state.activeProposalId = this.state.proposals[index - 1].id;
    this.timeline("Se restauró la iteración anterior", "proposal", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  discardActiveProposal(timestamp = nowIso()) {
    const proposal = this.state.proposals.find((entry) => entry.id === this.state.activeProposalId) ?? this.state.proposals[this.state.proposals.length - 1];
    if (!proposal) return this.getSnapshot();
    proposal.status = "discarded";
    proposal.updatedAt = timestamp;
    this.timeline("Propuesta descartada", "proposal", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  discardSession(timestamp = nowIso()) {
    this.state.proposals = [];
    this.state.activeProposalId = null;
    this.state.selection = null;
    this.state.annotations = [];
    this.timeline("Borrador Live descartado", "proposal", timestamp);
    this.touch(true, timestamp);
    return this.getSnapshot();
  }

  buildInstructionContext(workspace: { project?: string | null; task?: string | null; conversation?: string | null }): VisualInstructionContext {
    return {
      mode: "visual-collaboration",
      preview: {
        title: this.state.preview.title,
        location: this.state.preview.url,
        viewport: `${this.state.viewport.width}x${this.state.viewport.height}`
      },
      selection: this.state.selection ? {
        label: this.state.selection.label,
        location: this.state.selection.location,
        kind: this.state.selection.kind
      } : null,
      annotations: this.state.annotations.map((annotation) => ({
        kind: annotation.kind,
        start: annotation.start,
        end: annotation.end
      })).slice(-12),
      workspace: {
        project: workspace.project ? safeText(workspace.project, "Proyecto", 100) : null,
        task: workspace.task ? safeText(workspace.task, "Tarea", 100) : null,
        conversation: workspace.conversation ? safeText(workspace.conversation, "Conversación", 100) : null
      }
    };
  }

  serialize(): VisualCollaborationPersistedSnapshot {
    const { tool: _tool, hoverBounds: _hover, pointer: _pointer, annotations: _annotations, ...persisted } = this.state;
    return clone(persisted);
  }

  restore(value: unknown) {
    if (!value || typeof value !== "object") return this.getSnapshot();
    const input = value as Partial<VisualCollaborationPersistedSnapshot>;
    const restored = initialSnapshot();
    restored.sessionId = typeof input.sessionId === "string" ? safeText(input.sessionId, "visual-session", 240) : null;
    restored.active = input.active === true;
    restored.contextKey = typeof input.contextKey === "string" ? safeText(input.contextKey, "workspace", 240) : null;
    restored.startedAt = typeof input.startedAt === "string" ? input.startedAt : null;
    restored.updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : nowIso();
    restored.persistVersion = Number.isFinite(input.persistVersion) ? Math.max(0, Number(input.persistVersion)) : 0;
    restored.comparisonMode = isComparisonMode(input.comparisonMode) ? input.comparisonMode : "split";
    if (input.viewport && typeof input.viewport === "object") {
      restored.viewport = {
        preset: input.viewport.preset === "tablet" || input.viewport.preset === "mobile" || input.viewport.preset === "custom" ? input.viewport.preset : "desktop",
        width: Math.round(clamp(Number(input.viewport.width), 320, 2560)),
        height: Math.round(clamp(Number(input.viewport.height), 480, 1600))
      };
    }
    const previewUrlValue = typeof input.preview?.url === "string" ? safePreviewUrl(input.preview.url) : null;
    const history = Array.isArray(input.preview?.history)
      ? input.preview.history.flatMap((entry) => typeof entry === "string" ? [safePreviewUrl(entry)] : []).filter((entry): entry is string => Boolean(entry)).slice(-20)
      : [];
    restored.preview = {
      url: previewUrlValue,
      title: previewUrlValue
        ? previewTitle(previewUrlValue)
        : typeof input.preview?.title === "string"
          ? safeText(input.preview.title, "Aplicación actual", 100)
          : "Aplicación actual",
      history,
      historyIndex: previewUrlValue ? Math.max(0, history.indexOf(previewUrlValue)) : -1,
      refreshToken: Number.isFinite(input.preview?.refreshToken) ? Math.max(0, Number(input.preview?.refreshToken)) : 0
    };
    if (input.selection && typeof input.selection === "object") {
      const bounds = normalizedBounds(input.selection.bounds ?? { x: 0.4, y: 0.4, width: 0.2, height: 0.1 });
      restored.selection = {
        id: typeof input.selection.id === "string" ? safeText(input.selection.id, id("visual-selection"), 240) : id("visual-selection"),
        label: safeText(input.selection.label, "Elemento seleccionado", 80),
        kind: input.selection.kind === "element" ? "element" : "region",
        bounds,
        location: locationFromBounds(bounds),
        previewTitle: restored.preview.title,
        createdAt: typeof input.selection.createdAt === "string" ? input.selection.createdAt : restored.updatedAt
      };
    }
    restored.proposals = Array.isArray(input.proposals) ? input.proposals.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object" || !isProposalStatus(entry.status)) return [];
      const timestamp = typeof entry.createdAt === "string" ? entry.createdAt : restored.updatedAt;
      return [{
        id: typeof entry.id === "string" ? safeText(entry.id, id("visual-proposal"), 240) : id("visual-proposal"),
        sequence: Number.isFinite(entry.sequence) ? Number(entry.sequence) : index + 1,
        title: safeText(entry.title, `Propuesta ${index + 1}`, 72),
        instruction: safeText(entry.instruction, "Propuesta visual", 4_000),
        source: entry.source === "voice" ? "voice" as const : "text" as const,
        selectionLabel: typeof entry.selectionLabel === "string" ? safeText(entry.selectionLabel, "Elemento seleccionado", 80) : null,
        selectionLocation: typeof entry.selectionLocation === "string" ? safeText(entry.selectionLocation, "vista actual", 80) : null,
        status: entry.status,
        summary: typeof entry.summary === "string" ? safeText(entry.summary, "Propuesta visual", 2_000) : null,
        createdAt: timestamp,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : timestamp
      }];
    }).slice(-30) : [];
    restored.activeProposalId = typeof input.activeProposalId === "string" && restored.proposals.some((entry) => entry.id === input.activeProposalId)
      ? input.activeProposalId
      : restored.proposals[restored.proposals.length - 1]?.id ?? null;
    restored.timeline = Array.isArray(input.timeline) ? input.timeline.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const source: VisualTimelineItem["source"] = entry.source === "selection" || entry.source === "annotation" || entry.source === "proposal" || entry.source === "voice" ? entry.source : "session";
      return [{
        id: typeof entry.id === "string" ? safeText(entry.id, id("visual-event"), 240) : id("visual-event"),
        label: safeText(entry.label, "Actividad visual", 180),
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : restored.updatedAt,
        source
      }];
    }).slice(-80) : [];
    this.state = restored;
    return this.getSnapshot();
  }

  getSnapshot(): VisualCollaborationSnapshot {
    return clone(this.state);
  }
}
