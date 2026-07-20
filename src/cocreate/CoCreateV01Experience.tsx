import {
  BadgeCheck,
  Code2,
  ExternalLink,
  ChevronDown,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  SunMedium,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CodexStatus } from "../../shared/codex-contracts.js";
import { CodexConversationService } from "../app/services/codex-conversation-service";
import { CodexExecutionService } from "../app/services/codex-execution-service";
import { ApprovalRuntimeService } from "../app/services/approval-runtime-service";
import { UpstreamCapabilityExposureService } from "../app/services/upstream-capability-exposure-service";
import { WorkspaceExperienceService } from "../app/services/workspace-experience-service";
import { AssistantRuntimeService } from "../app/services/assistant-runtime-service";
import { IdentityService } from "../app/services/identity-service";
import {
  WorkspaceRuntimeService,
  type WorkspaceBootstrap,
  type WorkspaceChatMessage
} from "../app/services/workspace-runtime-service";
import { createCodexAdapter } from "../infrastructure/codex/create-codex-adapter";
import { createApprovalGateway } from "../infrastructure/approval/create-approval-gateway";
import { createIdentityGateway } from "../infrastructure/identity/create-identity-gateway";
import { createWorkspaceGateway } from "../infrastructure/workspace/create-workspace-gateway";
import "./cocreate-v01.css";
import { getWebClientId, loadWebState, saveWebState } from "./web-persistence";
import { isValidCitation, type Citation } from "../../shared/trusted-web-contracts.js";
import { WorkspaceContextBar, type WorkspaceContextActions } from "./workspace-experience/WorkspaceContextBar";
import { WorkspaceWorkPanel } from "./workspace-experience/WorkspaceWorkPanel";
import { FeatureParityService, type FeatureRoute } from "../app/services/feature-parity-service";
import { NavigationService } from "../app/services/navigation-service";
import { PrimaryNavigation } from "./feature-parity/PrimaryNavigation";
import { CodexAccountPanel } from "./account/CodexAccountPanel";
import { CodexActivityCard, reduceCodexActivity, emptyCodexActivity, type CodexTurnActivity } from "./activity/CodexActivityCard";
import { FeatureRouteOutlet } from "./feature-parity/FeatureRouteOutlet";
import { AttachmentService, type ComposerAttachment } from "../app/services/attachment-service";
import { ModelSelectionService, type CodexModelOption } from "../app/services/model-selection-service";
import { createBrowserNavigationGateway } from "../infrastructure/navigation/browser-navigation-gateway";
import { createAttachmentReleaser, createAttachmentSelector, createDroppedAttachmentPreparer } from "../infrastructure/attachments/create-attachment-gateway";
import { createModelCatalogLoader } from "../infrastructure/models/create-model-catalog-gateway";
import { UpstreamStabilityService, emptyExtensionCatalog, type ExtensionCatalog, type PlanModeOption, type SkillCatalogItem, type UpstreamStabilityRuntimeSnapshot } from "../app/services/upstream-stability-service";
import { createUpstreamCapabilitiesGateway } from "../infrastructure/upstream/create-upstream-capabilities-gateway";
import { PlanModeService } from "../app/services/plan-mode-service";
import { ExtensionsService } from "../app/services/extensions-service";
import { VoiceService, type VoiceSnapshot } from "../app/services/voice-service";
import { createBrowserVoiceGateway } from "../infrastructure/voice/create-browser-voice-gateway";
import { AttachmentTray } from "./composer/AttachmentTray";
import { VoiceRecordingPanel } from "./composer/VoiceRecordingPanel";
import { LiveModeSwitch } from "./live/LiveModeSwitch";
import {
  VisualCollaborationService,
  type VisualBounds,
  type VisualCollaborationSnapshot,
  type VisualCollaborationPersistedSnapshot,
  type VisualInstructionSource
} from "../app/services/visual-collaboration-service";
import { VisualCollaborationWorkspace } from "./live/VisualCollaborationWorkspace";
import { ProjectAssociationDialog } from "./live/ProjectAssociationDialog";
import { ProposalRuntimeService } from "../app/services/proposal-runtime-service";
import { createProposalRuntimeGateway } from "../infrastructure/proposals/create-proposal-runtime-gateway";
import { ScreenSharingService, type ScreenSharePreference } from "../app/services/screen-sharing-service";
import { createScreenSharingGateway } from "../infrastructure/screen-sharing/create-screen-sharing-gateway";
import { ImplementationRuntimeService } from "../app/services/implementation-runtime-service";
import { createImplementationRuntimeGateway } from "../infrastructure/implementations/create-implementation-runtime-gateway";
import { ImplementationProgressCard } from "./implementation/ImplementationProgressCard";
import {
  WEB_ATTACHMENT_ACCEPT,
  WEB_ATTACHMENT_MAX_FILES,
  WEB_ATTACHMENT_MAX_TOTAL_BYTES,
  WEB_IMAGE_ACCEPT
} from "../../shared/web-attachment-contracts.js";

type ThemeMode = "dark" | "light";
type ConversationMode = "chat" | "live";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  metadata?: {
    confidence?: string;
    grounded?: boolean;
    verifiedAt?: string;
    citations?: Citation[];
    warnings?: string[];
    conflicts?: Array<{ description?: string }>;
    provider?: string;
    tool?: string | null;
  };
};
type ChatThread = {
  id: string;
  title: string;
  preview: string;
};
type ThreadMessages = Record<string, ChatMessage[]>;
type V01Snapshot = {
  theme: ThemeMode;
  brandColor: string;
  sidebarWidth: number;
  prompt: string;
  isChatsCollapsed: boolean;
  activeChatId?: string;
  threads?: ChatThread[];
  messagesByThread?: ThreadMessages;
  workspaceMode?: ConversationMode;
  liveInstruction?: string;
  visualCollaboration?: VisualCollaborationPersistedSnapshot;
};

const defaultThreadId = "v01-default";
const legacyThreadIds = new Set(["v01-main", "v01-live", "v01-ui", "v01-codex"]);
const legacyThreadTitles = new Set(["CoCreate v0.1", "Live Coding concept", "UI shell", "Codex bridge"]);

const defaultThread: ChatThread = {
  id: defaultThreadId,
  title: "Nuevo chat",
  preview: "Sin mensajes todavía"
};

const defaultBrandColor = "#ffffff";
const mobileViewportQuery = "(max-width: 720px)";
const collapsedSidebarWidth = 88;
const defaultSidebarWidth = 248;
const maxSidebarWidth = 420;

const createMessageId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function safeCitations(message: ChatMessage) {
  return Array.isArray(message.metadata?.citations)
    ? message.metadata.citations.filter(isValidCitation).slice(0, 6)
    : [];
}

function formatVerifiedAt(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatLiveProposalOutput(output: string, succeeded: boolean) {
  if (!succeeded) {
    return "La idea quedó guardada como una propuesta conceptual. Vincula un proyecto local para desarrollarla sobre código real.";
  }

  return output.replace(/\s*\[[A-Z0-9_]+\].*$/s, "").trim() || "Propuesta actualizada.";
}

function buildLiveIntentSummary(input: { instruction: string; selectionLabel: string | null }) {
  const cleaned = input.instruction.replace(/\s+/g, " ").trim();
  const segments = cleaned
    .split(/(?:[.!?]\s+|\n+|,\s+(?=\p{L}))/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (input.selectionLabel) {
    segments.unshift(`Trabajar sobre ${input.selectionLabel}.`);
  }

  return Array.from(new Set(segments)).slice(0, 4);
}

function inferInterfaceArea(bounds: VisualBounds) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const wide = bounds.width > 0.72;
  const narrow = bounds.width < 0.28;
  const tall = bounds.height > 0.42;
  const shallow = bounds.height < 0.18;

  if (centerY < 0.18 && wide) return "Header";
  if (centerY > 0.82 && wide) return "Footer";
  if (centerX < 0.22 && tall) return "Sidebar";
  if (centerX < 0.32 && centerY > 0.22 && centerY < 0.72) return "Lista de proyectos";
  if (centerX > 0.78 && tall) return "Panel lateral";
  if (centerX > 0.68 && centerY < 0.24) return "Acciones superiores";
  if (centerX > 0.35 && centerX < 0.68 && centerY < 0.3 && shallow) return "Toolbar";
  if (centerX > 0.32 && centerX < 0.72 && centerY > 0.22 && centerY < 0.76) return "Contenido principal";
  return "Zona de la interfaz";
}

function inferPointArea(point: { x: number; y: number }) {
  return inferInterfaceArea({ x: Math.max(0, point.x - 0.04), y: Math.max(0, point.y - 0.04), width: 0.08, height: 0.08 });
}

function inferObservedElements(snapshot: VisualCollaborationSnapshot, surfaceLabel: string | null) {
  const labels: string[] = [];
  const add = (label: string | null | undefined) => {
    if (!label) return;
    const cleaned = label.trim();
    if (!cleaned || labels.includes(cleaned)) return;
    labels.push(cleaned);
  };

  if (snapshot.selection?.label && snapshot.selection.label !== "Elemento seleccionado") {
    add(snapshot.selection.label);
  }
  if (snapshot.selection) add(inferInterfaceArea(snapshot.selection.bounds));
  if (snapshot.hoverBounds) add(inferInterfaceArea(snapshot.hoverBounds));
  if (snapshot.pointer) add(inferPointArea(snapshot.pointer));
  if (snapshot.annotations.length) add("Área anotada");
  if (!labels.length && surfaceLabel) add(surfaceLabel.split(/[|·-]/)[0]?.trim() ?? surfaceLabel);
  if (!labels.length && snapshot.preview.title) add(snapshot.preview.title);

  return labels.slice(0, 4);
}

type LiveConfidenceLevel = "exploring" | "aligned" | "ready";

function computeLiveConfidence(input: {
  transcript: string;
  observedElements: string[];
  hasSelection: boolean;
  projectLinked: boolean;
  proposalAvailable: boolean;
  implementationAvailable: boolean;
}) {
  const transcriptWords = input.transcript.split(/\s+/).filter(Boolean).length;
  const actionSignals = /\b(mover|cambiar|alinear|reducir|aumentar|ocultar|mostrar|simplificar|ajustar|crear|editar|implementa|ejecuta)\b/i.test(input.transcript);
  const referenceSignals = input.observedElements.length >= 2 || input.hasSelection;
  const executionSignals = input.projectLinked && input.proposalAvailable;
  const score =
    (transcriptWords >= 6 ? 0.28 : transcriptWords >= 3 ? 0.14 : 0) +
    (referenceSignals ? 0.26 : 0) +
    (actionSignals ? 0.24 : 0) +
    (executionSignals ? 0.16 : 0) +
    (input.implementationAvailable ? 0.06 : 0);

  const level: LiveConfidenceLevel = score >= 0.72 ? "ready" : score >= 0.42 ? "aligned" : "exploring";
  const rationale = level === "ready"
    ? "Live ya tiene suficiente contexto visual y verbal para preparar cambios concretos."
    : level === "aligned"
      ? "La sesión ya entiende el problema central, pero aún conviene confirmar uno o dos detalles."
      : "Live todavía está explorando la superficie y reuniendo intención suficiente para actuar.";

  const nextAction = level === "ready"
    ? executionSignals
      ? "Preparar cambios ejecutables"
      : "Vincular proyecto para ejecutar"
    : level === "aligned"
      ? "Refinar propuesta"
      : "Seguir observando";

  return {
    score: Math.min(1, Number(score.toFixed(2))),
    level,
    rationale,
    nextAction
  };
}

const isValidHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#([0-9a-f]{6})$/i.test(value);

const isMobileViewport = () => window.matchMedia(mobileViewportQuery).matches;

const clampSidebarWidth = (value: number) => Math.min(maxSidebarWidth, Math.max(collapsedSidebarWidth, value));

const seededAssistantMessages = new Set([
  "Listo. En web ya puedo responder por API y en desktop puedo usar Codex directamente.",
  "Nuevo chat creado. Cuéntame qué quieres construir o depurar."
]);

function createInitialMessagesByThread() {
  return {
    [defaultThreadId]: []
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
  const messagesByThread: ThreadMessages =
    candidate.messagesByThread && typeof candidate.messagesByThread === "object"
      ? Object.entries(candidate.messagesByThread).reduce<ThreadMessages>((accumulator, [threadId, messages]) => {
          if (legacyThreadIds.has(threadId)) {
            return accumulator;
          }
          accumulator[threadId] = Array.isArray(messages)
            ? messages.filter(
                (message): message is ChatMessage =>
                  isChatMessage(message) && !seededAssistantMessages.has(message.body.trim())
              )
            : [];
          return accumulator;
        }, fallbackMessages)
      : fallbackMessages;

  const safeThreads = threads.length ? threads : createInitialThreads();

  if (!messagesByThread[safeThreads[0]?.id]) {
    messagesByThread[safeThreads[0]?.id] = [];
  }

  return {
    theme: candidate.theme === "light" ? "light" : "dark",
    brandColor: isValidHexColor(candidate.brandColor) ? candidate.brandColor : defaultBrandColor,
    sidebarWidth:
      typeof candidate.sidebarWidth === "number" && Number.isFinite(candidate.sidebarWidth)
        ? clampSidebarWidth(candidate.sidebarWidth)
        : defaultSidebarWidth,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    activeChatId:
      typeof candidate.activeChatId === "string" &&
      candidate.activeChatId &&
      !legacyThreadIds.has(candidate.activeChatId)
        ? candidate.activeChatId
        : safeThreads[0].id,
    isChatsCollapsed: typeof candidate.isChatsCollapsed === "boolean" ? candidate.isChatsCollapsed : false,
    threads: safeThreads,
    messagesByThread,
    workspaceMode: candidate.workspaceMode === "live" ? "live" : "chat",
    liveInstruction: typeof candidate.liveInstruction === "string" ? candidate.liveInstruction.slice(0, 8_000) : "",
    visualCollaboration: candidate.visualCollaboration && typeof candidate.visualCollaboration === "object"
      ? candidate.visualCollaboration
      : undefined
  };
}

export function CoCreateV01Experience() {
  const conversationRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const webImageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const liveSidebarWidthRef = useRef(defaultSidebarWidth);
  const resizeFrameRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const hasHydratedRef = useRef(false);
  const clientIdRef = useRef("");
  const titleGenerationRef = useRef<Set<string>>(new Set());
  const codexAdapterRef = useRef<ReturnType<typeof createCodexAdapter> | null>(null);
  if (!codexAdapterRef.current) {
    codexAdapterRef.current = createCodexAdapter();
  }
  const capabilityExposureServiceRef = useRef<UpstreamCapabilityExposureService | null>(null);
  if (!capabilityExposureServiceRef.current) {
    capabilityExposureServiceRef.current = new UpstreamCapabilityExposureService();
  }
  const capabilityExposureService = capabilityExposureServiceRef.current as UpstreamCapabilityExposureService;
  const featureParityServiceRef = useRef(new FeatureParityService());
  const attachmentServiceRef = useRef(new AttachmentService(
    createAttachmentSelector(),
    createDroppedAttachmentPreparer(),
    createAttachmentReleaser()
  ));
  const modelSelectionServiceRef = useRef(new ModelSelectionService(createModelCatalogLoader()));
  const upstreamStabilityServiceRef = useRef(new UpstreamStabilityService(createUpstreamCapabilitiesGateway()));
  const planModeServiceRef = useRef(new PlanModeService(upstreamStabilityServiceRef.current));
  const extensionsServiceRef = useRef(new ExtensionsService(upstreamStabilityServiceRef.current));
  const voiceServiceRef = useRef(new VoiceService(createBrowserVoiceGateway()));
  const visualCollaborationServiceRef = useRef(new VisualCollaborationService());
  const proposalRuntimeServiceRef = useRef(new ProposalRuntimeService(createProposalRuntimeGateway()));
  const screenSharingServiceRef = useRef(new ScreenSharingService(createScreenSharingGateway()));
  const implementationRuntimeServiceRef = useRef(new ImplementationRuntimeService(createImplementationRuntimeGateway()));
  const navigationServiceRef = useRef<NavigationService | null>(null);
  if (!navigationServiceRef.current) navigationServiceRef.current = new NavigationService(createBrowserNavigationGateway());
  const codexExecutionServiceRef = useRef(new CodexExecutionService(codexAdapterRef.current));
  const codexConversationServiceRef = useRef(
    new CodexConversationService(codexExecutionServiceRef.current, capabilityExposureService)
  );
  const workspaceRuntimeServiceRef = useRef(new WorkspaceRuntimeService(createWorkspaceGateway()));
  const workspaceExperienceServiceRef = useRef<WorkspaceExperienceService | null>(null);
  if (!workspaceExperienceServiceRef.current) {
    workspaceExperienceServiceRef.current = new WorkspaceExperienceService(
      workspaceRuntimeServiceRef.current,
      capabilityExposureService,
      window.overlayBridge ? "desktop" : "web"
    );
  }
  const workspaceExperienceService = workspaceExperienceServiceRef.current;
  const approvalRuntimeServiceRef = useRef(new ApprovalRuntimeService(createApprovalGateway()));
  const identityServiceRef = useRef(new IdentityService(createIdentityGateway()));
  const assistantRuntimeServiceRef = useRef(
    new AssistantRuntimeService(
      codexConversationServiceRef.current,
      workspaceRuntimeServiceRef.current,
      identityServiceRef.current
    )
  );
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [brandColor, setBrandColor] = useState(defaultBrandColor);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [prompt, setPrompt] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>(createInitialThreads);
  const [activeChatId, setActiveChatId] = useState(defaultThreadId);
  const [isChatsCollapsed, setIsChatsCollapsed] = useState(() =>
    typeof window !== "undefined" ? isMobileViewport() : false
  );
  const [messagesByThread, setMessagesByThread] = useState<ThreadMessages>(createInitialMessagesByThread);
  const [isRunning, setIsRunning] = useState(false);
  const [codexActivity, setCodexActivity] = useState<CodexTurnActivity | null>(null);
  const [testLaunching, setTestLaunching] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [workspaceExperience, setWorkspaceExperience] = useState(workspaceExperienceService.getSnapshot());
  const [approvalState, setApprovalState] = useState(approvalRuntimeServiceRef.current.getSnapshot());
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [heroStage, setHeroStage] = useState<"visible" | "exiting" | "hidden">("visible");
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [activeRoute, setActiveRoute] = useState<FeatureRoute>(navigationServiceRef.current.getRoute());
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [composerMenuView, setComposerMenuView] = useState<"root" | "context">("root");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentProgress, setAttachmentProgress] = useState<{ processed: number; total: number } | null>(null);
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const readStoredPref = (key: string) => {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  const [selectedModel, setSelectedModel] = useState<string>(() => readStoredPref("cocreate.selectedModel"));
  const [selectedEffort, setSelectedEffort] = useState<string>(() => readStoredPref("cocreate.selectedEffort"));
  const [upstreamSnapshot, setUpstreamSnapshot] = useState<UpstreamStabilityRuntimeSnapshot | null>(null);
  const [extensionCatalog, setExtensionCatalog] = useState<ExtensionCatalog>(emptyExtensionCatalog);
  const [extensionsLoading, setExtensionsLoading] = useState(false);
  const [planModes, setPlanModes] = useState<PlanModeOption[]>([]);
  const [selectedPlanMode, setSelectedPlanMode] = useState<"plan" | "default">("default");
  const [selectedSkills, setSelectedSkills] = useState<SkillCatalogItem[]>([]);
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceSnapshot>(voiceServiceRef.current.getSnapshot());
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = useState(0);
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<ConversationMode>("chat");
  const [visualSnapshot, setVisualSnapshot] = useState(visualCollaborationServiceRef.current.getSnapshot());
  const [proposalRuntimeSnapshot, setProposalRuntimeSnapshot] = useState(proposalRuntimeServiceRef.current.getSnapshot());
  const [screenSharingSnapshot, setScreenSharingSnapshot] = useState(screenSharingServiceRef.current.getSnapshot());
  const [implementationRuntimeSnapshot, setImplementationRuntimeSnapshot] = useState(implementationRuntimeServiceRef.current.getSnapshot());
  const [liveInstruction, setLiveInstruction] = useState("");
  const [liveActivityText, setLiveActivityText] = useState("");
  const [liveVoiceNotice, setLiveVoiceNotice] = useState<string | null>(null);
  const [liveImplementationBusy, setLiveImplementationBusy] = useState(false);
  const [projectCreatorOpen, setProjectCreatorOpen] = useState(false);
  const [projectAssociationOpen, setProjectAssociationOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [promptSource, setPromptSource] = useState<VisualInstructionSource>("text");
  const chatScrollPositionRef = useRef(0);
  const isListening = voiceSnapshot.status === "recording";
  const voiceComposerActive = isListening || voiceSnapshot.status === "transcribing";
  const activeThread = threads.find((thread) => thread.id === activeChatId);
  const activeMessages = messagesByThread[activeChatId] ?? [];
  const activeImplementationOperations = implementationRuntimeSnapshot.operations.filter((operation) => operation.conversationId === activeChatId);
  const hasUserMessages = activeMessages.some((message) => message.role === "user");
  // Detect a web app Codex just built by extracting an .html path from the latest
  // assistant reply (Codex reports it, e.g. "Abre [index.html](C:/…/index.html)").
  const lastAssistantBody = [...activeMessages].reverse().find((message) => message.role === "assistant")?.body ?? "";
  const builtWebPath = lastAssistantBody.match(/([A-Za-z]:[\\/][^\s)\]"']+\.html)/)?.[1] ?? null;
  const featureEntries = featureParityServiceRef.current.getEntries({
    environment: workspaceExperience.environment,
    codexStatus,
    workspace: workspaceExperience,
    upstream: upstreamSnapshot,
    extensions: extensionCatalog
  });
  const activeFeature = featureEntries.find((entry) => entry.route === activeRoute) ?? featureEntries[5];
  const planDescriptor = upstreamSnapshot?.descriptors.find((entry) => entry.id === "plan-mode");
  const voiceDescriptor = upstreamSnapshot?.descriptors.find((entry) => entry.id === "native-voice");
  const filePickerDescriptor = upstreamSnapshot?.descriptors.find((entry) => entry.id === "native-file-picker");
  const voiceCapabilityEnabled = voiceDescriptor?.enabled === true;
  const filePickerCapabilityEnabled = attachmentServiceRef.current.getAvailability("file").available && filePickerDescriptor?.enabled !== false;
  const folderPickerCapabilityEnabled = workspaceExperience.environment === "desktop" &&
    attachmentServiceRef.current.getAvailability("folder").available && filePickerDescriptor?.enabled !== false;
  const liveInstructionSource = liveInstruction.trim() || liveActivityText.trim();
  const liveObservedElements = inferObservedElements(visualSnapshot, screenSharingSnapshot.surface?.label ?? null);
  const liveProposalAvailable = proposalRuntimeSnapshot.availability.available;
  const liveImplementationAvailable = implementationRuntimeSnapshot.availability.available;
  const liveIntentSummary = buildLiveIntentSummary({
    instruction: liveInstructionSource,
    selectionLabel: visualSnapshot.selection?.label ?? null
  });
  const liveVoiceProgressStage = voiceElapsedSeconds < 3
    ? "listening"
    : voiceElapsedSeconds < 8
      ? "observing"
      : "understanding";
  const liveStage =
    voiceSnapshot.status === "recording"
      ? liveVoiceProgressStage
      : voiceSnapshot.status === "transcribing"
        ? "transcribing"
        : isRunning && liveImplementationBusy
          ? "updating"
          : isRunning
            ? "understanding"
            : proposalRuntimeSnapshot.busyAction === "preparing"
              ? "planning"
              : proposalRuntimeSnapshot.busyAction === "applying" || proposalRuntimeSnapshot.busyAction === "preview"
                ? "updating"
                : voiceSnapshot.status === "denied" || voiceSnapshot.status === "error"
                  ? "error"
                  : proposalRuntimeSnapshot.proposals.length > 0 || visualSnapshot.proposals.length > 0
                    ? "ready"
                  : "idle";
  const liveStatusFeed = [
    {
      label: "Escuchando",
      state: voiceSnapshot.status === "recording" && liveVoiceProgressStage === "listening"
        ? "active"
        : voiceElapsedSeconds > 0 || voiceSnapshot.status === "transcribing" || isRunning
          ? "done"
          : "pending"
    },
    {
      label: "Observando la interfaz",
      state: voiceSnapshot.status === "recording" && liveVoiceProgressStage === "observing"
        ? "active"
        : liveObservedElements.length > 0 || voiceSnapshot.status === "transcribing" || isRunning
          ? "done"
          : "pending"
    },
    {
      label: "Entendiendo el contexto",
      state: liveStage === "understanding"
        ? "active"
        : liveStage === "planning" || liveStage === "updating" || liveStage === "ready"
          ? "done"
          : "pending"
    },
    {
      label: "Preparando propuesta",
      state: liveStage === "planning" || liveStage === "updating"
        ? "active"
        : liveStage === "ready"
          ? "done"
          : "pending"
    }
  ] as const;
  const liveWorkingNotes = liveIntentSummary.length
    ? liveIntentSummary
    : [
      liveObservedElements[0]
        ? `Parece que el foco está en ${liveObservedElements[0]}.`
        : "Aún estamos tomando referencia visual de la superficie.",
      visualSnapshot.selection
        ? `La selección activa está en ${visualSnapshot.selection.location}.`
        : "Puedes señalar o seleccionar una zona para aumentar la precisión.",
      liveStage === "observing"
        ? "CoCreate está leyendo la estructura visible antes de redactar la propuesta."
        : "Proposal irá refinando esta interpretación a medida que avance la sesión."
    ].filter(Boolean);
  const liveConfidence = computeLiveConfidence({
    transcript: `${voiceSnapshot.transcript} ${voiceSnapshot.interimTranscript} ${liveInstructionSource}`.trim(),
    observedElements: liveObservedElements,
    hasSelection: Boolean(visualSnapshot.selection),
    projectLinked: Boolean(workspaceExperience.project?.hasDirectory),
    proposalAvailable: liveProposalAvailable,
    implementationAvailable: liveImplementationAvailable
  });
  const liveExecutionSuggestions = liveConfidence.level === "ready"
    ? [
        liveProposalAvailable
          ? "La propuesta ya puede pasar a cambios concretos sobre una copia aislada."
          : "Live ya entendió suficiente para preparar una propuesta ejecutable cuando el runtime esté disponible.",
        liveImplementationAvailable && workspaceExperience.project?.id
          ? "La siguiente transición natural es revisar cambios y lanzar implementación."
          : "Conecta un proyecto local para que la transición hacia ejecución sea continua."
      ]
    : liveConfidence.level === "aligned"
      ? [
          "Ya existe una dirección clara de cambio.",
          "Una referencia más del área exacta o del resultado esperado debería bastar para actuar con confianza."
        ]
      : [
          "Todavía conviene seguir observando la interfaz y escuchando la instrucción.",
          "Live todavía no debería saltar a ejecución."
        ];
  const liveVoiceHint = liveVoiceNotice
    ?? (voiceSnapshot.status === "denied"
      ? "Live sigue funcionando sin micrófono. Puedes escribir o volver a activarlo cuando quieras."
      : voiceSnapshot.status === "error"
        ? voiceSnapshot.error ?? "No pude activar el micrófono."
        : null);
  const liveVoiceHintActionLabel = voiceSnapshot.status === "denied" || voiceSnapshot.status === "error"
    ? "Activar micrófono"
    : undefined;

  const navigate = (route: FeatureRoute) => {
    navigationServiceRef.current?.navigate(route);
    if (isMobileViewport()) setIsChatsCollapsed(true);
    if (route === "chat") window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const refreshUpstreamFeatures = async () => {
    setExtensionsLoading(true);
    try {
      const [snapshot, plans, extensions] = await Promise.all([
        upstreamStabilityServiceRef.current.getSnapshot(),
        planModeServiceRef.current.list(),
        extensionsServiceRef.current.list()
      ]);
      setUpstreamSnapshot(snapshot);
      setPlanModes(plans.modes);
      setExtensionCatalog(extensions);
    } catch (cause) {
      setContextError(cause instanceof Error ? cause.message : "No pude actualizar las capabilities de Codex.");
    } finally {
      setExtensionsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void codexConversationServiceRef.current
      .getStatus()
      .then((status) => {
        if (!cancelled) {
          setCodexStatus(status);
          capabilityExposureService.initialize(status);
          workspaceExperienceService.setCodexStatus(status);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      void codexAdapterRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    void attachmentServiceRef.current.release(attachmentsRef.current.map((attachment) => attachment.token));
  }, []);

  useEffect(() => {
    if (!isListening) return;
    setVoiceElapsedSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => setVoiceElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000)), 250);
    return () => window.clearInterval(timer);
  }, [isListening]);

  useEffect(() => {
    if (workspaceMode === "live") {
      chatScrollPositionRef.current = conversationRef.current?.scrollTop ?? 0;
      const contextKey = workspaceExperience.conversation?.id ?? activeChatId;
      setVisualSnapshot(visualCollaborationServiceRef.current.start(contextKey));
      return undefined;
    }
    setVisualSnapshot(visualCollaborationServiceRef.current.end());
    window.setTimeout(() => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = chatScrollPositionRef.current;
      composerRef.current?.focus();
    }, 0);
    return undefined;
  }, [workspaceMode, workspaceExperience.conversation?.id, activeChatId]);

  useEffect(() => {
    let cancelled = false;
    void modelSelectionServiceRef.current.list().then(({ models: discovered }) => {
      if (cancelled) return;
      setModels(discovered);
      const preferred = modelSelectionServiceRef.current.selectDefault(discovered);
      if (preferred) {
        setSelectedModel((current) => current || preferred.model);
        setSelectedEffort((current) => current || preferred.defaultReasoningEffort || "");
      }
    });
    return () => { cancelled = true; };
  }, [codexStatus?.available, codexStatus?.version]);

  useEffect(() => {
    const proposalRuntime = proposalRuntimeServiceRef.current;
    const unsubscribe = proposalRuntime.subscribe(setProposalRuntimeSnapshot);
    void proposalRuntime.initialize().catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const implementationRuntime = implementationRuntimeServiceRef.current;
    const unsubscribe = implementationRuntime.subscribe(setImplementationRuntimeSnapshot);
    void implementationRuntime.initialize().catch(() => undefined);
    return () => {
      unsubscribe();
      implementationRuntime.dispose();
    };
  }, []);

  useEffect(() => {
    const screenSharing = screenSharingServiceRef.current;
    const unsubscribe = screenSharing.subscribe((snapshot) => {
      setScreenSharingSnapshot(snapshot);
      if (snapshot.surface) {
        setVisualSnapshot(visualCollaborationServiceRef.current.describeSharedSurface(snapshot.surface.label));
      }
    });
    void screenSharing.initialize();
    return () => {
      unsubscribe();
      screenSharing.dispose();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribeVoice = voiceServiceRef.current.subscribe((snapshot) => {
      if (active) setVoiceSnapshot(snapshot);
    });
    const unsubscribeUpstream = upstreamStabilityServiceRef.current.subscribe(() => {
      if (active) void refreshUpstreamFeatures();
    });
    void voiceServiceRef.current.initialize();
    void refreshUpstreamFeatures();
    return () => {
      active = false;
      unsubscribeVoice();
      unsubscribeUpstream();
      void voiceServiceRef.current.cancel();
    };
  }, []);

  useEffect(() => {
    const preferences = workspaceExperience.task?.assistantPreferences;
    const planAvailable = upstreamSnapshot?.descriptors.find((entry) => entry.id === "plan-mode")?.enabled === true;
    setSelectedPlanMode(planAvailable && preferences?.planModeEnabled ? "plan" : "default");
    const names = new Set(preferences?.selectedSkillNames ?? []);
    setSelectedSkills(extensionCatalog.skills.data.filter((skill) => names.has(skill.name)).slice(0, 8));
  }, [workspaceExperience.task?.id, workspaceExperience.task?.assistantPreferences, extensionCatalog.updatedAt, upstreamSnapshot?.updatedAt]);

  useEffect(() => {
    const navigation = navigationServiceRef.current!;
    const unsubscribe = navigation.subscribe(setActiveRoute);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribeWorkspace = workspaceExperienceService.subscribe(setWorkspaceExperience);
    const approvalService = approvalRuntimeServiceRef.current;
    const unsubscribeApproval = approvalService.subscribe(setApprovalState);
    approvalService.initialize();
    void workspaceExperienceService.refresh().catch((cause) => {
      setContextError(cause instanceof Error ? cause.message : "No pude restaurar el contexto del Workspace.");
    });
    return () => {
      unsubscribeWorkspace();
      unsubscribeApproval();
      approvalService.dispose();
      workspaceExperienceService.dispose();
    };
  }, []);

  useEffect(() => {
    clientIdRef.current = getWebClientId();
    let cancelled = false;
    const applyPreferences = (value: unknown) => {
      const snapshot = readV01Snapshot(value);
      if (!snapshot) return;
      setTheme(snapshot.theme);
      setBrandColor(snapshot.brandColor);
      setSidebarWidth(snapshot.sidebarWidth);
      liveSidebarWidthRef.current = snapshot.sidebarWidth;
      setPrompt(snapshot.prompt);
      setLiveInstruction(snapshot.liveInstruction ?? "");
      setWorkspaceMode(snapshot.workspaceMode === "live" ? "live" : "chat");
      setIsChatsCollapsed(isMobileViewport() ? true : snapshot.isChatsCollapsed);
      if (snapshot.visualCollaboration) {
        setVisualSnapshot(visualCollaborationServiceRef.current.restore(snapshot.visualCollaboration));
      }
    };
    const restorePreferences = window.overlayBridge?.getAppState
      ? window.overlayBridge.getAppState().then((payload) => {
          if (!cancelled) applyPreferences(payload.session?.renderer?.workbench);
        })
      : loadWebState<V01Snapshot>("v01", clientIdRef.current).then((payload) => {
          if (cancelled || !payload.snapshot) return;
          applyPreferences(payload.snapshot);
        });
    void Promise.all([
      restorePreferences,
      workspaceRuntimeServiceRef.current.getBootstrap().then((payload) => {
        if (!cancelled && payload) hydrateFromWorkspaceBootstrap(payload);
      })
    ])
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          hasHydratedRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hydrateFromWorkspaceBootstrap = (payload: WorkspaceBootstrap) => {
    const mappedThreads = payload.conversations.map((conversation) => conversation.thread);
    const mappedMessages = payload.conversations.reduce<ThreadMessages>((accumulator, conversation) => {
      accumulator[conversation.id] = conversation.messages.map((message) => ({
        id: message.id,
        role: message.role === "system" ? "assistant" : message.role,
        body: message.body,
        metadata: message.metadata as ChatMessage["metadata"]
      }));
      return accumulator;
    }, {});

    if (mappedThreads.length) {
      setThreads(mappedThreads);
      setMessagesByThread(mappedMessages);
      const activeConversationId =
        typeof payload.conversation?.id === "string" ? payload.conversation.id : mappedThreads[0]?.id ?? defaultThreadId;
      setActiveChatId(activeConversationId);
    } else {
      setThreads(createInitialThreads());
      setMessagesByThread(createInitialMessagesByThread());
      setActiveChatId(defaultThreadId);
    }
  };

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileViewportQuery);
    const syncMobileSidebar = (event: MediaQueryList | MediaQueryListEvent) => {
      if (event.matches) {
        setIsChatsCollapsed(true);
      } else {
        setSidebarWidth((current) => {
          const nextWidth = clampSidebarWidth(current);
          liveSidebarWidthRef.current = nextWidth;
          return nextWidth;
        });
      }
    };

    syncMobileSidebar(mediaQuery);
    mediaQuery.addEventListener("change", syncMobileSidebar);
    return () => {
      mediaQuery.removeEventListener("change", syncMobileSidebar);
    };
  }, []);

  useEffect(() => {
    const node = conversationRef.current;
    if (!node || !hasUserMessages) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth"
    });
  }, [activeChatId, activeMessages, hasUserMessages]);

  useEffect(() => {
    if (hasUserMessages) {
      setHeroStage((current) => (current === "exiting" ? current : "hidden"));
      return;
    }

    setHeroStage("visible");
  }, [activeChatId, hasUserMessages]);

  useEffect(() => {
    if (workspaceMode !== "live") {
      setLiveVoiceNotice(null);
      return;
    }
    if (voiceSnapshot.status === "recording" || voiceSnapshot.status === "transcribing") {
      setLiveVoiceNotice(null);
    }
  }, [voiceSnapshot.status, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "live") return;
    const transcript = `${voiceSnapshot.transcript} ${voiceSnapshot.interimTranscript}`.trim();
    if (!transcript) return;
    setLiveActivityText(transcript);
  }, [voiceSnapshot.interimTranscript, voiceSnapshot.transcript, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "live") return;
    if (liveConfidence.level !== "ready") return;
    if (workspaceExperience.project?.hasDirectory) {
      void proposalRuntimeServiceRef.current.initialize().catch(() => undefined);
      void implementationRuntimeServiceRef.current.initialize().catch(() => undefined);
    }
  }, [liveConfidence.level, workspaceExperience.project?.hasDirectory, workspaceMode]);

  const appendMessage = (
    role: ChatMessage["role"],
    body: string,
    metadata?: ChatMessage["metadata"],
    threadId = activeChatId
  ) => {
    setMessagesByThread((current) => ({
      ...current,
      [threadId]: [
        ...(current[threadId] ?? []),
        {
          id: createMessageId(),
          role,
          body,
          metadata
        }
      ]
    }));
  };

  useEffect(() => {
    liveSidebarWidthRef.current = sidebarWidth;
    if (!isResizingSidebar) {
      pageRef.current?.style.setProperty("--sidebar-width", `${isChatsCollapsed ? collapsedSidebarWidth : sidebarWidth}px`);
    }
  }, [isChatsCollapsed, isResizingSidebar, sidebarWidth]);

  useEffect(() => {
    if (!isResizingSidebar) {
      return;
    }

    const applyLiveSidebarWidth = (nextWidth: number) => {
      liveSidebarWidthRef.current = nextWidth;

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        pageRef.current?.style.setProperty("--sidebar-width", `${nextWidth}px`);
        resizeFrameRef.current = null;
      });
    };

    const stopResizing = () => {
      const finalWidth = clampSidebarWidth(liveSidebarWidthRef.current);
      const shouldCollapse = finalWidth <= collapsedSidebarWidth + 8;

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      liveSidebarWidthRef.current = finalWidth;
      setSidebarWidth(finalWidth);
      setIsChatsCollapsed(shouldCollapse);
      resizeStateRef.current = null;
      setIsResizingSidebar(false);
      document.documentElement.classList.remove("sidebar-resizing");
    };

    const handlePointerMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      event.preventDefault();
      const nextWidth = clampSidebarWidth(state.startWidth + (event.clientX - state.startX));
      applyLiveSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      stopResizing();
    };

    document.documentElement.classList.add("sidebar-resizing");
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      document.documentElement.classList.remove("sidebar-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!hasHydratedRef.current || (!window.overlayBridge && !clientIdRef.current)) {
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    const snapshot: V01Snapshot = {
      theme,
      brandColor,
      sidebarWidth,
      prompt,
      isChatsCollapsed,
      workspaceMode,
      liveInstruction,
      visualCollaboration: visualCollaborationServiceRef.current.serialize()
    };

    persistTimerRef.current = window.setTimeout(() => {
      if (window.overlayBridge?.saveRendererState) {
        void window.overlayBridge.saveRendererState({
          title: workspaceExperience.conversation?.title ?? "CoCreate Live",
          snapshot
        }).catch(() => {});
        return;
      }
      void saveWebState("v01", clientIdRef.current, snapshot).catch(() => {});
    }, 300);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [brandColor, isChatsCollapsed, liveInstruction, prompt, sidebarWidth, theme, visualSnapshot.persistVersion, workspaceExperience.conversation?.title, workspaceMode]);

  const syncUiFromWorkspace = async () => {
    const bootstrap = await workspaceRuntimeServiceRef.current.getBootstrap();
    if (bootstrap) hydrateFromWorkspaceBootstrap(bootstrap);
  };

  const runContextAction = async (operation: () => Promise<unknown>) => {
    if (contextBusy) return null;
    setContextBusy(true);
    setContextError(null);
    try {
      const result = await operation();
      await syncUiFromWorkspace();
      return result;
    } catch (cause) {
      setContextError(cause instanceof Error ? cause.message : "No pude actualizar el contexto del Workspace.");
      return null;
    } finally {
      setContextBusy(false);
    }
  };

  const createBlankTask = async () => {
    screenSharingServiceRef.current.stop("mode-exit");
    setWorkspaceMode("chat");
    const created = await runContextAction(() => workspaceExperienceService.createTaskWithConversation({
      projectId: null,
      title: "Nueva tarea"
    }));
    if (!created) return;
    navigate("chat");
    setHeroStage("visible");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const contextActions: WorkspaceContextActions = {
    selectProject: (id) => runContextAction(() => workspaceExperienceService.selectProject(id)),
    createProject: (name) => runContextAction(() => workspaceExperienceService.createProject({ name })),
    createProjectFromDirectory: () => runContextAction(() => workspaceExperienceService.createProjectFromDirectory()),
    renameProject: (id, name) => runContextAction(() => workspaceExperienceService.renameProject(id, name)),
    archiveProject: (id) => runContextAction(() => workspaceExperienceService.archiveProject(id)),
    restoreProject: (id) => runContextAction(() => workspaceExperienceService.restoreProject(id)),
    associateDirectory: (id) => runContextAction(() => workspaceExperienceService.associateProjectDirectory(id)),
    selectTask: (id) => runContextAction(() => workspaceExperienceService.selectTask(id)),
    createTask: (projectId, title) => runContextAction(() => workspaceExperienceService.createTaskWithConversation({ projectId, title })),
    renameTask: (id, title) => runContextAction(() => workspaceExperienceService.renameTask(id, title)),
    changeTaskStatus: (id, status) => runContextAction(() => workspaceExperienceService.changeTaskStatus(id, status)),
    restoreTask: (id) => runContextAction(() => workspaceExperienceService.restoreTask(id)),
    associateTaskProject: (id, projectId) => runContextAction(() => workspaceExperienceService.associateTaskProject(id, projectId)),
    selectConversation: (id) => runContextAction(() => workspaceExperienceService.selectConversation(id)),
    createConversation: (taskId) => runContextAction(() => workspaceExperienceService.createConversation(taskId))
  };

  const associateCurrentTaskProject = async (projectId: string) => {
    const taskId = workspaceExperience.task?.id;
    if (!taskId) return;
    const result = await contextActions.associateTaskProject(taskId, projectId);
    if (result) setProjectAssociationOpen(false);
  };

  const createAndAssociateProject = async (name: string) => {
    const taskId = workspaceExperience.task?.id;
    if (!taskId) return;
    const existingIds = new Set(workspaceExperience.projects.map((project) => project.id));
    const result = await runContextAction(async () => {
      await workspaceExperienceService.createProject({ name });
      const project = workspaceExperienceService.getSnapshot().projects.find((entry) => !existingIds.has(entry.id));
      if (!project) throw new Error("No pude identificar el proyecto recién creado.");
      await workspaceExperienceService.associateTaskProject(taskId, project.id);
      return workspaceExperienceService.selectTask(taskId);
    });
    if (result) setProjectAssociationOpen(false);
  };

  const createDirectoryProjectAndAssociate = async () => {
    const taskId = workspaceExperience.task?.id;
    if (!taskId) return;
    const existingIds = new Set(workspaceExperience.projects.map((project) => project.id));
    const result = await runContextAction(async () => {
      await workspaceExperienceService.createProjectFromDirectory();
      const project = workspaceExperienceService.getSnapshot().projects.find((entry) => !existingIds.has(entry.id));
      if (!project) return null;
      await workspaceExperienceService.associateTaskProject(taskId, project.id);
      return workspaceExperienceService.selectTask(taskId);
    });
    if (result) setProjectAssociationOpen(false);
  };

  const generateThreadTitle = async (threadId: string, taskId: string | null, promptText: string, history: ChatMessage[]) => {
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
      if (taskId) {
        void workspaceExperienceService.syncGeneratedTitle(taskId, threadId, title).then(() => syncUiFromWorkspace());
      }
    } catch {
      return;
    } finally {
      titleGenerationRef.current.delete(threadId);
    }
  };

  const mergeAttachments = (selected: ComposerAttachment[]): string | null => {
    const current = attachmentsRef.current;
    const known = new Set(current.map((attachment) => attachment.token));
    const additions = selected.filter((attachment) => !known.has(attachment.token));
    const next = [...current, ...additions];
    if (next.length > WEB_ATTACHMENT_MAX_FILES) {
      void attachmentServiceRef.current.release(additions.map((attachment) => attachment.token));
      return `Puedes adjuntar hasta ${WEB_ATTACHMENT_MAX_FILES} archivos por mensaje.`;
    }
    const webBytes = next.reduce((total, attachment) => total + (attachment.source === "web" ? attachment.size : 0), 0);
    if (webBytes > WEB_ATTACHMENT_MAX_TOTAL_BYTES) {
      void attachmentServiceRef.current.release(additions.map((attachment) => attachment.token));
      return `Los adjuntos superan el limite total de ${Math.round(WEB_ATTACHMENT_MAX_TOTAL_BYTES / 1024 / 1024)} MB.`;
    }
    attachmentsRef.current = next;
    setAttachments(next);
    return null;
  };

  const selectDesktopAttachments = async (kind: "file" | "folder") => {
    setAttachmentError(null);
    const enabled = kind === "folder" ? folderPickerCapabilityEnabled : filePickerCapabilityEnabled;
    if (!enabled) {
      setAttachmentError(attachmentServiceRef.current.getAvailability(kind).reason);
      return;
    }
    try {
      setAttachmentProgress({ processed: 0, total: 1 });
      const selected = await attachmentServiceRef.current.select(kind);
      setAttachmentProgress({ processed: 1, total: 1 });
      setAttachmentError(mergeAttachments(selected));
      setComposerMenuOpen(false);
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : "No pude adjuntar ese elemento.");
    } finally {
      setAttachmentProgress(null);
    }
  };

  const openAttachmentPicker = (kind: "file" | "image" | "folder") => {
    setAttachmentError(null);
    if (kind === "folder") {
      void selectDesktopAttachments("folder");
      return;
    }
    if (workspaceExperience.environment === "desktop") {
      void selectDesktopAttachments("file");
      return;
    }
    setComposerMenuOpen(false);
    const input = kind === "image" ? webImageInputRef.current : webFileInputRef.current;
    if (!input) {
      setAttachmentError("El selector de archivos no está disponible en este navegador.");
      return;
    }
    input.click();
  };

  const removeAttachment = (token: string) => {
    setAttachments((current) => {
      const next = current.filter((item) => item.token !== token);
      attachmentsRef.current = next;
      return next;
    });
    void attachmentServiceRef.current.release([token]);
  };

  const prepareDroppedAttachments = async (files: FileList | File[]) => {
    setAttachmentDropActive(false);
    if (!files.length) return;
    setAttachmentError(null);
    if (!filePickerCapabilityEnabled) {
      setAttachmentError(filePickerDescriptor?.compatibilityReason ?? filePickerDescriptor?.reason ?? "Drag and drop no está disponible.");
      return;
    }
    const availableSlots = Math.max(0, WEB_ATTACHMENT_MAX_FILES - attachmentsRef.current.length);
    const selected = Array.from(files).slice(0, availableSlots);
    if (!selected.length) {
      setAttachmentError(`Puedes adjuntar hasta ${WEB_ATTACHMENT_MAX_FILES} archivos por mensaje.`);
      return;
    }
    setAttachmentProgress({ processed: 0, total: selected.length });
    const results = await Promise.all(selected.map(async (file) => {
      try {
        return { attachments: await attachmentServiceRef.current.prepareDropped([file]), error: null };
      } catch (cause) {
        return { attachments: [], error: cause instanceof Error ? cause.message : `No pude preparar “${file.name}”.` };
      } finally {
        setAttachmentProgress((current) => current ? { ...current, processed: current.processed + 1 } : null);
      }
    }));
    const prepared = results.flatMap((result) => result.attachments);
    const errors = results.flatMap((result) => result.error ? [result.error] : []);
    const mergeError = prepared.length ? mergeAttachments(prepared) : null;
    if (mergeError) errors.push(mergeError);
    if (Array.from(files).length > selected.length) errors.push(`Solo se agregaron los primeros ${selected.length} archivos disponibles.`);
    setAttachmentError(errors.length ? errors.join(" ") : null);
    setAttachmentProgress(null);
  };

  const persistAssistantPreferences = (planMode: "plan" | "default", skills: SkillCatalogItem[]) => {
    const taskId = workspaceExperience.task?.id;
    if (!taskId) return;
    void workspaceRuntimeServiceRef.current.updateTask(taskId, {
      assistantPreferences: {
        planModeEnabled: planMode === "plan",
        planModeName: planMode,
        selectedSkillNames: skills.map((skill) => skill.name).slice(0, 8)
      }
    }).then(() => workspaceExperienceService.refresh()).catch((cause) => {
      setContextError(cause instanceof Error ? cause.message : "No pude guardar las preferencias del siguiente Turn.");
    });
  };

  const changePlanMode = (mode: "plan" | "default") => {
    setSelectedPlanMode(mode);
    persistAssistantPreferences(mode, selectedSkills);
  };

  const toggleSkill = (skill: SkillCatalogItem) => {
    if (!extensionsServiceRef.current.selectableSkill(skill)) return;
    setSelectedSkills((current) => {
      const exists = current.some((entry) => entry.name === skill.name);
      const next = exists ? current.filter((entry) => entry.name !== skill.name) : [...current, skill].slice(0, 8);
      persistAssistantPreferences(selectedPlanMode, next);
      return next;
    });
  };

  const sendPrompt = async (promptOverride?: string, sourceOverride?: VisualInstructionSource) => {
    const text = (promptOverride ?? prompt).trim();
    if (!text || isRunning) return;
    const instructionSource = sourceOverride ?? promptSource;

    let conversationId = workspaceExperience.conversation?.id ?? null;
    let taskId = workspaceExperience.task?.id ?? null;
    let requestHistory = conversationId ? (messagesByThread[conversationId] ?? []) : [];
    if (!conversationId) {
      setContextBusy(true);
      try {
        await workspaceExperienceService.createTaskWithConversation({
          projectId: null,
          title: text.slice(0, 72)
        });
        const bootstrap = await workspaceRuntimeServiceRef.current.getBootstrap();
        conversationId = typeof bootstrap?.conversation?.id === "string" ? bootstrap.conversation.id : null;
        taskId = typeof bootstrap?.task?.id === "string" ? bootstrap.task.id : null;
        if (!bootstrap || !conversationId) throw new Error("No pude crear la Conversation inicial.");
        hydrateFromWorkspaceBootstrap(bootstrap);
        requestHistory = [];
      } catch (cause) {
        setContextError(cause instanceof Error ? cause.message : "No pude crear la Task inicial.");
        return;
      } finally {
        setContextBusy(false);
      }
    }

    if (!hasUserMessages && heroStage === "visible") {
      setHeroStage("exiting");
      window.setTimeout(() => {
        setHeroStage("hidden");
      }, 520);
    }

    const activeThread = threads.find((thread) => thread.id === conversationId);
    setPrompt("");
    setPromptSource("text");
    appendMessage("user", text, undefined, conversationId);
    void workspaceRuntimeServiceRef.current.appendMessage(conversationId, {
      id: createMessageId(),
      role: "user",
      body: text
    });
    setThreads((current) =>
      current.map((thread) =>
        thread.id === conversationId
          ? {
              ...thread,
              title: thread.title === "Nuevo chat" ? "Generando título..." : thread.title,
              preview: text.slice(0, 72)
            }
          : thread
      )
    );

    if (!activeThread || activeThread.title === "Nuevo chat" || activeThread.title === "Nueva tarea") {
      void generateThreadTitle(conversationId, taskId, text, requestHistory);
    }

    let proposalWorkspaceId: string | null = null;
    let proposalSequence: number | null = null;
    const visualInstruction = workspaceMode === "live" && Boolean(visualSnapshot.preview.url || visualSnapshot.selection);

    setIsRunning(true);
    setCodexActivity(emptyCodexActivity);
    try {
      if (visualInstruction && window.overlayBridge) {
        const proposalRuntime = proposalRuntimeServiceRef.current;
        if (!proposalRuntime.getSnapshot().availability.available) await proposalRuntime.initialize();
        const proposal = await proposalRuntime.createIteration({
          instruction: text,
          source: instructionSource,
          selectionLabel: visualSnapshot.selection?.label ?? null,
          author: "Usuario local"
        });
        proposalWorkspaceId = proposal.id;
        proposalSequence = proposal.sequence;
      }
      const planOption = planDescriptor?.enabled
        ? planModes.find((mode) => mode.mode === selectedPlanMode) ?? null
        : null;
      const result = await assistantRuntimeServiceRef.current.respond({
        prompt: text,
        history: requestHistory,
        clientId: clientIdRef.current,
        origin: window.overlayBridge ? "desktop-renderer" : "web-renderer",
        model: selectedModel || undefined,
        effort: selectedEffort || undefined,
        collaborationMode: planModeServiceRef.current.createTurnConfiguration(planOption, selectedModel, selectedEffort),
        attachments,
        skills: selectedSkills,
        interactionMode: proposalWorkspaceId ? "proposal" : workspaceMode,
        proposalWorkspaceId: proposalWorkspaceId ?? undefined,
        proposalContext: proposalWorkspaceId ? {
          sequence: proposalSequence,
          isolated: true,
          currentReadOnly: true
        } : null,
        visualContext: workspaceMode === "live"
          ? visualCollaborationServiceRef.current.buildInstructionContext({
              project: workspaceExperience.project?.name,
              task: workspaceExperience.task?.name,
              conversation: workspaceExperience.conversation?.title
            })
          : null,
        onActivity: (event) => setCodexActivity((current) => reduceCodexActivity(current, event))
      });
      if (proposalWorkspaceId) {
        if (result.ok) await proposalRuntimeServiceRef.current.complete(proposalWorkspaceId);
        else await proposalRuntimeServiceRef.current.fail(proposalWorkspaceId, result.output);
      }
      if (result.ok) {
        const sentTokens = new Set(attachments.map((attachment) => attachment.token));
        void attachmentServiceRef.current.release([...sentTokens]);
        setAttachments((current) => {
          const next = current.filter((attachment) => !sentTokens.has(attachment.token));
          attachmentsRef.current = next;
          return next;
        });
        setAttachmentError(null);
        setSelectedSkills([]);
        persistAssistantPreferences(selectedPlanMode, []);
      }

      const metadata: ChatMessage["metadata"] = result.capability === "web"
        ? {
            confidence: result.confidence,
            grounded: result.grounded,
            verifiedAt: result.verifiedAt,
            citations: result.citations as Citation[],
            warnings: result.warnings,
            conflicts: (result.metadata?.conflicts as Array<{ description?: string }> | undefined) ?? [],
            provider: result.provider,
            tool: result.tool
          }
        : undefined;
      appendMessage("assistant", result.output, metadata, conversationId);
      void workspaceRuntimeServiceRef.current.appendMessage(conversationId, {
        id: createMessageId(),
        role: "assistant",
        body: result.output,
        metadata
      });
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "Codex no pudo completar esta ejecución.";
      if (proposalWorkspaceId) await proposalRuntimeServiceRef.current.fail(proposalWorkspaceId, errorMessage).catch(() => undefined);
      appendMessage("assistant", errorMessage, undefined, conversationId);
      void workspaceRuntimeServiceRef.current.appendMessage(conversationId, {
        id: createMessageId(),
        role: "assistant",
        body: errorMessage
      });
    } finally {
      setIsRunning(false);
      setCodexActivity(null);
    }
  };

  const launchTest = async (target?: string | null) => {
    if (!window.overlayBridge?.launchCodexTest || testLaunching) return;
    setTestLaunching(true);
    setTestError(null);
    try {
      await window.overlayBridge.launchCodexTest(target ? { target } : undefined);
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : "No pude abrir la ventana de prueba.");
    } finally {
      setTestLaunching(false);
    }
  };

  const openFolder = async (target?: string | null) => {
    if (!window.overlayBridge?.openCodexFolder) return;
    try {
      await window.overlayBridge.openCodexFolder(target ? { target } : undefined);
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : "No pude abrir la carpeta.");
    }
  };

  const sendLiveInstruction = async (instructionOverride?: string, source: VisualInstructionSource = "text") => {
    const text = (instructionOverride ?? liveInstruction).trim();
    const conversationId = workspaceExperience.conversation?.id ?? null;
    if (!text || !conversationId || isRunning) {
      if (!conversationId) setContextError("Inicia una tarea antes de enviar instrucciones en Live.");
      return;
    }

    const conceptual = visualCollaborationServiceRef.current.beginProposal(text, source);
    setVisualSnapshot(conceptual.snapshot);
    setLiveInstruction("");
    setLiveActivityText(text);
    setLiveVoiceNotice(null);
    setIsRunning(true);
    let proposalWorkspaceId: string | null = null;
    try {
      if (window.overlayBridge && workspaceExperience.project?.hasDirectory) {
        const proposalRuntime = proposalRuntimeServiceRef.current;
        if (!proposalRuntime.getSnapshot().availability.available) await proposalRuntime.initialize();
        if (proposalRuntime.getSnapshot().availability.available) {
          const proposal = await proposalRuntime.createIteration({
            instruction: text,
            source,
            selectionLabel: visualSnapshot.selection?.label ?? null,
            author: "Usuario local"
          });
          proposalWorkspaceId = proposal.id;
        }
      }

      const result = await assistantRuntimeServiceRef.current.respond({
        prompt: text,
        history: messagesByThread[conversationId] ?? [],
        clientId: clientIdRef.current,
        origin: window.overlayBridge ? "desktop-renderer" : "web-renderer",
        model: selectedModel || undefined,
        effort: selectedEffort || undefined,
        attachments: [],
        skills: selectedSkills,
        interactionMode: proposalWorkspaceId ? "proposal" : "live",
        proposalWorkspaceId: proposalWorkspaceId ?? undefined,
        proposalContext: proposalWorkspaceId ? {
          sequence: proposalRuntimeServiceRef.current.getActiveProposal()?.sequence ?? null,
          isolated: true,
          currentReadOnly: true
        } : null,
        visualContext: visualCollaborationServiceRef.current.buildInstructionContext({
          project: workspaceExperience.project?.name,
          task: workspaceExperience.task?.name,
          conversation: workspaceExperience.conversation?.title
        })
      });

      if (proposalWorkspaceId) {
        if (result.ok) await proposalRuntimeServiceRef.current.complete(proposalWorkspaceId);
        else await proposalRuntimeServiceRef.current.fail(proposalWorkspaceId, result.output);
      }
      const proposalOutput = formatLiveProposalOutput(result.output, result.ok);
      setVisualSnapshot(result.ok
        ? visualCollaborationServiceRef.current.completeProposal(conceptual.proposal.id, proposalOutput)
        : visualCollaborationServiceRef.current.failProposal(conceptual.proposal.id, proposalOutput));
    } catch (cause) {
      const message = formatLiveProposalOutput(cause instanceof Error ? cause.message : "", false);
      if (proposalWorkspaceId) await proposalRuntimeServiceRef.current.fail(proposalWorkspaceId, message).catch(() => undefined);
      setVisualSnapshot(visualCollaborationServiceRef.current.failProposal(conceptual.proposal.id, message));
    } finally {
      setIsRunning(false);
    }
  };

  const maybeStartLiveVoiceCapture = async () => {
    const snapshot = voiceServiceRef.current.getSnapshot();
    if (!voiceCapabilityEnabled || !snapshot.supported) return;
    if (snapshot.status === "recording" || snapshot.status === "requesting" || snapshot.status === "transcribing") return;
    if (snapshot.permission === "denied") {
      setLiveVoiceNotice("Live sigue funcionando sin micrófono. Puedes activarlo manualmente cuando quieras.");
      return;
    }

    setLiveVoiceNotice(
      snapshot.permission === "granted"
        ? "Activando el micrófono para que puedas hablar de inmediato."
        : "Permitir micrófono para hablar con CoCreate."
    );

    try {
      await voiceServiceRef.current.start();
      setLiveVoiceNotice(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pude activar el micrófono.";
      if (/permission denied|permiso denegado|denied|notallowed|not allowed/i.test(message)) {
        setLiveVoiceNotice("Live sigue activo sin micrófono. Puedes escribir o volver a activarlo cuando quieras.");
        return;
      }
      setContextError(message);
    }
  };

  const toggleVoiceNote = async () => {
    setContextError(null);
    setLiveVoiceNotice(null);
    if (!voiceCapabilityEnabled) {
      setContextError(voiceDescriptor?.compatibilityReason ?? voiceDescriptor?.reason ?? "La captura de voz no esta disponible.");
      return;
    }
    try {
      if (voiceSnapshot.status === "recording") {
        await finishVoiceNote(false);
        return;
      }
      if (voiceSnapshot.status === "requesting" || voiceSnapshot.status === "transcribing") return;
      await voiceServiceRef.current.start();
    } catch (cause) {
      setContextError(cause instanceof Error ? cause.message : "No pude usar el microfono.");
    }
  };

  const finishVoiceNote = async (sendAfterTranscription: boolean) => {
    try {
      const transcript = await voiceServiceRef.current.stopAndTranscribe("es");
      if (!transcript) return;
      setLiveActivityText(transcript);
      if (workspaceMode === "live") {
        if (sendAfterTranscription) await sendLiveInstruction(transcript, "voice");
        else setLiveInstruction((current) => `${current}${current ? " " : ""}${transcript}`);
        return;
      }
      if (sendAfterTranscription) {
        await sendPrompt(transcript, "voice");
      } else {
        setPrompt((current) => `${current}${current ? " " : ""}${transcript}`);
        setPromptSource("voice");
        window.setTimeout(() => composerRef.current?.focus(), 0);
      }
    } catch (cause) {
      setContextError(cause instanceof Error ? cause.message : "No pude transcribir la nota de voz.");
    }
  };

  const cancelVoiceNote = async () => {
    setLiveVoiceNotice(null);
    await voiceServiceRef.current.cancel();
  };

  const changeConversationMode = async (mode: ConversationMode) => {
    if (mode === workspaceMode) return;
    if (mode === "live" && !workspaceExperience.conversation) {
      const created = await runContextAction(() => workspaceExperienceService.createTaskWithConversation({
        projectId: null,
        title: "Nueva tarea"
      }));
      if (!created) return;
      navigate("chat");
    }
    if (mode === "chat") screenSharingServiceRef.current.stop("mode-exit");
    setWorkspaceMode(mode);
  };

  const startScreenShare = async (preference: ScreenSharePreference) => {
    setContextError(null);
    const snapshot = await screenSharingServiceRef.current.start(preference);
    if (snapshot.status === "sharing") await maybeStartLiveVoiceCapture();
  };

  const undoLiveProposal = () => {
    const runtime = proposalRuntimeServiceRef.current;
    const proposals = runtime.getSnapshot().proposals;
    const activeIndex = proposals.findIndex((entry) => entry.id === runtime.getSnapshot().activeId);
    if (activeIndex > 0) runtime.select(proposals[activeIndex - 1].id);
    setVisualSnapshot(visualCollaborationServiceRef.current.undoProposal());
  };

  const discardLiveProposal = async () => {
    const runtime = proposalRuntimeServiceRef.current;
    const active = runtime.getActiveProposal();
    if (active && !["destroyed", "applied"].includes(active.status)) {
      await runtime.reject(active.id).catch(() => undefined);
      await runtime.destroy(active.id).catch(() => undefined);
    }
    setVisualSnapshot(visualCollaborationServiceRef.current.discardActiveProposal());
  };

  const exitLive = async (decision: "keep" | "discard") => {
    await voiceServiceRef.current.cancel().catch(() => undefined);
    screenSharingServiceRef.current.stop("mode-exit");
    if (decision === "discard") {
      await discardLiveProposal();
      setVisualSnapshot(visualCollaborationServiceRef.current.discardSession());
    }
    setWorkspaceMode("chat");
  };

  const appendImplementationUpdate = async (conversationId: string, body: string) => {
    appendMessage("assistant", body, undefined, conversationId);
    await workspaceRuntimeServiceRef.current.appendMessage(conversationId, {
      id: createMessageId(),
      role: "assistant",
      body
    });
  };

  const approveAndDevelop = async () => {
    const runtime = proposalRuntimeServiceRef.current;
    const active = runtime.getActiveProposal();
    const conversationId = workspaceExperience.conversation?.id ?? null;
    if (!active || !conversationId || !workspaceExperience.project?.hasDirectory || liveImplementationBusy) {
      if (!workspaceExperience.project?.hasDirectory) setProjectAssociationOpen(true);
      return;
    }

    setLiveImplementationBusy(true);
    setContextError(null);
    let returnedToChat = false;
    try {
      let proposal = active;
      if (proposal.status !== "approved") proposal = await runtime.approve(proposal.id);
      const conceptualId = visualCollaborationServiceRef.current.getSnapshot().activeProposalId;
      if (conceptualId) setVisualSnapshot(visualCollaborationServiceRef.current.decideProposal(conceptualId, "approve"));

      screenSharingServiceRef.current.stop("approval");
      setWorkspaceMode("chat");
      returnedToChat = true;
      await appendImplementationUpdate(conversationId, `Propuesta aprobada: ${proposal.instruction}\n\nEstoy desarrollando el cambio y preparando el resultado final.`);

      const implementation = await implementationRuntimeServiceRef.current.createAndStart({
        conversationId,
        projectId: workspaceExperience.project.id,
        proposalId: proposal.id
      });
      await workspaceExperienceService.refresh();
      if (["failed", "cancelled", "rolled_back"].includes(implementation.status)) {
        setContextError(implementation.failure?.message ?? implementation.progress.label);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No pude desarrollar la propuesta aprobada.";
      setContextError(message);
      if (returnedToChat) await appendImplementationUpdate(conversationId, `No pude completar el desarrollo: ${message}`);
    } finally {
      setLiveImplementationBusy(false);
    }
  };

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isMobileViewport()) {
      return;
    }

    event.preventDefault();

    const startWidth = isChatsCollapsed ? collapsedSidebarWidth : liveSidebarWidthRef.current;
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth
    };

    liveSidebarWidthRef.current = startWidth;
    pageRef.current?.style.setProperty("--sidebar-width", `${startWidth}px`);
    setIsChatsCollapsed(false);
    setIsResizingSidebar(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const shellStyle = {
    "--brand-accent": brandColor,
    "--sidebar-width": `${isChatsCollapsed ? collapsedSidebarWidth : sidebarWidth}px`,
    "--sidebar-collapsed-width": `${collapsedSidebarWidth}px`,
    "--sidebar-max-width": `${maxSidebarWidth}px`
  } as CSSProperties;

  return (
    <main ref={pageRef} className={`v01-page v01-${theme}`} style={shellStyle}>
      <div
        className={isChatsCollapsed ? "mobile-sidebar-backdrop" : "mobile-sidebar-backdrop visible"}
        onClick={() => setIsChatsCollapsed(true)}
        aria-hidden={isChatsCollapsed}
      />
      <div className={isChatsCollapsed ? "v01-shell sidebar-collapsed" : "v01-shell"}>
        <aside className="workspace-sidebar" aria-label="Navegación de CoCreate">
          <div className="workspace-sidebar-top">
            <div className="workspace-brand-row">
              <button
                className="sidebar-reveal"
                type="button"
                aria-label={isChatsCollapsed ? "Abrir barra lateral" : "Cerrar barra lateral"}
                onClick={() => setIsChatsCollapsed((current) => !current)}
              >
                {isChatsCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>

              <button
                className="brand-mark workspace-brand"
                type="button"
                aria-label="Inicio de CoCreate"
                onClick={() => setIsChatsCollapsed(false)}
              >
                {isChatsCollapsed ? (
                  <span className="brand-orbit" />
                ) : (
                  <label className="brand-orbit-picker" title="Cambiar color de CoCreate">
                    <span className="brand-orbit" />
                    <input
                      aria-label="Elegir color de CoCreate"
                      type="color"
                      value={brandColor}
                      onChange={(event) => setBrandColor(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </label>
                )}
                {!isChatsCollapsed ? <strong>CoCreate</strong> : null}
              </button>

              {!isChatsCollapsed ? (
                <button
                  className="sidebar-reveal sidebar-search-button"
                  type="button"
                  aria-label="Buscar conversaciones"
                  onClick={() => chatSearchRef.current?.focus()}
                >
                  <Search size={15} />
                </button>
              ) : null}
            </div>

            <button
              className="new-chat-button"
              type="button"
              title="Nueva tarea"
              disabled={contextBusy}
              onClick={() => void createBlankTask()}
            >
              <Plus size={15} />
              {!isChatsCollapsed ? <span>Nueva tarea</span> : null}
            </button>
          </div>

          {!isChatsCollapsed ? (
            <>
              <div className="workspace-sidebar-content">
                <PrimaryNavigation entries={featureEntries.filter((entry) => entry.id !== "new-task")} activeRoute={activeRoute} onNavigate={navigate} />

                <section className="workspace-structure-nav workspace-projects-nav" aria-label="Proyectos">
                  <div className="workspace-section-head">
                    <span>Proyectos</span>
                    <button type="button" aria-label="Agregar proyecto" aria-expanded={projectCreatorOpen} onClick={() => setProjectCreatorOpen((current) => !current)}><Plus size={13} /></button>
                  </div>
                  {projectCreatorOpen ? (
                    <div className="sidebar-project-creator">
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        if (!newProjectName.trim()) return;
                        void contextActions.createProject(newProjectName.trim()).then(() => {
                          setNewProjectName("");
                          setProjectCreatorOpen(false);
                        });
                      }}>
                        <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Nombre del proyecto" aria-label="Nombre del proyecto" maxLength={80} />
                        <button type="submit" disabled={!newProjectName.trim() || contextBusy}>Crear</button>
                      </form>
                      {workspaceExperience.environment === "desktop" ? <button type="button" disabled={contextBusy} onClick={() => void contextActions.createProjectFromDirectory().then(() => setProjectCreatorOpen(false))}><FolderOpen size={14} /> Agregar carpeta local</button> : null}
                    </div>
                  ) : null}
                  {workspaceExperience.projects.filter((project) => !project.archived).map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={project.id === workspaceExperience.project?.id ? "project-context-row active" : "project-context-row"}
                      onClick={() => {
                        navigate("chat");
                        void contextActions.selectProject(project.id);
                      }}
                    >
                      <FolderOpen size={15} />
                      <span><strong>{project.name}</strong><small>{project.rootPathLabel ?? (workspaceExperience.environment === "desktop" ? "Sin carpeta" : "Proyecto web")}</small></span>
                    </button>
                  ))}
                </section>

                <section className="workspace-chats workspace-tasks-nav" aria-label="Tareas">
                  <div className="workspace-section-head">
                    <span>Tareas</span>
                  </div>

                  <label className="chat-search sidebar-search-field">
                    <Search size={15} />
                    <input
                      ref={chatSearchRef}
                      placeholder="Buscar tareas"
                      value={chatSearch}
                      onChange={(event) => setChatSearch(event.target.value)}
                    />
                  </label>

                  <div className="chat-list">
                    {workspaceExperience.tasks.filter((task) => !task.archived && (!chatSearch.trim() || task.name.toLowerCase().includes(chatSearch.trim().toLowerCase()))).length ? (
                      workspaceExperience.tasks.filter((task) => !task.archived && (!chatSearch.trim() || task.name.toLowerCase().includes(chatSearch.trim().toLowerCase()))).map((task) => (
                        <button
                          key={task.id}
                          className={workspaceExperience.task?.id === task.id ? "chat-row active" : "chat-row"}
                          type="button"
                          onClick={() => {
                            capabilityExposureService.resetActivity();
                            navigate("chat");
                            void contextActions.selectTask(task.id);
                          }}
                        >
                          <Code2 size={15} />
                          <span>
                            <strong>{task.name}</strong>
                            <small>{task.projectId ? workspaceExperience.projects.find((project) => project.id === task.projectId)?.name ?? "Proyecto" : "Sin proyecto"}</small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="sidebar-empty-state">
                        Tus tareas aparecerán aquí cuando empieces una conversación.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <PrimaryNavigation entries={featureEntries.filter((entry) => entry.id !== "new-task")} activeRoute={activeRoute} collapsed onNavigate={navigate} />
          )}
          <div className="workspace-sidebar-footer">
            <CodexAccountPanel collapsed={isChatsCollapsed} />
          </div>
          <div
            className={isResizingSidebar ? "workspace-resize-handle active" : "workspace-resize-handle"}
            role="separator"
            aria-orientation="vertical"
            aria-label="Cambiar ancho del sidebar"
            onPointerDown={startSidebarResize}
          />
        </aside>

        <div className={workspaceMode === "live" && activeRoute === "chat" ? "v01-main-panel live-shell" : "v01-main-panel"}>
          <header className="v01-topbar">
            <div className="topbar-left">
              <button
                className="sidebar-reveal mobile-sidebar-toggle"
                type="button"
                aria-label={isChatsCollapsed ? "Abrir barra lateral" : "Cerrar barra lateral"}
                onClick={() => setIsChatsCollapsed((current) => !current)}
              >
                {isChatsCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
              <span className="mobile-thread-label">{activeRoute === "chat" ? activeThread?.title ?? "Chat" : activeFeature.label}</span>
            </div>

            <div className="topbar-actions">
              <button
                className="theme-toggle"
                type="button"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
              >
                {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
                <span className="sr-only">{theme === "dark" ? "Tema claro" : "Tema oscuro"}</span>
              </button>
            </div>
          </header>

          {activeRoute === "chat" && workspaceMode === "chat" ? (
            <div className="workspace-chat-header mode-chat">
              <WorkspaceContextBar
                state={workspaceExperience}
                actions={contextActions}
                busy={contextBusy}
                error={contextError}
              />
              <LiveModeSwitch
                mode={workspaceMode}
                liveAvailable={workspaceExperience.environment === "web" || codexStatus?.available === true}
                unavailableReason="Conecta Codex para iniciar Live."
                onChange={(mode) => void changeConversationMode(mode)}
              />
            </div>
          ) : null}

          {activeRoute === "chat" ? (
          <div className={`workspace-mode-layout mode-${workspaceMode}`}>
          <section className={`${hasUserMessages ? "v01-center is-chat-active" : "v01-center"}${workspaceMode === "live" ? " live-active" : ""}`}>
            {workspaceMode === "chat" && heroStage !== "hidden" ? (
              <div className={heroStage === "exiting" ? "hero-copy hero-copy-exit" : "hero-copy"}>
                <h1 className="hero-wordmark">
                  <span className="hero-wordmark-co">Co</span>
                  <span className="hero-wordmark-create">Create</span>
                </h1>
              </div>
            ) : null}

            {workspaceMode === "live" ? (
              <VisualCollaborationWorkspace
                snapshot={visualSnapshot}
                proposalRuntime={proposalRuntimeSnapshot}
                screen={screenSharingSnapshot}
                stream={screenSharingServiceRef.current.getStream()}
                environment={workspaceExperience.environment}
                projectLinked={Boolean(workspaceExperience.project?.hasDirectory)}
                voice={voiceSnapshot}
                voiceElapsedSeconds={voiceElapsedSeconds}
                voiceAvailable={voiceCapabilityEnabled && voiceSnapshot.supported}
                voiceHint={liveVoiceHint}
                voiceHintActionLabel={liveVoiceHintActionLabel}
                liveStage={liveStage}
                liveIntentSummary={liveIntentSummary}
                liveWorkingNotes={liveWorkingNotes}
                liveObservedElements={liveObservedElements}
                liveStatusFeed={liveStatusFeed}
                liveConfidence={liveConfidence}
                liveExecutionSuggestions={liveExecutionSuggestions}
                liveTranscriptPreview={liveActivityText}
                instruction={liveInstruction}
                instructionBusy={isRunning || liveImplementationBusy}
                onInstructionChange={setLiveInstruction}
                onSubmitInstruction={() => void sendLiveInstruction()}
                onToggleVoice={() => void toggleVoiceNote()}
                onCancelVoice={() => void cancelVoiceNote()}
                onStopVoice={() => void finishVoiceNote(false)}
                onTranscribeAndSend={() => void finishVoiceNote(true)}
                onShare={(preference) => void startScreenShare(preference)}
                onChangeShare={() => void startScreenShare(screenSharingSnapshot.preference ?? "screen")}
                onStopShare={() => screenSharingServiceRef.current.stop("user")}
                onTogglePause={() => screenSharingServiceRef.current.togglePause()}
                onOpenPermissionSettings={() => void screenSharingServiceRef.current.openPermissionSettings()}
                onPreviewUrl={(url) => {
                  const result = visualCollaborationServiceRef.current.setPreviewUrl(url);
                  if (result.ok) setVisualSnapshot(result.snapshot);
                  return result.ok ? { ok: true } : { ok: false, error: result.error };
                }}
                onUseProjectPreview={() => setVisualSnapshot(visualCollaborationServiceRef.current.refreshPreview())}
                onComparisonMode={(mode) => setVisualSnapshot(visualCollaborationServiceRef.current.setComparisonMode(mode))}
                onTool={(tool) => setVisualSnapshot(visualCollaborationServiceRef.current.setTool(tool))}
                onHover={(bounds) => setVisualSnapshot(visualCollaborationServiceRef.current.setHover(bounds))}
                onSelect={(bounds) => setVisualSnapshot(visualCollaborationServiceRef.current.select(bounds))}
                onMovePointer={(point) => setVisualSnapshot(visualCollaborationServiceRef.current.movePointer(point))}
                onAddAnnotation={(kind, start, end) => setVisualSnapshot(visualCollaborationServiceRef.current.addAnnotation(kind, start, end))}
                onClearAnnotations={() => setVisualSnapshot(visualCollaborationServiceRef.current.clearAnnotations())}
                onRenameSelection={(label) => setVisualSnapshot(visualCollaborationServiceRef.current.renameSelection(label))}
                onClearSelection={() => setVisualSnapshot(visualCollaborationServiceRef.current.clearSelection())}
                onProposalSelect={(proposalId) => proposalRuntimeServiceRef.current.select(proposalId)}
                onProposalPreviewStart={(proposalId) => { void proposalRuntimeServiceRef.current.startPreview(proposalId).catch(() => undefined); }}
                onProposalPreviewStop={(proposalId) => { void proposalRuntimeServiceRef.current.stopPreview(proposalId).catch(() => undefined); }}
                onProposalPreviewRestart={(proposalId) => { void proposalRuntimeServiceRef.current.restartPreview(proposalId).catch(() => undefined); }}
                onProposalPreviewRefresh={(proposalId) => { void proposalRuntimeServiceRef.current.refreshPreview(proposalId).catch(() => undefined); }}
                onUndoProposal={undoLiveProposal}
                onDiscardProposal={() => void discardLiveProposal()}
                onApproveAndDevelop={() => void approveAndDevelop()}
                onLinkProject={() => setProjectAssociationOpen(true)}
                onExit={(decision) => void exitLive(decision)}
              />
            ) : null}

            {workspaceMode === "chat" ? <>
            <section
              ref={conversationRef}
              className={hasUserMessages ? "conversation-strip" : "conversation-strip is-empty"}
              aria-label="Conversación"
            >
              {hasUserMessages
                ? activeMessages.map((message) => {
                    const citations = safeCitations(message);
                    const verifiedAt = formatVerifiedAt(message.metadata?.verifiedAt);
                    return (
                      <article key={message.id} className={`v01-message ${message.role}`}>
                        <div className="v01-message-body">{message.body}</div>
                        {message.role === "assistant" && citations.length ? (
                          <footer className="trusted-citations" aria-label="Fuentes verificadas">
                            <div className="trusted-citations-status">
                              <BadgeCheck size={14} aria-hidden="true" />
                              <span>
                                {message.metadata?.confidence === "VerifiedWithConflict"
                                  ? "Verificada con conflicto"
                                  : "Respuesta verificada"}
                                {verifiedAt ? ` · ${verifiedAt}` : ""}
                              </span>
                            </div>
                            {message.metadata?.confidence === "VerifiedWithConflict" ? (
                              <p className="trusted-citations-conflict">
                                {message.metadata.conflicts?.[0]?.description ?? "Las fuentes recuperadas presentan diferencias."}
                              </p>
                            ) : null}
                            <div className="trusted-citations-links">
                              {citations.map((citation) => (
                                <a
                                  key={citation.id}
                                  href={citation.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={citation.title}
                                >
                                  <span>{citation.domain}</span>
                                  <ExternalLink size={12} aria-hidden="true" />
                                </a>
                              ))}
                            </div>
                          </footer>
                        ) : null}
                      </article>
                    );
                  })
                : null}
              {codexActivity ? <CodexActivityCard activity={codexActivity} /> : null}
              {activeImplementationOperations.map((operation) => (
                <ImplementationProgressCard
                  key={operation.id}
                  operation={operation}
                  busy={implementationRuntimeSnapshot.busyAction !== null}
                  onCancel={() => void implementationRuntimeServiceRef.current.cancel(operation.id).catch((cause) => setContextError(cause instanceof Error ? cause.message : "No pude cancelar la implementación."))}
                  onResolveConflict={(conflictId, resolution) => void implementationRuntimeServiceRef.current.resolveConflict(operation.id, conflictId, resolution).catch((cause) => setContextError(cause instanceof Error ? cause.message : "No pude resolver el conflicto."))}
                  onRetry={() => void implementationRuntimeServiceRef.current.continue(operation.id).catch((cause) => setContextError(cause instanceof Error ? cause.message : "No pude volver a comprobar el repositorio."))}
                  onRollback={() => void implementationRuntimeServiceRef.current.rollback(operation.id).then(() => workspaceExperienceService.refresh()).catch((cause) => setContextError(cause instanceof Error ? cause.message : "No pude revertir la implementación."))}
                  onRecover={() => void implementationRuntimeServiceRef.current.recover(operation.id).then(() => workspaceExperienceService.refresh()).catch((cause) => setContextError(cause instanceof Error ? cause.message : "No pude recuperar la implementación."))}
                />
              ))}
              {window.overlayBridge?.launchCodexTest && hasUserMessages && !isRunning && !codexActivity && (builtWebPath || workspaceExperience.project?.hasDirectory) ? (
                <div className="codex-test-bar">
                  <button type="button" className="codex-test-button" disabled={testLaunching} onClick={() => void launchTest(builtWebPath)}>
                    {testLaunching ? <LoaderCircle size={15} className="codex-activity-spin" /> : <Play size={15} />}
                    <span>{testLaunching ? "Abriendo…" : "Probar"}</span>
                  </button>
                  <button type="button" className="codex-test-button codex-test-button-ghost" onClick={() => void openFolder(builtWebPath)}>
                    <FolderOpen size={15} />
                    <span>Abrir en carpeta</span>
                  </button>
                  {testError ? <span className="codex-test-error" role="alert">{testError}</span> : null}
                </div>
              ) : null}
            </section>

            {workspaceMode === "chat" ? (
              <WorkspaceWorkPanel
                state={workspaceExperience}
                approval={approvalState}
                onApprovalResponse={(decision) => approvalRuntimeServiceRef.current.respond(decision)}
              />
            ) : null}

            <div
              className={`composer-shell${attachmentDropActive ? " drop-active" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); if (filePickerCapabilityEnabled) setAttachmentDropActive(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAttachmentDropActive(false); }}
              onDrop={(event) => { event.preventDefault(); void prepareDroppedAttachments(event.dataTransfer.files); }}
            >
              {workspaceExperience.environment === "web" ? (
                <>
                  <input
                    ref={webFileInputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    accept={WEB_ATTACHMENT_ACCEPT}
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      void prepareDroppedAttachments(files);
                    }}
                  />
                  <input
                    ref={webImageInputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    accept={WEB_IMAGE_ACCEPT}
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      void prepareDroppedAttachments(files);
                    }}
                  />
                </>
              ) : null}
              <AttachmentTray
                attachments={attachments}
                error={attachmentError}
                progress={attachmentProgress}
                onAdd={() => openAttachmentPicker("file")}
                onRemove={removeAttachment}
              />
              {selectedSkills.length ? (
                <div className="attachment-tray skill-tray" aria-label="Skills preparadas para el siguiente Turn">
                  {selectedSkills.map((skill) => <span key={skill.name} className="attachment-chip kind-skill"><Code2 size={13} /><span><strong>{skill.name}</strong><small>Próximo mensaje</small></span><button type="button" aria-label={`Quitar skill ${skill.name}`} onClick={() => toggleSkill(skill)}><X size={12} /></button></span>)}
                </div>
              ) : null}
              {attachmentDropActive ? <div className="composer-drop-overlay" aria-hidden="true"><strong>Suelta tus archivos aquí</strong><small>Los revisaremos antes de enviarlos</small></div> : null}
              {voiceComposerActive ? (
                <VoiceRecordingPanel
                  elapsedSeconds={voiceElapsedSeconds}
                  transcribing={voiceSnapshot.status === "transcribing"}
                  statusLabel={voiceSnapshot.status === "transcribing" ? "Entendiendo tu indicación..." : "Escuchando..."}
                  transcriptPreview={promptSource === "voice" ? prompt : null}
                  onCancel={() => void cancelVoiceNote()}
                  onStop={() => void finishVoiceNote(false)}
                  onTranscribeAndSend={() => void finishVoiceNote(true)}
                />
              ) : (
                <label className="composer-panel">
                  <textarea
                    ref={composerRef}
                    rows={2}
                    value={prompt}
                    onChange={(event) => { setPrompt(event.target.value); setPromptSource("text"); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendPrompt();
                      }
                    }}
                    placeholder="¿Qué quieres crear, cambiar o resolver?"
                  />
                </label>
              )}

              {!voiceComposerActive ? <div className="composer-footer">
                <div className="composer-context-actions">
                  <div className="composer-plus-wrap">
                    <button className="composer-plus" type="button" aria-label="Agregar contexto" aria-expanded={composerMenuOpen} onClick={() => { setComposerMenuView("root"); setComposerMenuOpen((current) => !current); }}>
                      <Plus size={15} />
                    </button>
                    {composerMenuOpen ? (
                      <div className="composer-plus-menu" role="menu">
                        {composerMenuView === "root" ? (
                          <>
                            <button type="button" role="menuitem" disabled={!filePickerCapabilityEnabled} onClick={() => openAttachmentPicker("file")}><Paperclip size={14} /><span>Adjuntar archivo<small>Documentos y archivos de proyecto</small></span></button>
                            <button type="button" role="menuitem" disabled={!filePickerCapabilityEnabled} onClick={() => openAttachmentPicker("image")}><ImageIcon size={14} /><span>Adjuntar imagen<small>PNG, JPEG, GIF o WebP</small></span></button>
                            {workspaceExperience.environment === "desktop" ? <button type="button" role="menuitem" disabled={!folderPickerCapabilityEnabled} onClick={() => openAttachmentPicker("folder")}><FolderOpen size={14} /><span>Adjuntar carpeta<small>Usar una carpeta del proyecto</small></span></button> : null}
                            <button type="button" role="menuitem" onClick={() => setComposerMenuView("context")}><Code2 size={14} /><span>Agregar contexto…<small>Skills y cambios recientes</small></span></button>
                            <div className="composer-menu-separator" />
                            <button type="button" role="menuitem" onClick={() => { setComposerMenuOpen(false); navigate("extensions"); }}><Code2 size={14} /><span>Administrar complementos<small>Gestionar herramientas</small></span></button>
                          </>
                        ) : (
                          <>
                            <button type="button" role="menuitem" onClick={() => setComposerMenuView("root")}><ChevronDown className="menu-back-icon" size={14} /><span>Volver<small>Adjuntos y acciones</small></span></button>
                            {workspaceExperience.artifacts.slice(0, 3).map((artifact) => <button key={artifact.id} type="button" role="menuitem" onClick={() => { setPrompt((current) => `${current}${current ? "\n" : ""}Revisa el cambio: ${artifact.title}`); setComposerMenuOpen(false); }}><FileText size={14} /><span>{artifact.title}<small>Cambio reciente</small></span></button>)}
                            {extensionCatalog.skills.data.filter((skill) => extensionsServiceRef.current.selectableSkill(skill)).slice(0, 6).map((skill) => <button key={skill.name} type="button" role="menuitemcheckbox" aria-checked={selectedSkills.some((entry) => entry.name === skill.name)} onClick={() => toggleSkill(skill)}><Code2 size={14} /><span>{skill.name}<small>{selectedSkills.some((entry) => entry.name === skill.name) ? "Seleccionada" : skill.description || "Usar en el próximo mensaje"}</small></span></button>)}
                            {!workspaceExperience.artifacts.length && !extensionCatalog.skills.data.some((skill) => extensionsServiceRef.current.selectableSkill(skill)) ? <p className="composer-menu-empty">No hay contexto adicional disponible.</p> : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {models.length ? (
                    <label className="model-selector" title={models.find((model) => model.model === selectedModel)?.description || "Modelo para el próximo mensaje"}>
                      <span className="sr-only">Modelo para el próximo mensaje</span>
                      <select value={selectedModel} onChange={(event) => {
                        const model = models.find((option) => option.model === event.target.value);
                        const nextEffort = model?.defaultReasoningEffort ?? "";
                        setSelectedModel(event.target.value);
                        setSelectedEffort(nextEffort);
                        try {
                          window.localStorage.setItem("cocreate.selectedModel", event.target.value);
                          window.localStorage.setItem("cocreate.selectedEffort", nextEffort);
                        } catch {
                          /* ignore */
                        }
                      }}>
                        {models.map((model) => <option key={model.id} value={model.model}>{model.displayName}</option>)}
                      </select>
                      <ChevronDown size={12} aria-hidden="true" />
                    </label>
                  ) : null}

                  {models.find((model) => model.model === selectedModel)?.supportedReasoningEfforts.length ? (
                    <label className="model-selector effort-selector">
                      <span className="sr-only">Esfuerzo de razonamiento</span>
                      <select value={selectedEffort} onChange={(event) => {
                        setSelectedEffort(event.target.value);
                        try {
                          window.localStorage.setItem("cocreate.selectedEffort", event.target.value);
                        } catch {
                          /* ignore */
                        }
                      }}>
                        {models.find((model) => model.model === selectedModel)!.supportedReasoningEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {planModes.length && planDescriptor?.enabled ? (
                    <label className={`model-selector plan-selector${selectedPlanMode === "plan" ? " active" : ""}`} title="Modo para el próximo mensaje">
                      <span className="sr-only">Modo para el próximo mensaje</span>
                      <select value={selectedPlanMode} onChange={(event) => changePlanMode(event.target.value === "plan" ? "plan" : "default")}>
                        {planModes.map((mode) => <option key={mode.id} value={mode.mode}>{mode.name}</option>)}
                      </select>
                      <ChevronDown size={12} aria-hidden="true" />
                    </label>
                  ) : null}
                </div>

                <div className="composer-actions">
                  {voiceCapabilityEnabled && voiceSnapshot.devices.length > 1 ? (
                    <label className="model-selector voice-device-selector"><span className="sr-only">Microfono</span><select value={voiceSnapshot.selectedDeviceId ?? ""} onChange={(event) => voiceServiceRef.current.selectDevice(event.target.value)}>{voiceSnapshot.devices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
                  ) : null}
                  {voiceCapabilityEnabled && voiceSnapshot.supported ? <button
                    className="voice-action"
                    type="button"
                    onClick={() => void toggleVoiceNote()}
                    disabled={voiceSnapshot.status === "requesting"}
                    title={voiceSnapshot.error ?? "Grabar nota de voz"}
                    aria-label={voiceSnapshot.permission === "denied" ? "Permiso de micrófono denegado" : "Grabar nota de voz"}
                  >
                    {voiceSnapshot.status === "requesting" ? <LoaderCircle className="spin" size={15} /> : <Mic size={15} />}
                  </button> : null}
                  <button className="primary-action" type="button" onClick={() => void sendPrompt()} disabled={isRunning}>
                    {isRunning ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                    <span>{isRunning ? "Enviando" : "Enviar"}</span>
                  </button>
                </div>
              </div> : null}
              <div className="composer-status-line" aria-live="polite">
                {voiceSnapshot.error
                  ? voiceSnapshot.error
                  : selectedSkills.length ? `${selectedSkills.length} skill${selectedSkills.length === 1 ? "" : "s"} lista${selectedSkills.length === 1 ? "" : "s"}` : "Enter para enviar · Shift + Enter para salto"}
              </div>
            </div>

            <button className="send-fab" type="button" title="Enviar" onClick={() => void sendPrompt()} disabled={isRunning}>
              {isRunning ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            </button>
            </> : null}
          </section>
          </div>
          ) : (
            <FeatureRouteOutlet
              route={activeRoute}
              entry={activeFeature}
              workspace={workspaceExperience}
              busy={contextBusy}
              error={contextError}
              onCreateProject={contextActions.createProject}
              onSelectProject={contextActions.selectProject}
              onCreateTask={contextActions.createTask}
              onOpenChat={() => navigate("chat")}
              extensions={extensionCatalog}
              extensionsLoading={extensionsLoading}
              selectedSkillNames={selectedSkills.map((skill) => skill.name)}
              onToggleSkill={toggleSkill}
              onRefreshExtensions={() => void refreshUpstreamFeatures()}
            />
          )}
        </div>
      </div>
      <ProjectAssociationDialog
        open={projectAssociationOpen}
        taskName={workspaceExperience.task?.name ?? "esta tarea"}
        projects={workspaceExperience.projects}
        environment={workspaceExperience.environment}
        busy={contextBusy}
        onClose={() => setProjectAssociationOpen(false)}
        onAssociate={(projectId) => void associateCurrentTaskProject(projectId)}
        onCreate={(name) => void createAndAssociateProject(name)}
        onCreateFromDirectory={() => void createDirectoryProjectAndAssociate()}
      />
    </main>
  );
}
