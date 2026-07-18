/// <reference types="vite/client" />

import type {
  CancelCodexExecutionRequest,
  CodexExecutionEvent,
  CodexStatus,
  StartCodexExecutionRequest
} from "../shared/codex-contracts";
import type { ProviderHealth } from "../shared/provider-runtime";
import type { TrustedWebIpcCancelRequest, TrustedWebIpcExecuteRequest } from "../shared/trusted-web-ipc";
import type { ProposalRecord, ProposalRuntimeAvailability } from "./app/services/proposal-runtime-service";
import type { ScreenPermissionStatus } from "./app/services/screen-sharing-service";
import type {
  ImplementationConflictResolution,
  ImplementationOperation,
  ImplementationRuntimeAvailability
} from "./app/services/implementation-runtime-service";

declare global {
  interface Window {
    overlayBridge?: {
      getConfig: () => Promise<{
        outputDir: string;
        defaultGeminiModel: string;
        workingDirectory?: string;
        appVersion?: string;
        runtimeVersion?: string;
        platform: string;
        stateStorePath: string;
        foundationStorePath?: string;
        workspaceStorePath?: string;
        identityStorePath?: string;
        featureFlags: {
          persistentSessions: boolean;
          liveCompare: boolean;
          realtimeChunks: boolean;
          autoApplyCodex: boolean;
          planMode?: boolean;
          scheduledTasks?: boolean;
          skills?: boolean;
          plugins?: boolean;
          githubIntegration?: boolean;
          experimentalUpstream?: boolean;
          nativeVoice?: boolean;
          nativeFilePicker?: boolean;
        };
        codex: CodexStatus;
      }>;
      getAppState: () => Promise<{
        state: {
          version: number;
          updatedAt: number;
          activeSessionId: string | null;
          sessions: Array<{
            id: string;
            title: string;
            createdAt: number;
            updatedAt: number;
            renderer: {
              workbench: unknown;
            };
            events: Array<{
              id: string;
              type: string;
              source: string;
              payload: Record<string, unknown>;
              createdAt: number;
            }>;
          }>;
        };
        session: {
          id: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          renderer: {
            workbench: unknown;
          };
          events: Array<{
            id: string;
            type: string;
            source: string;
            payload: Record<string, unknown>;
            createdAt: number;
          }>;
        } | null;
        featureFlags: {
          persistentSessions: boolean;
          liveCompare: boolean;
          realtimeChunks: boolean;
          autoApplyCodex: boolean;
        };
      }>;
      saveRendererState: (payload: {
        title?: string;
        snapshot: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        sessionId: string | null;
        updatedAt: number;
      }>;
      appendAppEvent: (payload: {
        type: string;
        source?: string;
        payload?: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        sessionId: string | null;
      }>;
      getWorkspaceBootstrap: () => Promise<{
        workspace: Record<string, unknown> | null;
        project: Record<string, unknown> | null;
        task: Record<string, unknown> | null;
        conversation: Record<string, unknown> | null;
        session: Record<string, unknown> | null;
        identity: {
          identity: Record<string, unknown> | null;
          profile: Record<string, unknown> | null;
          device: Record<string, unknown> | null;
          preparedLink: Record<string, unknown> | null;
        };
        ownership: {
          workspaceOwner: Record<string, unknown> | null;
        };
        conversations: Array<{
          id: string;
          taskId: string;
          title: string;
          thread: {
            id: string;
            title: string;
            preview: string;
          };
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            body: string;
            createdAt: string;
            metadata?: Record<string, unknown>;
          }>;
        }>;
        activities: Array<Record<string, unknown>>;
      }>;
      getIdentityBootstrap: () => Promise<{
        identity: Record<string, unknown> | null;
        profile: Record<string, unknown> | null;
        device: Record<string, unknown> | null;
        preparedLink: Record<string, unknown> | null;
      }>;
      updateIdentityProfile: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      prepareIdentityLink: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      createWorkspaceChat: (payload?: Record<string, unknown>) => Promise<{
        task: Record<string, unknown>;
        conversation: Record<string, unknown>;
      }>;
      createWorkspaceProject: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      listWorkspaceProjects: (payload?: { includeArchived?: boolean }) => Promise<Array<Record<string, unknown>>>;
      openWorkspaceProject: (payload: { projectId: string }) => Promise<Record<string, unknown> | null>;
      updateWorkspaceProject: (payload: { projectId: string; patch: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
      archiveWorkspaceProject: (payload: { projectId: string }) => Promise<Record<string, unknown> | null>;
      selectWorkspaceDirectory: () => Promise<string | null>;
      createWorkspaceTask: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      listWorkspaceTasks: (payload?: { projectId?: string | null; includeArchived?: boolean }) => Promise<Array<Record<string, unknown>>>;
      openWorkspaceTask: (payload: { taskId: string }) => Promise<Record<string, unknown> | null>;
      updateWorkspaceTask: (payload: { taskId: string; patch: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
      changeWorkspaceTaskStatus: (payload: { taskId: string; status: string }) => Promise<Record<string, unknown> | null>;
      createWorkspaceConversation: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      listWorkspaceConversations: (payload?: { taskId?: string }) => Promise<Array<Record<string, unknown>>>;
      openWorkspaceConversation: (payload: { conversationId: string }) => Promise<Record<string, unknown> | null>;
      updateWorkspaceConversation: (payload: { conversationId: string; patch: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
      appendWorkspaceMessage: (payload: {
        conversationId: string;
        message: {
          id?: string;
          role: "user" | "assistant" | "system";
          body: string;
          metadata?: Record<string, unknown>;
        };
      }) => Promise<{
        conversation: Record<string, unknown> | null;
        messages: Array<{
          id: string;
          role: "user" | "assistant" | "system";
          body: string;
          createdAt: string;
          metadata?: Record<string, unknown>;
        }>;
      }>;
      listWorkspaceArtifacts: (payload?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
      listWorkspaceActivity: (payload?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
      recordWorkspaceWebExecution: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      getTrustedWebStatus: () => Promise<ProviderHealth>;
      executeTrustedWeb: (payload: TrustedWebIpcExecuteRequest) => Promise<{
        ok: boolean;
        result?: { output?: string; value?: any; model?: string | null; metadata?: Record<string, unknown> | null };
        error?: Record<string, any>;
      }>;
      cancelTrustedWeb: (payload: TrustedWebIpcCancelRequest) => Promise<{
        ok: boolean;
        requestId: string;
        alreadyTerminated: boolean;
      }>;
      getCodexStatus: () => Promise<CodexStatus>;
      listCodexModels: () => Promise<{
        data: Array<{
          id: string;
          model: string;
          displayName: string;
          description: string;
          isDefault: boolean;
          inputModalities: string[];
          supportedReasoningEfforts: string[];
          defaultReasoningEffort: string | null;
        }>;
        unavailableReason?: string;
      }>;
      getUpstreamCapabilities: () => Promise<import("./app/services/upstream-stability-service").UpstreamStabilityRuntimeSnapshot>;
      listUpstreamPlanModes: () => Promise<{
        ok: boolean;
        data?: import("./app/services/upstream-stability-service").PlanModeOption[];
        stability?: "experimental";
        error?: string;
      }>;
      listUpstreamExtensions: () => Promise<
        ({ ok: true } & import("./app/services/upstream-stability-service").ExtensionCatalog) |
        { ok: false; error: string }
      >;
      refreshUpstreamCapabilities: () => Promise<import("./app/services/upstream-stability-service").UpstreamStabilityRuntimeSnapshot>;
      onUpstreamCapabilitiesChanged: (listener: (event: Record<string, unknown>) => void) => () => void;
      getVoiceStatus: () => Promise<{ status: string; message?: string }>;
      getScreenCapturePermission?: () => Promise<ScreenPermissionStatus>;
      openScreenCaptureSettings?: () => Promise<boolean>;
      transcribeVoice: (payload: { audioBase64: string; mimeType: string; language: string }) => Promise<{
        ok: true;
        text: string;
        provider: string;
        model: string | null;
      }>;
      selectAttachments: (payload: { kind: "file" | "folder" }) => Promise<Array<{
        token: string;
        name: string;
        kind: "image" | "file" | "folder";
        size: number;
        type: string;
      }>>;
      prepareDroppedAttachments: (files: FileList | File[]) => Promise<Array<{
        token: string;
        name: string;
        kind: "image" | "file" | "folder";
        size: number;
        type: string;
      }>>;
      releaseAttachments: (payload: { tokens: string[] }) => Promise<{ ok: boolean; released: number }>;
      getProposalRuntimeAvailability: () => Promise<ProposalRuntimeAvailability>;
      listProposals: () => Promise<ProposalRecord[]>;
      createProposalWorkspace: (payload: {
        instruction: string;
        source: "text" | "voice";
        selectionLabel?: string | null;
        author?: string | null;
        parentId?: string | null;
      }) => Promise<ProposalRecord>;
      beginProposalIteration: (payload: { id: string }) => Promise<ProposalRecord>;
      completeProposalIteration: (payload: { id: string }) => Promise<ProposalRecord>;
      failProposalIteration: (payload: { id: string; reason: string }) => Promise<ProposalRecord>;
      validateProposal: (payload: { id: string }) => Promise<ProposalRecord>;
      approveProposal: (payload: { id: string }) => Promise<ProposalRecord>;
      rejectProposal: (payload: { id: string }) => Promise<ProposalRecord>;
      applyProposal: (payload: { id: string }) => Promise<ProposalRecord>;
      destroyProposal: (payload: { id: string }) => Promise<ProposalRecord>;
      startProposalPreview: (payload: { id: string }) => Promise<ProposalRecord>;
      stopProposalPreview: (payload: { id: string }) => Promise<ProposalRecord>;
      restartProposalPreview: (payload: { id: string }) => Promise<ProposalRecord>;
      refreshProposalPreview: (payload: { id: string }) => Promise<ProposalRecord>;
      getImplementationRuntimeAvailability: () => Promise<ImplementationRuntimeAvailability>;
      listImplementationOperations: (payload: { conversationId: string | null }) => Promise<ImplementationOperation[]>;
      createImplementationOperation: (payload: { conversationId: string; projectId: string; proposalId: string }) => Promise<ImplementationOperation>;
      startImplementationOperation: (payload: { id: string }) => Promise<ImplementationOperation>;
      resolveImplementationConflict: (payload: { id: string; conflictId: string; resolution: ImplementationConflictResolution }) => Promise<ImplementationOperation>;
      cancelImplementationOperation: (payload: { id: string }) => Promise<ImplementationOperation>;
      rollbackImplementationOperation: (payload: { id: string }) => Promise<ImplementationOperation>;
      recoverImplementationOperation: (payload: { id: string }) => Promise<ImplementationOperation>;
      onImplementationEvent: (listener: (operation: ImplementationOperation) => void) => () => void;
      getGitContext: () => Promise<import("./app/services/git-context-service").GitContext>;
      startCodexExecution: (payload: StartCodexExecutionRequest) => Promise<{
        ok: true;
        executionId: string;
      }>;
      cancelCodexExecution: (payload: CancelCodexExecutionRequest) => Promise<{
        ok: boolean;
        executionId: string;
        alreadyTerminated: boolean;
      }>;
      onCodexEvent: (listener: (event: CodexExecutionEvent) => void) => () => void;
      onCodexApprovalRequest: (listener: (request: {
        approvalId: string;
        category: string;
        action: string;
        risk: string;
        reason: string | null;
        threadId: string | null;
        turnId: string | null;
        itemId: string | null;
        requestedAt: string;
        expiresAt: string;
      }) => void) => () => void;
      respondCodexApproval: (payload: { approvalId: string; decision: "approve" | "reject" }) => Promise<{
        ok: boolean;
        approvalId: string;
        decision?: "approve" | "reject";
        reason?: string;
      }>;
      runCodex: (payload: {
        prompt: string;
      }) => Promise<{
        ok: boolean;
        output: string;
        stderr?: string;
      }>;
      saveRecording: (payload: {
        buffer: Uint8Array;
        mimeType: string;
        suggestedName?: string;
      }) => Promise<{
        filePath: string;
        fileSize: number;
      }>;
      analyzeRecording: (payload: {
        model: string;
        notes: string;
        filePath: string;
        mimeType: string;
      }) => Promise<{
        model: string;
        fileName: string;
        output: string;
        provider?: string;
        requestId?: string;
      }>;
      copyText: (value: string) => Promise<{ ok: true }>;
      closeApp: () => Promise<void>;
    };
  }
}

export {};
