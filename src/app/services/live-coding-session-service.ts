import type { ApprovalRequest, ApprovalState } from "./approval-runtime-service.js";
import type {
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
  WorkspaceExperienceState
} from "./workspace-experience-service.js";

export type WorkspaceMode = "chat" | "live";
export type LiveSessionStatus = "ready" | "running" | "waiting-approval" | "completed" | "cancelled" | "failed";
export type LiveTimelineStatus = "completed" | "active" | "waiting" | "failed";
export type WorkingChangeStatus = "pending" | "approved" | "discarded" | "applied" | "recorded";

export type LiveTimelineItem = {
  id: string;
  label: string;
  status: LiveTimelineStatus;
  timestamp: string;
  source: "workspace" | "voice" | "session";
};

export type WorkingChange = {
  id: string;
  approvalId: string | null;
  artifactId: string | null;
  title: string;
  files: string[];
  additions: number | null;
  deletions: number | null;
  preview: string | null;
  status: WorkingChangeStatus;
  actionable: boolean;
  reviewable: boolean;
  timestamp: string;
};

export type LiveSessionSnapshot = {
  id: string | null;
  mode: WorkspaceMode;
  project: { id: string; name: string } | null;
  task: { id: string; name: string } | null;
  conversation: { id: string; title: string } | null;
  status: LiveSessionStatus;
  startedAt: string | null;
  durationMs: number;
  progress: number;
  currentAction: string;
  executionId: string | null;
  canCancel: boolean;
  openedFiles: string[];
  modifiedFiles: string[];
  tools: Array<{ id: string; label: string; status: string }>;
  artifacts: WorkspaceArtifactItem[];
  approvals: ApprovalRequest[];
  workingChanges: WorkingChange[];
  timeline: LiveTimelineItem[];
};

type VoiceInstruction = { id: string; timestamp: string };
type ChangeDecision = { status: "approved" | "discarded"; artifactId: string | null; timestamp: string };

const ACTIVITY_LABELS: Record<string, string> = {
  "capability.turn.started": "Analizando proyecto",
  "capability.plan.updated": "Generando propuesta",
  "capability.diff.created": "Propuesta lista para revisar",
  "capability.patch.applied": "Cambios aplicados",
  "capability.approval.requested": "Revisión solicitada"
};

function isFileChangeApproval(request: ApprovalRequest | null): request is ApprovalRequest {
  return Boolean(request && /file|archivo/i.test(`${request.category} ${request.action}`));
}

function statusFromWorkspace(state: WorkspaceExperienceState): LiveSessionStatus {
  if (state.approval?.active) return "waiting-approval";
  if (state.activeWork.id === "failed") return "failed";
  if (state.activeWork.id === "cancelled" || state.activeWork.id === "interrupted") return "cancelled";
  if (state.activeWork.id === "completed") return "completed";
  if (state.activeWork.active) return "running";
  return "ready";
}

function currentAction(state: WorkspaceExperienceState, status: LiveSessionStatus) {
  if (status === "waiting-approval") return "Revisa los cambios antes de continuar";
  if (status === "completed") return "Trabajo finalizado";
  if (status === "cancelled") return "Ejecución cancelada";
  if (status === "failed") return "La ejecución necesita atención";
  const labels: Record<string, string> = {
    preparing: "Analizando proyecto",
    planning: "Generando propuesta",
    applying: "Aplicando cambios aprobados",
    testing: "Ejecutando validaciones"
  };
  if (labels[state.activeWork.id]) return labels[state.activeWork.id];
  if (state.command?.label) return state.command.label.replace(/\.\.\.$/, "");
  if (state.tool?.label) return /analiz/i.test(state.tool.label) ? "Leyendo archivos" : state.tool.label.replace(/\.\.\.$/, "");
  return status === "running" ? "Trabajando" : "Listo para comenzar";
}

function progressFromWorkspace(state: WorkspaceExperienceState, status: LiveSessionStatus) {
  if (status === "completed") return 100;
  if (status === "failed" || status === "cancelled") return 100;
  const progress: Record<string, number> = {
    preparing: 14,
    planning: 32,
    running: 52,
    "waiting-approval": 68,
    applying: 76,
    testing: 88
  };
  return progress[state.activeWork.id] ?? 0;
}

function activityLabel(activity: WorkspaceActivityItem) {
  if (ACTIVITY_LABELS[activity.type]) return ACTIVITY_LABELS[activity.type];
  if (/test|prueba|validation/i.test(activity.summary)) return "Validaciones ejecutadas";
  if (/build|compil/i.test(activity.summary)) return "Proyecto compilado";
  if (/artifact/i.test(activity.type)) return "Artifact creado";
  return null;
}

function timelineStatus(state: WorkspaceExperienceState): LiveTimelineStatus {
  if (state.activeWork.id === "failed") return "failed";
  if (state.activeWork.id === "waiting-approval") return "waiting";
  return state.activeWork.active ? "active" : "completed";
}

function workingArtifacts(artifacts: WorkspaceArtifactItem[]) {
  return artifacts.filter((artifact) =>
    artifact.type === "diff" || (
      artifact.type === "patch" &&
      !artifacts.some((candidate) => candidate.type === "diff" && candidate.executionId === artifact.executionId)
    )
  );
}

function latestDiff(artifacts: WorkspaceArtifactItem[]) {
  return workingArtifacts(artifacts).find((artifact) => artifact.disposition === "proposed") ?? null;
}

function hasAppliedPatch(artifact: WorkspaceArtifactItem, artifacts: WorkspaceArtifactItem[]) {
  return artifacts.some((candidate) =>
    candidate.type === "patch" &&
    candidate.disposition === "applied" &&
    Boolean(candidate.executionId) &&
    candidate.executionId === artifact.executionId
  );
}

export class LiveCodingSessionService {
  private mode: WorkspaceMode = "chat";
  private startedAt: string | null = null;
  private contextKey: string | null = null;
  private voiceInstructions: VoiceInstruction[] = [];
  private decisions = new Map<string, ChangeDecision>();

  start(state: WorkspaceExperienceState, timestamp = new Date().toISOString()) {
    const nextContextKey = `${state.project?.id ?? "none"}:${state.task?.id ?? "none"}:${state.conversation?.id ?? "none"}`;
    if (this.mode !== "live" || this.contextKey !== nextContextKey) {
      this.startedAt = timestamp;
      this.contextKey = nextContextKey;
      this.voiceInstructions = [];
      this.decisions.clear();
    }
    this.mode = "live";
  }

  stop() {
    this.mode = "chat";
  }

  recordVoiceInstruction(timestamp = new Date().toISOString()) {
    this.voiceInstructions.push({ id: `voice-${timestamp}-${this.voiceInstructions.length}`, timestamp });
    this.voiceInstructions = this.voiceInstructions.slice(-20);
  }

  recordDecision(request: ApprovalRequest, decision: "approve" | "reject", succeeded: boolean, artifactId: string | null = null) {
    if (!succeeded || !isFileChangeApproval(request)) return;
    this.decisions.set(request.approvalId, {
      status: decision === "approve" ? "approved" : "discarded",
      artifactId,
      timestamp: new Date().toISOString()
    });
  }

  getSnapshot(state: WorkspaceExperienceState, approval: ApprovalState, now = Date.now()): LiveSessionSnapshot {
    const status = approval.pending ? "waiting-approval" : statusFromWorkspace(state);
    const pendingFileApproval = isFileChangeApproval(approval.pending) ? approval.pending : null;
    const diff = latestDiff(state.artifacts);
    const decision = pendingFileApproval ? this.decisions.get(pendingFileApproval.approvalId) : null;
    const workingChanges = workingArtifacts(state.artifacts)
      .map<WorkingChange>((artifact) => {
        const ownsPendingApproval = Boolean(pendingFileApproval && artifact.id === diff?.id);
        const savedDecision = ownsPendingApproval ? decision : Array.from(this.decisions.values()).find((entry) => entry.artifactId === artifact.id);
        const changeStatus: WorkingChangeStatus = ownsPendingApproval
          ? "pending"
          : hasAppliedPatch(artifact, state.artifacts)
            ? "applied"
            : savedDecision?.status ?? "recorded";
        return {
          id: ownsPendingApproval ? pendingFileApproval!.approvalId : artifact.id,
          approvalId: ownsPendingApproval ? pendingFileApproval!.approvalId : null,
          artifactId: artifact.id,
          title: ownsPendingApproval ? "Cambios pendientes de aprobación" : artifact.title,
          files: artifact.files,
          additions: artifact.additions,
          deletions: artifact.deletions,
          preview: artifact.preview,
          status: changeStatus,
          actionable: ownsPendingApproval,
          reviewable: Boolean(artifact.preview),
          timestamp: artifact.timestamp
        };
      });

    if (pendingFileApproval && !workingChanges.some((change) => change.approvalId === pendingFileApproval.approvalId)) {
      workingChanges.unshift({
        id: pendingFileApproval.approvalId,
        approvalId: pendingFileApproval.approvalId,
        artifactId: null,
        title: "Cambios pendientes de aprobación",
        files: [],
        additions: null,
        deletions: null,
        preview: null,
        status: "pending",
        actionable: true,
        reviewable: false,
        timestamp: pendingFileApproval.requestedAt
      });
    }

    const modifiedFiles = Array.from(new Set(state.artifacts.flatMap((artifact) => artifact.files))).slice(0, 100);
    const activityTimeline = state.activities.flatMap<LiveTimelineItem>((activity) => {
      const label = activityLabel(activity);
      return label ? [{ id: activity.id, label, status: "completed", timestamp: activity.timestamp, source: "workspace" }] : [];
    });
    const current = state.activeWork.id === "idle" ? [] : [{
      id: `current-${state.upstreamExecution.id ?? state.updatedAt}`,
      label: currentAction(state, status),
      status: timelineStatus(state),
      timestamp: state.updatedAt,
      source: "workspace" as const
    }];
    const timeline = [
      ...(this.startedAt ? [{ id: `session-${this.startedAt}`, label: "Sesión Live iniciada", status: "completed" as const, timestamp: this.startedAt, source: "session" as const }] : []),
      ...activityTimeline,
      ...this.voiceInstructions.map((entry) => ({ ...entry, label: "Instrucción de voz añadida", status: "completed" as const, source: "voice" as const })),
      ...current
    ]
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .filter((item, index, entries) => index === 0 || item.label !== entries[index - 1].label || item.status !== entries[index - 1].status)
      .slice(-14);

    const executionId = state.upstreamExecution.id ?? state.task?.activeExecutionId ?? null;
    return {
      id: this.startedAt && this.contextKey ? `${this.contextKey}:${this.startedAt}` : null,
      mode: this.mode,
      project: state.project ? { id: state.project.id, name: state.project.name } : null,
      task: state.task ? { id: state.task.id, name: state.task.name } : null,
      conversation: state.conversation ? { id: state.conversation.id, title: state.conversation.title } : null,
      status,
      startedAt: this.startedAt,
      durationMs: this.startedAt ? Math.max(0, now - Date.parse(this.startedAt)) : 0,
      progress: progressFromWorkspace(state, status),
      currentAction: currentAction(state, status),
      executionId,
      canCancel: Boolean(executionId && state.upstreamExecution.active),
      openedFiles: [],
      modifiedFiles,
      tools: [
        ...(state.command ? [{ id: state.command.id ?? `command-${state.command.updatedAt}`, label: state.command.label, status: state.command.status }] : []),
        ...(state.tool ? [{ id: `tool-${state.tool.updatedAt}`, label: state.tool.label, status: state.tool.status }] : [])
      ],
      artifacts: state.artifacts,
      approvals: approval.pending ? [approval.pending] : [],
      workingChanges,
      timeline
    };
  }
}
