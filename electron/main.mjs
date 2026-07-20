import "dotenv/config";
import { app, BrowserWindow, clipboard, dialog, ipcMain, session } from "electron";
import { config as loadEnv } from "dotenv";
import { writeFile, mkdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
import { collectExecutionOutput, createNodeCodexAdapter } from "../shared/codex-runner.js";
import { createCodexAppServerProcessManager } from "../infrastructure/codex-app-server/process-manager.js";
import { createCodexAppServerAdapter } from "../infrastructure/codex-app-server/app-server-adapter.js";
import { createCodexRuntimeAdapter } from "../infrastructure/codex-app-server/runtime-selector.js";
import { ProviderRegistry, ProviderRuntime } from "../shared/provider-runtime.js";
import { createTrustedWebProviderAdapter } from "../infrastructure/trusted-web/create-trusted-web-provider-adapter.js";
import { createIdentityRuntime } from "../shared/identity-runtime.js";
import { createAnalysisService } from "./analysis-service.mjs";
import { createApprovalBroker } from "./approval-broker.mjs";
import { createAppStateStore } from "./app-state-store.mjs";
import { registerAppIpcHandlers } from "./app-ipc.mjs";
import { registerCodexIpcHandlers } from "./codex-ipc.mjs";
import { registerCodexAuthIpcHandlers } from "./codex-auth-ipc.mjs";
import { registerCodexTestIpcHandlers } from "./codex-test-ipc.mjs";
import { registerLiveOrganizerIpcHandlers } from "./live-organizer-ipc.mjs";
import { createFoundationStore } from "./foundation-store.mjs";
import { registerIdentityIpcHandlers } from "./identity-ipc.mjs";
import { createIdentityStore } from "./identity-store.mjs";
import { createWorkspaceRuntime } from "../shared/workspace-runtime.js";
import { registerWorkspaceIpcHandlers } from "./workspace-ipc.mjs";
import { registerTrustedWebIpcHandlers } from "./trusted-web-ipc.mjs";
import { createWorkspaceStore } from "./workspace-store.mjs";
import { createMainWindow } from "./window.mjs";
import { createAttachmentBroker } from "./attachment-broker.mjs";
import { registerGitContextIpc } from "./git-context.mjs";
import { createUpstreamStabilityAdapter } from "../infrastructure/codex-app-server/upstream-stability-adapter.js";
import { registerUpstreamCapabilitiesIpc } from "./upstream-capabilities-ipc.mjs";
import { resolveParityFeatureFlags } from "../shared/upstream-stability.js";
import { registerVoiceIpc } from "./voice-ipc.mjs";
import { createProposalRuntime, registerProposalRuntimeIpc } from "./proposal-runtime.mjs";
import { registerScreenSharingIpc } from "./screen-sharing-ipc.mjs";
import { createImplementationRuntime, registerImplementationRuntimeIpc } from "./implementation-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
loadEnv({ path: path.join(rootDir, ".env.local"), override: false });
// In a packaged build the working directory isn't the project root, so the
// top-level `dotenv/config` won't find .env. It ships as an extra resource and
// is loaded here (config + API keys + the Codex binary path).
if (process.resourcesPath) {
  loadEnv({ path: path.join(process.resourcesPath, ".env"), override: false });
}
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const defaultGeminiModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const codexBinary = process.env.CODEX_BINARY ?? "codex";
const codexRuntimeMode = process.env.CODEX_RUNTIME_MODE ?? "auto";
const codexWebSearchMode = ["disabled", "cached", "live"].includes(process.env.CODEX_WEB_SEARCH_MODE)
  ? process.env.CODEX_WEB_SEARCH_MODE
  : "live";
const isSmokeTest = process.env.CO_CREATE_SMOKE_TEST === "1";
const smokeTestResultFile = process.env.COCREATE_SMOKE_TEST_RESULT_FILE?.trim() || "";
const featureFlags = {
  persistentSessions: true,
  liveCompare: process.env.FEATURE_LIVE_COMPARE === "1",
  realtimeChunks: process.env.FEATURE_REALTIME_CHUNKS === "1",
  autoApplyCodex: process.env.FEATURE_AUTO_APPLY_CODEX === "1"
};
const parityFeatureFlagOverrides = {
  experimentalUpstream: process.env.COCREATE_FEATURE_EXPERIMENTAL_UPSTREAM,
  planMode: process.env.COCREATE_FEATURE_PLAN_MODE,
  skills: process.env.COCREATE_FEATURE_SKILLS,
  plugins: process.env.COCREATE_FEATURE_PLUGINS,
  scheduledTasks: process.env.COCREATE_FEATURE_SCHEDULED_TASKS,
  githubIntegration: process.env.COCREATE_FEATURE_GITHUB,
  nativeVoice: process.env.COCREATE_FEATURE_NATIVE_VOICE,
  nativeFilePicker: process.env.COCREATE_FEATURE_NATIVE_FILE_PICKER
};

function getAppVideoDir() {
  try {
    return path.join(app.getPath("movies"), "Caleidoscopio");
  } catch {
    return path.join(app.getPath("documents"), "Caleidoscopio");
  }
}
const getAppStateStorePath = () => path.join(app.getPath("userData"), "state", "app-state.json");
const getFoundationStorePath = () => path.join(app.getPath("userData"), "state", "foundation-store.json");
const getWorkspaceStorePath = () => path.join(app.getPath("userData"), "state", "workspace-runtime.json");
const getIdentityStorePath = () => path.join(app.getPath("userData"), "state", "identity-store.json");
const getProposalRuntimePath = () => path.join(app.getPath("userData"), "state", "proposals");
const getImplementationRuntimePath = () => path.join(app.getPath("userData"), "state", "implementations");
const getRuntimeWorkingDirectory = () => app.isPackaged ? app.getPath("userData") : rootDir;

let disposeCodexIpc = () => undefined;
let disposeCodexAuthIpc = () => undefined;
let disposeCodexTestIpc = () => undefined;
let disposeLiveOrganizerIpc = () => undefined;
let disposeAppIpc = () => undefined;
let disposeWorkspaceIpc = () => undefined;
let disposeIdentityIpc = () => undefined;
let disposeTrustedWebIpc = () => undefined;
let disposeAttachmentBroker = () => undefined;
let disposeGitContextIpc = () => undefined;
let disposeUpstreamCapabilitiesIpc = () => undefined;
let disposeVoiceIpc = () => undefined;
let disposeProposalRuntimeIpc = () => undefined;
let disposeScreenSharingIpc = () => undefined;
let disposeImplementationRuntimeIpc = () => undefined;

function createRuntime({ requestApproval }) {
  const runtimeWorkingDirectory = getRuntimeWorkingDirectory();
  const appStateStore = createAppStateStore({
    filePath: getAppStateStorePath()
  });
  const foundationStore = createFoundationStore({
    filePath: getFoundationStorePath()
  });
  const workspaceStore = createWorkspaceStore({
    filePath: getWorkspaceStorePath()
  });
  const identityStore = createIdentityStore({
    filePath: getIdentityStorePath()
  });
  const identityRuntime = createIdentityRuntime({
    store: identityStore
  });
  const workspaceRuntime = createWorkspaceRuntime({
    store: workspaceStore
  });
  const execCodexAdapter = createNodeCodexAdapter({
    binary: codexBinary,
    cwd: runtimeWorkingDirectory,
    defaultOrigin: "desktop-renderer"
  });
  const codexAppServerProcessManager = createCodexAppServerProcessManager({
    binary: codexBinary,
    cwd: runtimeWorkingDirectory,
    clientVersion: app.getVersion(),
    webSearchMode: codexWebSearchMode
  });
  const appServerCodexAdapter = createCodexAppServerAdapter({
    processManager: codexAppServerProcessManager,
    cwd: runtimeWorkingDirectory,
    webSearchMode: codexWebSearchMode,
    persistThreadMapping: async (mapping) => {
      await workspaceRuntime.associateCodexThread(mapping, await identityRuntime.getSnapshot());
    },
    requestApproval
  });
  const codexAdapter = createCodexRuntimeAdapter({
    appServerAdapter: appServerCodexAdapter,
    execAdapter: execCodexAdapter,
    mode: codexRuntimeMode
  });
  const upstreamStabilityAdapter = createUpstreamStabilityAdapter({
    processManager: codexAppServerProcessManager,
    cwd: runtimeWorkingDirectory,
    featureFlagOverrides: parityFeatureFlagOverrides
  });
  const analysisService = createAnalysisService({
    getVideoDir: getAppVideoDir,
    defaultGeminiModel,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    appStateStore
  });
  const trustedWebProvider = createTrustedWebProviderAdapter();
  const trustedWebProviderRuntime = new ProviderRuntime({
    registry: new ProviderRegistry([trustedWebProvider]),
    timeoutMs: Number(process.env.TRUSTED_WEB_TOTAL_TIMEOUT_MS) || 30_000
  });
  const proposalRuntime = createProposalRuntime({
    baseDir: getProposalRuntimePath()
  });
  const implementationRuntime = createImplementationRuntime({
    baseDir: getImplementationRuntimePath(),
    proposalRuntime
  });

  return {
    appStateStore,
    foundationStore,
    workspaceStore,
    identityStore,
    identityRuntime,
    workspaceRuntime,
    codexAppServerProcessManager,
    codexAdapter,
    upstreamStabilityAdapter,
    analysisService,
    trustedWebProviderRuntime,
    proposalRuntime,
    implementationRuntime
  };
}

async function waitForWindowToFinishLoading(mainWindow) {
  if (!mainWindow.webContents.isLoadingMainFrame()) {
    return;
  }

  await new Promise((resolve) => {
    mainWindow.webContents.once("did-finish-load", resolve);
  });
}

async function writeSmokeTestResult(payload) {
  if (!smokeTestResultFile) {
    return;
  }

  await writeFile(smokeTestResultFile, JSON.stringify(payload, null, 2), "utf8");
}

async function runPackagedSmokeTest({ mainWindow, runtime, buildConfig }) {
  await writeSmokeTestResult({
    ok: false,
    phase: "entered"
  });
  await waitForWindowToFinishLoading(mainWindow);
  await writeSmokeTestResult({
    ok: false,
    phase: "window-loaded"
  });

  const requiredBridgeMethods = [
    "getConfig",
    "getAppState",
    "saveRendererState",
    "appendAppEvent",
    "getTrustedWebStatus",
    "executeTrustedWeb",
    "cancelTrustedWeb",
    "getCodexStatus",
    "listCodexModels",
    "getUpstreamCapabilities",
    "listUpstreamPlanModes",
    "listUpstreamExtensions",
    "refreshUpstreamCapabilities",
    "onUpstreamCapabilitiesChanged",
    "getVoiceStatus",
    "getScreenCapturePermission",
    "openScreenCaptureSettings",
    "transcribeVoice",
    "selectAttachments",
    "prepareDroppedAttachments",
    "releaseAttachments",
    "getProposalRuntimeAvailability",
    "listProposals",
    "createProposalWorkspace",
    "beginProposalIteration",
    "completeProposalIteration",
    "failProposalIteration",
    "validateProposal",
    "approveProposal",
    "rejectProposal",
    "applyProposal",
    "destroyProposal",
    "startProposalPreview",
    "stopProposalPreview",
    "restartProposalPreview",
    "refreshProposalPreview",
    "getImplementationRuntimeAvailability",
    "listImplementationOperations",
    "createImplementationOperation",
    "startImplementationOperation",
    "resolveImplementationConflict",
    "cancelImplementationOperation",
    "rollbackImplementationOperation",
    "recoverImplementationOperation",
    "onImplementationEvent",
    "getGitContext",
    "startCodexExecution",
    "cancelCodexExecution",
    "onCodexEvent",
    "onCodexApprovalRequest",
    "respondCodexApproval",
    "runCodex",
    "saveRecording",
    "analyzeRecording",
    "copyText",
    "closeApp"
  ];

  try {
    await writeSmokeTestResult({
      ok: false,
      phase: "renderer-content-check"
    });
    const rendererShape = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          rootChildren: document.querySelector("#root")?.childElementCount ?? 0,
          bodyLength: document.body.innerText.trim().length,
          workspaceContextVisible: Boolean(document.querySelector(".workspace-context")),
          idleDiagnosticsHidden: !document.querySelector(".workspace-work-panel")
        };
      })()`,
      true
    );
    if (
      rendererShape.rootChildren < 1 ||
      rendererShape.bodyLength < 100 ||
      !rendererShape.workspaceContextVisible ||
      !rendererShape.idleDiagnosticsHidden
    ) {
      throw new Error(`El renderer empaquetado no presentó Workspace Experience: ${JSON.stringify(rendererShape)}`);
    }

    await writeSmokeTestResult({
      ok: false,
      phase: "bridge-check"
    });
    const bridgeShape = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const bridge = window.overlayBridge;
        return {
          available: Boolean(bridge),
          methods: bridge
            ? Object.keys(bridge).filter((key) => typeof bridge[key] === "function").sort()
            : []
        };
      })()`,
      true
    );

    if (!bridgeShape?.available) {
      throw new Error("Preload no expuso window.overlayBridge dentro del artefacto empaquetado.");
    }

    const missingMethods = requiredBridgeMethods.filter((method) => !bridgeShape.methods.includes(method));
    if (missingMethods.length) {
      throw new Error(`Faltan métodos del bridge en preload: ${missingMethods.join(", ")}`);
    }

    await writeSmokeTestResult({
      ok: false,
      phase: "config-check"
    });
    const config = await mainWindow.webContents.executeJavaScript("window.overlayBridge.getConfig()", true);
    await writeSmokeTestResult({
      ok: false,
      phase: "renderer-status-check"
    });
    const rendererStatus = await mainWindow.webContents.executeJavaScript("window.overlayBridge.getCodexStatus()", true);
    await writeSmokeTestResult({
      ok: false,
      phase: "app-state-check"
    });
    const appState = await mainWindow.webContents.executeJavaScript("window.overlayBridge.getAppState()", true);
    await writeSmokeTestResult({
      ok: false,
      phase: "direct-status-check"
    });
    const directStatus = await runtime.codexAdapter.getStatus();

    const payload = {
        configLoaded: Boolean(config?.codex && config?.platform),
        rendererShape,
        bridgeMethods: bridgeShape.methods,
        rendererStatusAvailable: typeof rendererStatus?.available === "boolean",
        directStatusAvailable: typeof directStatus?.available === "boolean",
        activeSessionId: appState?.session?.id ?? null
      };

    await writeSmokeTestResult({ ok: true, phase: "completed", payload });
    console.log(`COCREATE_SMOKE_TEST_OK ${JSON.stringify(payload)}`);
    mainWindow.destroy();
    await runtime.codexAdapter.dispose();
    app.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeSmokeTestResult({ ok: false, phase: "failed", error: message }).catch(() => undefined);
    console.error(`COCREATE_SMOKE_TEST_ERROR ${message}`);
    mainWindow.destroy();
    await runtime.codexAdapter.dispose().catch(() => undefined);
    app.exit(1);
  }
}

async function bootstrap() {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({}), {
    useSystemPicker: true
  });
  const approvalBroker = createApprovalBroker({ ipcMain, BrowserWindow });
  const runtime = createRuntime({ requestApproval: approvalBroker.requestApproval });

  // Resolves the working directory Codex runs in. When the conversation is bound
  // to a real project folder we use it; otherwise we isolate work in a per-
  // conversation folder under the app's user-data dir so Codex NEVER operates in
  // (or reads) CoCreate's own source tree.
  const resolveWorkspaceRoot = async () => {
    const context = await runtime.workspaceRuntime.getCodexExecutionContext();
    if (context.rootPath) return context.rootPath;
    const isolationId = context.conversationId ?? context.taskId ?? "default";
    const dir = path.join(app.getPath("userData"), "workspaces", isolationId);
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    // Codex refuses to run outside a trusted (git) directory unless
    // --skip-git-repo-check is passed. Isolated workspaces start empty, so we
    // `git init` them once. This also gives the user's workspace real version
    // control. Guarded on the absence of .git so we don't re-init every run.
    const alreadyGit = await access(path.join(dir, ".git")).then(() => true).catch(() => false);
    if (!alreadyGit) {
      await execFileAsync("git", ["init"], { cwd: dir }).catch((error) => {
        console.warn(`[workspace] git init failed for ${dir}:`, error?.message ?? error);
      });
    }
    return dir;
  };

  const attachmentBroker = createAttachmentBroker({ ipcMain, dialog, browserWindow: BrowserWindow });
  disposeAttachmentBroker = () => attachmentBroker.dispose();
  disposeGitContextIpc = registerGitContextIpc({
    ipcMain,
    resolveCwd: async () => resolveWorkspaceRoot()
  });
  const upstreamCapabilitiesIpc = registerUpstreamCapabilitiesIpc({
    ipcMain,
    browserWindow: BrowserWindow,
    adapter: runtime.upstreamStabilityAdapter
  });
  disposeUpstreamCapabilitiesIpc = () => upstreamCapabilitiesIpc.dispose();
  disposeVoiceIpc = registerVoiceIpc({
    ipcMain,
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    model: process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe"
  });
  disposeScreenSharingIpc = registerScreenSharingIpc({ ipcMain });
  await runtime.proposalRuntime.initialize();
  await runtime.implementationRuntime.initialize();
  disposeProposalRuntimeIpc = registerProposalRuntimeIpc({
    ipcMain,
    browserWindow: BrowserWindow,
    runtime: runtime.proposalRuntime,
    resolveSourceRoot: async () => resolveWorkspaceRoot()
  });
  disposeCodexTestIpc = registerCodexTestIpcHandlers({
    ipcMain,
    resolveProjectRoot: async () => resolveWorkspaceRoot(),
    // Live-coding organizer runs on Gemini when a Google key is present (the
    // OpenAI key path stays as fallback). Codex coding is unaffected — it uses the
    // ChatGPT/Codex plan, not this key.
    organizer: process.env.GEMINI_API_KEY?.trim()
      ? {
          apiKey: process.env.GEMINI_API_KEY,
          model: "gemini-3.5-flash",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
        }
      : { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    deepgram: { apiKey: process.env.DEEPGRAM_API_KEY },
    runLiveCodex: async (prompt, cwd, onEvent) => {
      let output = "";
      const handle = await runtime.codexAdapter.execute(
        { prompt, cwd: cwd || (await resolveWorkspaceRoot()), origin: "live-coding" },
        (event) => {
          if (event?.type === "execution.output" && typeof event.chunk === "string") output += event.chunk;
          if (onEvent) {
            try {
              onEvent(event);
            } catch {
              /* ignore observer errors */
            }
          }
        }
      );
      const terminal = await handle.completed;
      return {
        ok: terminal.type === "execution.completed",
        output:
          terminal.type === "execution.completed"
            ? terminal.output || output
            : terminal.error?.safeMessage || output
      };
    }
  });
  disposeLiveOrganizerIpc = registerLiveOrganizerIpcHandlers({
    ipcMain,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL
  });
  disposeImplementationRuntimeIpc = registerImplementationRuntimeIpc({
    ipcMain,
    browserWindow: BrowserWindow,
    runtime: runtime.implementationRuntime
  });

  const buildConfig = async () => {
    const codexStatus = await runtime.codexAdapter.getStatus();
    await runtime.foundationStore.recordCodexStatus(codexStatus);

    return {
      outputDir: getAppVideoDir(),
      defaultGeminiModel,
      workingDirectory: getRuntimeWorkingDirectory(),
      appVersion: app.getVersion(),
      runtimeVersion: process.versions.electron,
      platform: process.platform,
      stateStorePath: getAppStateStorePath(),
      foundationStorePath: getFoundationStorePath(),
      workspaceStorePath: getWorkspaceStorePath(),
      identityStorePath: getIdentityStorePath(),
      featureFlags: {
        ...featureFlags,
        ...resolveParityFeatureFlags({
          environment: "desktop",
          upstreamVersion: codexStatus.version,
          compatible: codexStatus.compatible,
          overrides: parityFeatureFlagOverrides
        })
      },
      codex: codexStatus
    };
  };

  await runtime.identityRuntime.initialize({
    platform: process.platform,
    architecture: process.arch,
    appVersion: app.getVersion(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    deviceName: `${process.platform}-${process.arch}`
  });
  const legacyAppState = await runtime.appStateStore.load();
  const identityContext = await runtime.identityRuntime.getSnapshot();
  await runtime.workspaceRuntime.initialize({
    legacyAppState,
    identityContext
  });

  disposeAppIpc = registerAppIpcHandlers({
    ipcMain,
    app,
    clipboard,
    featureFlags,
    getConfig: buildConfig,
    appStateStore: runtime.appStateStore,
    foundationStore: runtime.foundationStore,
    analysisService: runtime.analysisService
  });

  disposeWorkspaceIpc = registerWorkspaceIpcHandlers({
    ipcMain,
    dialog,
    workspaceRuntime: runtime.workspaceRuntime,
    identityRuntime: runtime.identityRuntime
  });
  disposeIdentityIpc = registerIdentityIpcHandlers({
    ipcMain,
    identityRuntime: runtime.identityRuntime
  });
  disposeTrustedWebIpc = registerTrustedWebIpcHandlers({
    ipcMain,
    providerRuntime: runtime.trustedWebProviderRuntime,
    onExecutionEvent: async (webEvent) => {
      await runtime.workspaceRuntime
        .recordWebExecution(webEvent, await runtime.identityRuntime.getSnapshot())
        .catch(() => undefined);
    }
  });

  ipcMain.handle("codex:run", async (_event, payload) => {
    const result = await collectExecutionOutput(runtime.codexAdapter, {
      prompt: payload?.prompt ?? "",
      cwd: await resolveWorkspaceRoot(),
      origin: "legacy-bridge",
      metadata: { workspaceContext }
    });

    await runtime.appStateStore.update(async (_state, session) => {
      runtime.appStateStore.appendSessionEvent(session, {
        type: "codex.run.completed",
        source: "main",
        payload: {
          ok: result.ok,
          promptPreview: typeof payload?.prompt === "string" ? payload.prompt.slice(0, 280) : "",
          outputPreview: typeof result.output === "string" ? result.output.slice(0, 280) : ""
        }
      });
    });

    return result;
  });

  disposeCodexAuthIpc = registerCodexAuthIpcHandlers({
    ipcMain,
    binary: codexBinary
  });

  disposeCodexIpc = registerCodexIpcHandlers({
    ipcMain,
    codexAdapter: runtime.codexAdapter,
    resolveExecutionContext: async () => {
      const context = await runtime.workspaceRuntime.getCodexExecutionContext();
      return { ...context, rootPath: await resolveWorkspaceRoot() };
    },
    resolveAttachments: (tokens, ownerWindowId) => attachmentBroker.resolve(tokens, ownerWindowId),
    resolveSkills: (tokens, ownerWindowId) => upstreamCapabilitiesIpc.resolveSkillInputs(tokens, ownerWindowId),
    resolveProposalWorkspace: (proposalWorkspaceId, ownerWindowId) =>
      runtime.proposalRuntime.resolveWorkspace(proposalWorkspaceId, ownerWindowId),
    onExecutionEvent: async (executionEvent, payload) => {
      const proposalExecution = payload?.metadata?.workspaceContext?.proposalWorkspace === true;
      if (executionEvent.type === "codex.upstream") {
        if (!proposalExecution) {
          await runtime.workspaceRuntime
            .recordCodexUpstreamEvent(executionEvent.event, await runtime.identityRuntime.getSnapshot())
            .catch(() => undefined);
        }
        return;
      }
      if (!proposalExecution) {
        await runtime.workspaceRuntime
          .recordExecutionEvent(executionEvent, payload, await runtime.identityRuntime.getSnapshot())
          .catch(() => undefined);
      }
      if (executionEvent.type === "execution.started") {
        await runtime.foundationStore.recordExecution({
          executionId: executionEvent.executionId,
          status: executionEvent.type,
          binary: codexBinary,
          version: "",
          promptPreview: executionEvent.promptPreview,
          outputPreview: "",
          startedAt: executionEvent.timestamp,
          finishedAt: null
        });
        return;
      }

      if (
        executionEvent.type === "execution.completed" ||
        executionEvent.type === "execution.cancelled" ||
        executionEvent.type === "execution.failed"
      ) {
        const status = await runtime.codexAdapter.getStatus();
        await runtime.foundationStore.recordCodexStatus(status);
        await runtime.foundationStore.recordExecution({
          executionId: executionEvent.executionId,
          status: executionEvent.type,
          binary: status.binary,
          version: status.version ?? "",
          promptPreview: typeof payload?.prompt === "string" ? payload.prompt.slice(0, 280) : "",
          outputPreview:
            executionEvent.type === "execution.completed"
              ? executionEvent.output.slice(0, 280)
              : executionEvent.type === "execution.cancelled"
                ? executionEvent.output?.slice(0, 280) ?? ""
                : executionEvent.error.safeMessage,
          startedAt: executionEvent.timestamp,
          finishedAt: executionEvent.timestamp
        });
        await runtime.appStateStore.update(async (_state, session) => {
          runtime.appStateStore.appendSessionEvent(session, {
            type: `codex.${executionEvent.type.replace("execution.", "")}`,
            source: "main",
            payload: {
              executionId: executionEvent.executionId,
              promptPreview: typeof payload?.prompt === "string" ? payload.prompt.slice(0, 280) : "",
              status: executionEvent.type,
              outputPreview:
                executionEvent.type === "execution.completed"
                  ? executionEvent.output.slice(0, 280)
                  : executionEvent.type === "execution.cancelled"
                    ? executionEvent.output?.slice(0, 280) ?? ""
                    : executionEvent.error.safeMessage
            }
          });
        });
      }
    },
    onStatusResolved: async (status) => {
      await runtime.foundationStore.recordCodexStatus(status);
    }
  });

  const mainWindow = await createMainWindow({
    rendererUrl,
    distIndexPath: path.join(rootDir, "dist", "index.html"),
    preloadPath: path.join(__dirname, "preload.cjs"),
    show: !isSmokeTest
  });

  if (isSmokeTest) {
    await runPackagedSmokeTest({
      mainWindow,
      runtime,
      buildConfig
    });
    return;
  }

  mainWindow.on("closed", async () => {
    await runtime.codexAdapter.dispose();
  });

  app.on("before-quit", async () => {
    disposeCodexIpc();
    disposeCodexAuthIpc();
    disposeCodexTestIpc();
    disposeLiveOrganizerIpc();
    disposeAppIpc();
    disposeWorkspaceIpc();
    disposeIdentityIpc();
    disposeTrustedWebIpc();
    disposeAttachmentBroker();
    disposeGitContextIpc();
    disposeUpstreamCapabilitiesIpc();
    disposeVoiceIpc();
    disposeProposalRuntimeIpc();
    disposeScreenSharingIpc();
    disposeImplementationRuntimeIpc();
    approvalBroker.dispose();
    ipcMain.removeHandler("codex:run");
    await runtime.identityRuntime.dispose();
    await runtime.workspaceRuntime.dispose();
    await runtime.proposalRuntime.dispose();
    await runtime.implementationRuntime.dispose();
    await runtime.codexAdapter.dispose();
  });
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  app.quit();
});
