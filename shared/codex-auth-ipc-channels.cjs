// IPC channel names for Codex authentication (API key / ChatGPT login).
// Kept in a shared .cjs file so both the preload bridge and the Electron main
// process import the exact same string constants.
module.exports = {
  status: "cocreate:codex-auth:status",
  loginApiKey: "cocreate:codex-auth:login-api-key",
  loginChatgpt: "cocreate:codex-auth:login-chatgpt",
  useDefault: "cocreate:codex-auth:use-default",
  logout: "cocreate:codex-auth:logout",
  changed: "cocreate:codex-auth:changed"
};
