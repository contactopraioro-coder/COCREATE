export const CODEX_APP_SERVER_PROTOCOL_MANIFEST = Object.freeze({
  codexVersion: "0.134.0",
  protocolVersion: "v2",
  framing: "jsonl",
  clientRequests: [
    "initialize",
    "thread/start",
    "thread/resume",
    "thread/read",
    "thread/list",
    "thread/turns/list",
    "turn/start",
    "turn/interrupt",
    "account/read",
    "model/list",
    "mcpServerStatus/list"
  ],
  clientNotifications: ["initialized"],
  serverRequests: [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
    "item/permissions/requestApproval"
  ],
  serverNotifications: [
    "thread/started",
    "thread/status/changed",
    "turn/started",
    "turn/completed",
    "turn/diff/updated",
    "turn/plan/updated",
    "item/plan/delta",
    "item/reasoning/summaryTextDelta",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
    "item/commandExecution/outputDelta",
    "item/fileChange/patchUpdated",
    "item/mcpToolCall/progress",
    "thread/tokenUsage/updated",
    "thread/compacted",
    "error",
    "warning"
  ],
  experimental: {
    clientRequests: [
      "collaborationMode/list",
      "skills/list",
      "plugin/list"
    ],
    serverNotifications: [
      "skills/changed",
      "mcpServer/startupStatus/updated"
    ]
  },
  capabilities: {
    threads: true,
    turns: true,
    resume: true,
    history: true,
    plans: true,
    reasoningSummaries: true,
    streaming: true,
    approvals: true,
    diffs: true,
    commands: true,
    webSearch: true,
    searchAnnotations: false,
    mcp: true,
    auth: true,
    config: true,
    cancellation: true,
    usage: true,
    compaction: true
  }
});
