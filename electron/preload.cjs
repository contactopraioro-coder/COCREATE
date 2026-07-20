const { contextBridge, ipcRenderer, webUtils } = require("electron");
const CODEX_IPC_CHANNELS = require("../shared/codex-ipc-channels.cjs");
const APPROVAL_IPC_CHANNELS = require("../shared/approval-ipc-channels.cjs");
const TRUSTED_WEB_IPC_CHANNELS = require("../shared/trusted-web-ipc-channels.cjs");
const UPSTREAM_CAPABILITY_CHANNELS = require("../shared/upstream-capabilities-ipc-channels.cjs");
const CODEX_AUTH_CHANNELS = require("../shared/codex-auth-ipc-channels.cjs");

contextBridge.exposeInMainWorld("overlayBridge", {
  getConfig() {
    return ipcRenderer.invoke("app:get-config");
  },
  getAppState() {
    return ipcRenderer.invoke("app-state:get");
  },
  saveRendererState(payload) {
    return ipcRenderer.invoke("app-state:save-renderer", payload);
  },
  appendAppEvent(payload) {
    return ipcRenderer.invoke("app-state:append-event", payload);
  },
  getWorkspaceBootstrap() {
    return ipcRenderer.invoke("workspace:get-bootstrap");
  },
  getIdentityBootstrap() {
    return ipcRenderer.invoke("identity:get-bootstrap");
  },
  updateIdentityProfile(payload) {
    return ipcRenderer.invoke("identity:update-profile", payload);
  },
  prepareIdentityLink(payload) {
    return ipcRenderer.invoke("identity:prepare-link", payload);
  },
  createWorkspaceChat(payload) {
    return ipcRenderer.invoke("workspace:create-chat", payload);
  },
  createWorkspaceProject(payload) {
    return ipcRenderer.invoke("workspace:create-project", payload);
  },
  listWorkspaceProjects(payload) {
    return ipcRenderer.invoke("workspace:list-projects", payload);
  },
  openWorkspaceProject(payload) {
    return ipcRenderer.invoke("workspace:open-project", payload);
  },
  updateWorkspaceProject(payload) {
    return ipcRenderer.invoke("workspace:update-project", payload);
  },
  archiveWorkspaceProject(payload) {
    return ipcRenderer.invoke("workspace:archive-project", payload);
  },
  selectWorkspaceDirectory() {
    return ipcRenderer.invoke("workspace:select-directory");
  },
  createWorkspaceTask(payload) {
    return ipcRenderer.invoke("workspace:create-task", payload);
  },
  listWorkspaceTasks(payload) {
    return ipcRenderer.invoke("workspace:list-tasks", payload);
  },
  openWorkspaceTask(payload) {
    return ipcRenderer.invoke("workspace:open-task", payload);
  },
  updateWorkspaceTask(payload) {
    return ipcRenderer.invoke("workspace:update-task", payload);
  },
  changeWorkspaceTaskStatus(payload) {
    return ipcRenderer.invoke("workspace:change-task-status", payload);
  },
  createWorkspaceConversation(payload) {
    return ipcRenderer.invoke("workspace:create-conversation", payload);
  },
  listWorkspaceConversations(payload) {
    return ipcRenderer.invoke("workspace:list-conversations", payload);
  },
  openWorkspaceConversation(payload) {
    return ipcRenderer.invoke("workspace:open-conversation", payload);
  },
  updateWorkspaceConversation(payload) {
    return ipcRenderer.invoke("workspace:update-conversation", payload);
  },
  appendWorkspaceMessage(payload) {
    return ipcRenderer.invoke("workspace:append-message", payload);
  },
  listWorkspaceArtifacts(payload) {
    return ipcRenderer.invoke("workspace:list-artifacts", payload);
  },
  listWorkspaceActivity(payload) {
    return ipcRenderer.invoke("workspace:list-activity", payload);
  },
  recordWorkspaceWebExecution(payload) {
    return ipcRenderer.invoke("workspace:record-web-execution", payload);
  },
  getTrustedWebStatus() {
    return ipcRenderer.invoke(TRUSTED_WEB_IPC_CHANNELS.getStatus);
  },
  executeTrustedWeb(payload) {
    return ipcRenderer.invoke(TRUSTED_WEB_IPC_CHANNELS.execute, payload);
  },
  cancelTrustedWeb(payload) {
    return ipcRenderer.invoke(TRUSTED_WEB_IPC_CHANNELS.cancel, payload);
  },
  getCodexStatus() {
    return ipcRenderer.invoke(CODEX_IPC_CHANNELS.getStatus);
  },
  listCodexModels() {
    return ipcRenderer.invoke(CODEX_IPC_CHANNELS.listModels);
  },
  getUpstreamCapabilities() {
    return ipcRenderer.invoke(UPSTREAM_CAPABILITY_CHANNELS.snapshot);
  },
  listUpstreamPlanModes() {
    return ipcRenderer.invoke(UPSTREAM_CAPABILITY_CHANNELS.plans);
  },
  listUpstreamExtensions() {
    return ipcRenderer.invoke(UPSTREAM_CAPABILITY_CHANNELS.extensions);
  },
  refreshUpstreamCapabilities() {
    return ipcRenderer.invoke(UPSTREAM_CAPABILITY_CHANNELS.refresh);
  },
  onUpstreamCapabilitiesChanged(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(UPSTREAM_CAPABILITY_CHANNELS.changed, wrapped);
    return () => ipcRenderer.removeListener(UPSTREAM_CAPABILITY_CHANNELS.changed, wrapped);
  },
  getCodexAuthStatus() {
    return ipcRenderer.invoke(CODEX_AUTH_CHANNELS.status);
  },
  loginCodexApiKey(payload) {
    return ipcRenderer.invoke(CODEX_AUTH_CHANNELS.loginApiKey, payload);
  },
  loginCodexChatgpt() {
    return ipcRenderer.invoke(CODEX_AUTH_CHANNELS.loginChatgpt);
  },
  useDefaultCodexKey() {
    return ipcRenderer.invoke(CODEX_AUTH_CHANNELS.useDefault);
  },
  logoutCodex() {
    return ipcRenderer.invoke(CODEX_AUTH_CHANNELS.logout);
  },
  onCodexAuthChanged(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(CODEX_AUTH_CHANNELS.changed, wrapped);
    return () => ipcRenderer.removeListener(CODEX_AUTH_CHANNELS.changed, wrapped);
  },
  launchCodexTest(payload) {
    return ipcRenderer.invoke("cocreate:test:launch", payload);
  },
  openCodexFolder(payload) {
    return ipcRenderer.invoke("cocreate:test:open-folder", payload);
  },
  organizeLivePrompt(payload) {
    return ipcRenderer.invoke("cocreate:live:organize", payload);
  },
  getVoiceStatus() {
    return ipcRenderer.invoke("cocreate:voice:status");
  },
  getScreenCapturePermission() {
    return ipcRenderer.invoke("cocreate:screen-sharing:permission");
  },
  openScreenCaptureSettings() {
    return ipcRenderer.invoke("cocreate:screen-sharing:open-settings");
  },
  transcribeVoice(payload) {
    return ipcRenderer.invoke("cocreate:voice:transcribe", payload);
  },
  selectAttachments(payload) {
    return ipcRenderer.invoke("cocreate:attachments:select", payload);
  },
  prepareDroppedAttachments(files) {
    const paths = Array.from(files ?? []).flatMap((file) => {
      try {
        const filePath = webUtils.getPathForFile(file);
        return filePath ? [filePath] : [];
      } catch {
        return [];
      }
    });
    return ipcRenderer.invoke("cocreate:attachments:prepare-dropped", { paths });
  },
  releaseAttachments(payload) {
    return ipcRenderer.invoke("cocreate:attachments:release", payload);
  },
  getProposalRuntimeAvailability() {
    return ipcRenderer.invoke("cocreate:proposal:availability");
  },
  listProposals() {
    return ipcRenderer.invoke("cocreate:proposal:list");
  },
  createProposalWorkspace(payload) {
    return ipcRenderer.invoke("cocreate:proposal:create", payload);
  },
  beginProposalIteration(payload) {
    return ipcRenderer.invoke("cocreate:proposal:begin", payload);
  },
  completeProposalIteration(payload) {
    return ipcRenderer.invoke("cocreate:proposal:complete", payload);
  },
  failProposalIteration(payload) {
    return ipcRenderer.invoke("cocreate:proposal:fail", payload);
  },
  validateProposal(payload) {
    return ipcRenderer.invoke("cocreate:proposal:validate", payload);
  },
  approveProposal(payload) {
    return ipcRenderer.invoke("cocreate:proposal:approve", payload);
  },
  rejectProposal(payload) {
    return ipcRenderer.invoke("cocreate:proposal:reject", payload);
  },
  applyProposal(payload) {
    return ipcRenderer.invoke("cocreate:proposal:apply", payload);
  },
  destroyProposal(payload) {
    return ipcRenderer.invoke("cocreate:proposal:destroy", payload);
  },
  startProposalPreview(payload) {
    return ipcRenderer.invoke("cocreate:proposal:preview-start", payload);
  },
  stopProposalPreview(payload) {
    return ipcRenderer.invoke("cocreate:proposal:preview-stop", payload);
  },
  restartProposalPreview(payload) {
    return ipcRenderer.invoke("cocreate:proposal:preview-restart", payload);
  },
  refreshProposalPreview(payload) {
    return ipcRenderer.invoke("cocreate:proposal:preview-refresh", payload);
  },
  getImplementationRuntimeAvailability() {
    return ipcRenderer.invoke("cocreate:implementation:availability");
  },
  listImplementationOperations(payload) {
    return ipcRenderer.invoke("cocreate:implementation:list", payload);
  },
  createImplementationOperation(payload) {
    return ipcRenderer.invoke("cocreate:implementation:create", payload);
  },
  startImplementationOperation(payload) {
    return ipcRenderer.invoke("cocreate:implementation:start", payload);
  },
  resolveImplementationConflict(payload) {
    return ipcRenderer.invoke("cocreate:implementation:resolve-conflict", payload);
  },
  cancelImplementationOperation(payload) {
    return ipcRenderer.invoke("cocreate:implementation:cancel", payload);
  },
  rollbackImplementationOperation(payload) {
    return ipcRenderer.invoke("cocreate:implementation:rollback", payload);
  },
  recoverImplementationOperation(payload) {
    return ipcRenderer.invoke("cocreate:implementation:recover", payload);
  },
  onImplementationEvent(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("cocreate:implementation:event", wrapped);
    return () => ipcRenderer.removeListener("cocreate:implementation:event", wrapped);
  },
  getGitContext() {
    return ipcRenderer.invoke("cocreate:git:get-context");
  },
  startCodexExecution(payload) {
    return ipcRenderer.invoke(CODEX_IPC_CHANNELS.execute, payload);
  },
  cancelCodexExecution(payload) {
    return ipcRenderer.invoke(CODEX_IPC_CHANNELS.cancel, payload);
  },
  onCodexEvent(listener) {
    const wrapped = (_event, payload) => {
      listener(payload);
    };
    ipcRenderer.on(CODEX_IPC_CHANNELS.events, wrapped);
    return () => {
      ipcRenderer.removeListener(CODEX_IPC_CHANNELS.events, wrapped);
    };
  },
  onCodexApprovalRequest(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(APPROVAL_IPC_CHANNELS.requested, wrapped);
    return () => ipcRenderer.removeListener(APPROVAL_IPC_CHANNELS.requested, wrapped);
  },
  respondCodexApproval(payload) {
    return ipcRenderer.invoke(APPROVAL_IPC_CHANNELS.respond, payload);
  },
  runCodex(payload) {
    return ipcRenderer.invoke("codex:run", payload);
  },
  saveRecording(payload) {
    return ipcRenderer.invoke("recording:save", payload);
  },
  analyzeRecording(payload) {
    return ipcRenderer.invoke("analysis:run", payload);
  },
  copyText(value) {
    return ipcRenderer.invoke("clipboard:write-text", value);
  },
  closeApp() {
    return ipcRenderer.invoke("app:close");
  }
});
