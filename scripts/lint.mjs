import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const rendererRoots = ["src", "overlay-src"];
const failures = [];
const forbiddenDomainImports = ["electron", "node:fs", "node:path", "node:os", "node:child_process"];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walk(absolutePath);
      }

      return [absolutePath];
    })
  );

  return files.flat();
}

function relative(filePath) {
  return path.relative(rootDir, filePath);
}

for (const root of rendererRoots) {
  const absoluteRoot = path.join(rootDir, root);
  const files = await walk(absoluteRoot);
  for (const filePath of files) {
    if (!/\.(ts|tsx)$/.test(filePath)) {
      continue;
    }

    const source = await readFile(filePath, "utf8");
    const label = relative(filePath);

    if (source.includes("node:child_process")) {
      failures.push(`${label}: no debe importar node:child_process desde el renderer.`);
    }

    if (source.includes("shared/codex-runner")) {
      failures.push(`${label}: no debe importar el runner concreto de Codex desde el renderer.`);
    }

    for (const forbiddenUpstreamAccess of [
      "codex-app-server",
      "CodexAppServerJsonRpcClient",
      '"thread/start"',
      '"turn/start"',
      '"config/read"'
    ]) {
      if (source.includes(forbiddenUpstreamAccess)) {
        failures.push(`${label}: el renderer no debe conocer el protocolo upstream (${forbiddenUpstreamAccess}).`);
      }
    }

    for (const forbiddenSecretAccess of [
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "BRAVE_SEARCH_API_KEY",
      "caleidoscopio-gemini-api-key",
      "api.openai.com",
      "api.search.brave.com",
      "generativelanguage.googleapis.com"
    ]) {
      if (source.includes(forbiddenSecretAccess) && !source.includes(`removeItem("${forbiddenSecretAccess}")`)) {
        failures.push(`${label}: secretos y proveedores externos no pueden vivir en el renderer (${forbiddenSecretAccess}).`);
      }
    }

    if (source.includes("infrastructure/trusted-web") || source.includes("brave-search-adapter")) {
      failures.push(`${label}: el renderer no debe importar adapters web concretos.`);
    }
  }
}

const sharedWorkspaceRoot = path.join(rootDir, "shared");
const sharedFiles = await walk(sharedWorkspaceRoot);
for (const filePath of sharedFiles) {
  if (!/(workspace-|identity-).+\.js$/.test(filePath)) {
    continue;
  }

  const source = await readFile(filePath, "utf8");
  const label = relative(filePath);
  for (const forbiddenImport of forbiddenDomainImports) {
    if (source.includes(forbiddenImport)) {
      failures.push(`${label}: el runtime de workspace no debe importar infraestructura (${forbiddenImport}).`);
    }
  }
}

const appServicesRoot = path.join(rootDir, "src", "app", "services");
const appServiceFiles = await walk(appServicesRoot);
for (const filePath of appServiceFiles) {
  if (!/\.(ts|tsx)$/.test(filePath)) {
    continue;
  }

  const source = await readFile(filePath, "utf8");
  const label = relative(filePath);
  if (source.includes("window.")) {
    failures.push(`${label}: los Application Services no deben acceder a window.`);
  }
  if (source.includes("from \"electron\"") || source.includes("from 'electron'")) {
    failures.push(`${label}: los Application Services no deben importar Electron.`);
  }
}

const codexUpstreamPolicies = [
  {
    file: "electron/main.mjs",
    requiredSnippets: ["createCodexAppServerProcessManager", "createCodexAppServerAdapter", "createCodexRuntimeAdapter"],
    forbiddenSnippets: ['request("config/read"', "CODEX_API_KEY"]
  },
  {
    file: "infrastructure/codex-app-server/app-server-adapter.js",
    requiredSnippets: ["thread.resumed", "diff.updated", "approval.requested", "interruptTurn"],
    forbiddenSnippets: ['from "electron"', "BrowserWindow", "ipcMain"]
  },
  {
    file: "infrastructure/codex-app-server/process-manager.js",
    requiredSnippets: ['"app-server"', '"initialize"', 'notify("initialized")'],
    forbiddenSnippets: ['request("config/read"', "BrowserWindow", "ipcMain"]
  }
];

for (const policy of codexUpstreamPolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const snippet of policy.requiredSnippets) {
    if (!source.includes(snippet)) failures.push(`${policy.file}: falta la guarda App Server (${snippet}).`);
  }
  for (const snippet of policy.forbiddenSnippets) {
    if (source.includes(snippet)) failures.push(`${policy.file}: contiene acceso upstream prohibido (${snippet}).`);
  }
}

const uiFiles = [
  "src/cocreate/CoCreateExperience.tsx",
  "src/cocreate/CoCreateV01Experience.tsx",
  "overlay-src/App.tsx"
];

for (const file of uiFiles) {
  const source = await readFile(path.join(rootDir, file), "utf8");
  if (source.includes("workspace-store") || source.includes("app-state-store") || source.includes("foundation-store")) {
    failures.push(`${file}: la UI no debe importar stores concretos.`);
  }
  if (source.includes("identity-store")) {
    failures.push(`${file}: la UI no debe importar stores de identidad.`);
  }
}

const codexDirectAccessPolicies = [
  {
    file: "src/cocreate/CoCreateExperience.tsx",
    forbiddenAccesses: [
      "window.overlayBridge?.runCodex",
      "window.overlayBridge?.getCodexStatus",
      "window.overlayBridge.runCodex",
      "window.overlayBridge.getCodexStatus",
      "window.overlayBridge.startCodexExecution",
      "window.overlayBridge.cancelCodexExecution"
    ]
  },
  {
    file: "src/cocreate/CoCreateV01Experience.tsx",
    forbiddenAccesses: [
      "window.overlayBridge?.runCodex",
      "window.overlayBridge.runCodex",
      "window.overlayBridge?.getCodexStatus",
      "window.overlayBridge.getCodexStatus"
    ]
  },
  {
    file: "overlay-src/App.tsx",
    forbiddenAccesses: [
      "window.overlayBridge?.getCodexStatus",
      "window.overlayBridge.getCodexStatus"
    ]
  }
];

for (const policy of codexDirectAccessPolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const forbiddenAccess of policy.forbiddenAccesses) {
    if (source.includes(forbiddenAccess)) {
      failures.push(`${policy.file}: acceso directo prohibido a infraestructura (${forbiddenAccess}).`);
    }
  }
}

const trustedAssistantPolicies = [
  {
    file: "api/chat.ts",
    requiredSnippets: [
      "runTrustedAssistantRuntime",
      "confidence",
      "grounding",
      'from "./_lib/trusted-assistant-tools.js"'
    ],
    forbiddenSnippets: [
      "new Date().toISOString()",
      "https://example.com",
      "http://example.com",
      'from "./_lib/trusted-assistant-tools"'
    ]
  },
  {
    file: "api/_lib/assistant.ts",
    requiredSnippets: ["runTrustedAssistantRuntime", 'from "./trusted-assistant-tools.js"'],
    forbiddenSnippets: [
      "new Date().toISOString()",
      "https://example.com",
      "http://example.com",
      'from "./trusted-assistant-tools"'
    ]
  },
  {
    file: "src/cocreate/CoCreateV01Experience.tsx",
    requiredSnippets: ["AssistantRuntimeService"],
    forbiddenSnippets: ["codexConversationServiceRef.current.runPrompt("]
  },
  {
    file: "shared/trusted-assistant-runtime.js",
    requiredSnippets: ["confidence", "Unavailable", "Verified", 'normalize("NFD")', "capabilityPriority", "routingSignals"],
    forbiddenSnippets: ["https://example.com", "http://example.com"]
  }
];

const providerRuntimePolicies = [
  {
    file: "shared/trusted-assistant-runtime.js",
    requiredSnippets: ["runtime.providerRuntime", "providerRuntime.execute"],
    forbiddenSnippets: ["runtime.modelResponder", "runtime.dateTimeTool", "runtime.futureWebTool"]
  },
  {
    file: "api/chat.ts",
    requiredSnippets: ["createServerProviderRuntime", "providerRuntime"],
    forbiddenSnippets: ["api.openai.com", "generativelanguage.googleapis.com"]
  },
  {
    file: "api/title.ts",
    requiredSnippets: ["createServerProviderRuntime"],
    forbiddenSnippets: ["api.openai.com", "generativelanguage.googleapis.com", "OPENAI_API_KEY", "GEMINI_API_KEY"]
  },
  {
    file: "api/transcribe.ts",
    requiredSnippets: ["createServerProviderRuntime"],
    forbiddenSnippets: ["api.openai.com", "OPENAI_API_KEY"]
  },
  {
    file: "electron/analysis-service.mjs",
    requiredSnippets: ["ProviderRuntime", "providerRuntime.execute"],
    forbiddenSnippets: ["generativelanguage.googleapis.com", "payload?.apiKey"]
  },
  {
    file: "src/app/services/assistant-runtime-service.ts",
    requiredSnippets: ["createRendererProviderRuntime", "providerRuntime"],
    forbiddenSnippets: ["modelResponder:", "runPrompt({"]
  }
];

const trustedWebPolicies = [
  {
    file: "shared/trusted-assistant-runtime.js",
    requiredSnippets: ["TrustedWebTool", "citations", "grounded", "verifiedAt", "InsufficientEvidence"],
    forbiddenSnippets: ["FutureWebTool", "BRAVE_SEARCH_API_KEY", "api.search.brave.com"]
  },
  {
    file: "infrastructure/trusted-web/safe-web-fetch.js",
    requiredSnippets: ["WEB_FETCH_BLOCKED_URL", "isPublicIpAddress", "maxRedirects", "maxBytes", "acceptedContentTypes"],
    forbiddenSnippets: ["BrowserWindow", "document.cookie", "localStorage"]
  },
  {
    file: "infrastructure/trusted-web/create-trusted-web-provider-adapter.js",
    requiredSnippets: ["createTrustedWebTool", "createBraveSearchAdapter", 'id: "web-tool"'],
    forbiddenSnippets: ["window.", "localStorage", "document."]
  },
  {
    file: "electron/preload.cjs",
    requiredSnippets: ["executeTrustedWeb", "cancelTrustedWeb"],
    forbiddenSnippets: ["BRAVE_SEARCH_API_KEY", "api.search.brave.com"]
  },
  {
    file: "src/cocreate/CoCreateV01Experience.tsx",
    requiredSnippets: ["isValidCitation", 'rel="noopener noreferrer"'],
    forbiddenSnippets: ["executeTrustedWeb(", "api.search.brave.com", "BRAVE_SEARCH_API_KEY"]
  },
  {
    file: "api/chat.ts",
    requiredSnippets: ["guardChatRequest", "AbortController", "citations", "verifiedAt"],
    forbiddenSnippets: ["BRAVE_SEARCH_API_KEY", "api.search.brave.com"]
  }
];

const capabilityExposurePolicies = [
  {
    file: "shared/upstream-capability-exposure.js",
    requiredSnippets: [
      "CODEX_PRODUCT_EVENT_MAPPING",
      "createCapabilityRegistry",
      "mapUpstreamEventToProductEvent",
      "reduceCapabilityExposure",
      '"approval.requested"',
      '"turn.completed"'
    ],
    forbiddenSnippets: ["OPENAI_API_KEY", "CODEX_API_KEY", "MCP config"]
  },
  {
    file: "shared/workspace-runtime.js",
    requiredSnippets: ["mapUpstreamEventToProductEvent", "activeCodexTurnId", 'type: "generated-file"'],
    forbiddenSnippets: ["UPSTREAM_EVENT_HANDLERS"]
  },
  {
    file: "src/cocreate/CoCreateV01Experience.tsx",
    requiredSnippets: ["UpstreamCapabilityExposureService", "WorkspaceExperienceService", "WorkspaceWorkPanel"],
    forbiddenSnippets: ['"turn/started"', '"turn/completed"', '"codex.upstream"', "CODEX_PRODUCT_EVENT_MAPPING"]
  },
  {
    file: "infrastructure/codex-app-server/app-server-adapter.js",
    requiredSnippets: [
      'emitUpstream(state, "turn.completed"',
      'emitUpstream(state, "command.output", { itemId: params.itemId ?? null })',
      "redactCodexDiagnostic"
    ],
    forbiddenSnippets: ['"command.output", { itemId: params.itemId ?? null, chunk:']
  }
];

const workspaceExperiencePolicies = [
  {
    file: "src/app/services/workspace-experience-service.ts",
    requiredSnippets: ["deriveActiveWorkState", "listArtifacts", "listActivity", "deriveRuntimeNotice", "createTaskWithConversation"],
    forbiddenSnippets: ["window.", "ipcRenderer", "CODEX_PRODUCT_EVENT_MAPPING", '"codex.upstream"']
  },
  {
    file: "src/app/services/approval-runtime-service.ts",
    requiredSnippets: ["ApprovalGateway", "gateway.respond", "expiresAt"],
    forbiddenSnippets: ["window.", "ipcRenderer", "overlayBridge"]
  },
  {
    file: "src/cocreate/workspace-experience/WorkspaceContextBar.tsx",
    requiredSnippets: ["state.projects", "state.tasks", "state.conversations", "actions.createTask"],
    forbiddenSnippets: ["window.", "overlayBridge", "workspace-store", '"codex.upstream"']
  },
  {
    file: "src/cocreate/workspace-experience/WorkspaceWorkPanel.tsx",
    requiredSnippets: ["state.plan", "state.artifacts", "state.activities", "state.capabilities", "onApprovalResponse"],
    forbiddenSnippets: ["window.", "overlayBridge", "ipcRenderer", '"codex.upstream"', "command.output"]
  },
  {
    file: "src/cocreate/CoCreateExperience.tsx",
    requiredSnippets: [],
    forbiddenSnippets: ["WorkspaceExperienceService", "WorkspaceWorkPanel", "ApprovalRuntimeService"]
  }
];

const liveCodingPolicies = [
  {
    file: "src/app/services/live-coding-session-service.ts",
    requiredSnippets: ["WorkspaceExperienceState", "WorkingChange", "recordDecision", "recordVoiceInstruction"],
    forbiddenSnippets: ["window.", "overlayBridge", "ipcRenderer", '"turn/start"', '"item/fileChange/requestApproval"']
  },
  {
    file: "src/cocreate/live/LiveActivityPanel.tsx",
    requiredSnippets: ["Working Changes", "onApprovalResponse", "LiveDiffViewer"],
    forbiddenSnippets: ["window.", "overlayBridge", "ipcRenderer", '"codex.upstream"']
  },
  {
    file: "infrastructure/codex-app-server/app-server-adapter.js",
    requiredSnippets: ["LIVE_APPROVAL_POLICY", 'sandbox: liveMode ? "read-only"', "sanitizeLivePermissions", 'request.method === "item/permissions/requestApproval"', "options.requestApproval?."],
    forbiddenSnippets: ["autoApproveLive", "git push", "git commit"]
  }
];

const visualCollaborationPolicies = [
  {
    file: "src/app/services/visual-collaboration-service.ts",
    requiredSnippets: ["buildInstructionContext", "serialize()", "restore(value", "screenCapture: true", "annotations: []"],
    forbiddenSnippets: ["window.", "document.", "localStorage", "getDisplayMedia", "MediaRecorder", "contentDocument", "querySelector"]
  },
  {
    file: "src/cocreate/live/VisualPreviewPanel.tsx",
    requiredSnippets: ['sandbox="allow-forms allow-modals allow-popups allow-scripts"', 'referrerPolicy="no-referrer"', "visual-selection-box", "visual-annotation-layer"],
    forbiddenSnippets: ["allow-same-origin", "contentDocument", "document.cookie", "getDisplayMedia", "MediaRecorder", "outerHTML", "innerHTML"]
  },
  {
    file: "src/cocreate/live/VisualProposalPanel.tsx",
    requiredSnippets: ["Propuesta lista", "Vincula un proyecto", "visual-proposal-history", "proposal-runtime-panel"],
    forbiddenSnippets: ["onApprovalResponse", "applyPatch", "allow-same-origin", "git commit", "git push"]
  },
  {
    file: "src/app/services/screen-sharing-service.ts",
    requiredSnippets: ["permission-denied", "requestSequence", "stopTracks()", "getStream()", "openPermissionSettings()"],
    forbiddenSnippets: ["window.", "navigator.", "localStorage", "sessionStorage", "MediaRecorder"]
  },
  {
    file: "src/infrastructure/screen-sharing/create-screen-sharing-gateway.ts",
    requiredSnippets: ["getDisplayMedia", "audio: false", "getScreenCapturePermission", "openScreenCaptureSettings"],
    forbiddenSnippets: ["audio: true", "localStorage", "sessionStorage", "MediaRecorder"]
  },
  {
    file: "electron/proposal-runtime.mjs",
    requiredSnippets: ["temporary-copy-on-write", "rollbackTransaction", "validation.status", "Proposal Workspace eliminado"],
    forbiddenSnippets: ["shell: true", "git commit", "git push", "process.env.OPENAI_API_KEY"]
  },
  {
    file: "src/app/services/codex-conversation-service.ts",
    requiredSnippets: ["buildVisualInstructionPrompt", "Contexto visual compartido por CoCreate", "No asumas detalles visuales"],
    forbiddenSnippets: ["visualContext.bounds", "visualContext.selector", "visualContext.className"]
  }
];

const implementationRuntimePolicies = [
  {
    file: "electron/implementation-runtime.mjs",
    requiredSnippets: [
      "approvedRevisionId",
      "implementation.conflict.detected",
      "implementation.file.applied",
      "restoreCheckpoint",
      "recoveryRequired",
      "completed_with_warnings"
    ],
    forbiddenSnippets: ["shell: true", "git commit", "git push", "gh pr", "vercel deploy", "npm install"]
  },
  {
    file: "src/app/services/implementation-runtime-service.ts",
    requiredSnippets: ["ImplementationRuntimeGateway", "createAndStart", "resolveConflict", "operationsForConversation"],
    forbiddenSnippets: ["window.", "overlayBridge", "ipcRenderer", "node:fs", "node:child_process"]
  },
  {
    file: "src/cocreate/CoCreateV01Experience.tsx",
    requiredSnippets: ["ImplementationProgressCard", "implementationRuntimeServiceRef.current.createAndStart", 'setWorkspaceMode("chat")'],
    forbiddenSnippets: ["proposalRuntimeServiceRef.current.apply", "runtime.apply(proposal.id)"]
  }
];

for (const policy of trustedAssistantPolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) {
      failures.push(`${policy.file}: falta la guarda obligatoria del runtime confiable (${requiredSnippet}).`);
    }
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) {
      failures.push(`${policy.file}: contiene un patrón prohibido para respuestas confiables (${forbiddenSnippet}).`);
    }
  }
}

for (const policy of providerRuntimePolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) {
      failures.push(`${policy.file}: falta la guarda del Provider Runtime (${requiredSnippet}).`);
    }
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) {
      failures.push(`${policy.file}: contiene acceso directo prohibido a provider (${forbiddenSnippet}).`);
    }
  }
}

for (const policy of trustedWebPolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) failures.push(`${policy.file}: falta la guarda de Trusted Web (${requiredSnippet}).`);
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) failures.push(`${policy.file}: contiene acceso web prohibido (${forbiddenSnippet}).`);
  }
}

for (const policy of capabilityExposurePolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) failures.push(`${policy.file}: falta la guarda de Capability Exposure (${requiredSnippet}).`);
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) failures.push(`${policy.file}: contiene acoplamiento upstream prohibido (${forbiddenSnippet}).`);
  }
}

for (const policy of workspaceExperiencePolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) failures.push(`${policy.file}: falta la guarda de Workspace Experience (${requiredSnippet}).`);
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) failures.push(`${policy.file}: contiene acoplamiento prohibido de Workspace Experience (${forbiddenSnippet}).`);
  }
}

for (const policy of liveCodingPolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) failures.push(`${policy.file}: falta la guarda de Live Coding (${requiredSnippet}).`);
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) failures.push(`${policy.file}: contiene acoplamiento o automatización prohibida de Live Coding (${forbiddenSnippet}).`);
  }
}

for (const policy of visualCollaborationPolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) failures.push(`${policy.file}: falta la guarda de Visual Collaboration (${requiredSnippet}).`);
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) failures.push(`${policy.file}: contiene captura, inspección o automatización prohibida de Visual Collaboration (${forbiddenSnippet}).`);
  }
}

for (const policy of implementationRuntimePolicies) {
  const source = await readFile(path.join(rootDir, policy.file), "utf8");
  for (const requiredSnippet of policy.requiredSnippets) {
    if (!source.includes(requiredSnippet)) failures.push(`${policy.file}: falta la guarda de Live Implementation (${requiredSnippet}).`);
  }
  for (const forbiddenSnippet of policy.forbiddenSnippets) {
    if (source.includes(forbiddenSnippet)) failures.push(`${policy.file}: contiene automatización o acoplamiento prohibido de Live Implementation (${forbiddenSnippet}).`);
  }
}

if (failures.length) {
  console.error("Architecture lint failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Architecture lint passed.");
