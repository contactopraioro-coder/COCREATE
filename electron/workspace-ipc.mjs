export function registerWorkspaceIpcHandlers({ ipcMain, dialog, workspaceRuntime, identityRuntime }) {
  async function getIdentityContext() {
    return identityRuntime.getSnapshot();
  }

  ipcMain.handle("workspace:get-bootstrap", async () => {
    const [workspace, identity] = await Promise.all([workspaceRuntime.getBootstrap(), identityRuntime.getSnapshot()]);
    return {
      ...workspace,
      identity
    };
  });
  ipcMain.handle("workspace:create-chat", async (_event, payload) =>
    workspaceRuntime.createChat(payload ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:create-project", async (_event, payload) =>
    workspaceRuntime.createProject(payload ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:list-projects", async (_event, payload) => workspaceRuntime.listProjects(payload ?? {}));
  ipcMain.handle("workspace:open-project", async (_event, payload) =>
    workspaceRuntime.openProject(payload?.projectId ?? "", await getIdentityContext())
  );
  ipcMain.handle("workspace:update-project", async (_event, payload) =>
    workspaceRuntime.updateProject(payload?.projectId ?? "", payload?.patch ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:archive-project", async (_event, payload) =>
    workspaceRuntime.archiveProject(payload?.projectId ?? "", await getIdentityContext())
  );
  ipcMain.handle("workspace:select-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Asociar directorio al proyecto",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("workspace:create-task", async (_event, payload) =>
    workspaceRuntime.createTask(payload ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:list-tasks", async (_event, payload) =>
    workspaceRuntime.listTasks(payload?.projectId, { includeArchived: payload?.includeArchived === true })
  );
  ipcMain.handle("workspace:open-task", async (_event, payload) =>
    workspaceRuntime.openTask(payload?.taskId ?? "", await getIdentityContext())
  );
  ipcMain.handle("workspace:start-task", async (_event, payload) =>
    workspaceRuntime.startTask(payload?.taskId ?? "", await getIdentityContext())
  );
  ipcMain.handle("workspace:update-task", async (_event, payload) =>
    workspaceRuntime.updateTask(payload?.taskId ?? "", payload?.patch ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:change-task-status", async (_event, payload) =>
    workspaceRuntime.changeTaskStatus(payload?.taskId ?? "", payload?.status ?? "", await getIdentityContext())
  );
  ipcMain.handle("workspace:create-conversation", async (_event, payload) =>
    workspaceRuntime.createConversation(payload ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:list-conversations", async (_event, payload) =>
    workspaceRuntime.listConversations(payload?.taskId)
  );
  ipcMain.handle("workspace:open-conversation", async (_event, payload) =>
    workspaceRuntime.openConversation(payload?.conversationId ?? "", await getIdentityContext())
  );
  ipcMain.handle("workspace:update-conversation", async (_event, payload) =>
    workspaceRuntime.updateConversation(payload?.conversationId ?? "", payload?.patch ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:append-message", async (_event, payload) =>
    workspaceRuntime.appendMessage(payload?.conversationId ?? "", payload?.message ?? {}, await getIdentityContext())
  );
  ipcMain.handle("workspace:list-artifacts", async (_event, payload) => workspaceRuntime.listArtifacts(payload ?? {}));
  ipcMain.handle("workspace:list-activity", async (_event, payload) => workspaceRuntime.listActivity(payload ?? {}));
  ipcMain.handle("workspace:record-web-execution", async (_event, payload) =>
    workspaceRuntime.recordWebExecution(payload ?? {}, await getIdentityContext())
  );

  return () => {
    ipcMain.removeHandler("workspace:get-bootstrap");
    ipcMain.removeHandler("workspace:create-chat");
    ipcMain.removeHandler("workspace:create-project");
    ipcMain.removeHandler("workspace:list-projects");
    ipcMain.removeHandler("workspace:open-project");
    ipcMain.removeHandler("workspace:update-project");
    ipcMain.removeHandler("workspace:archive-project");
    ipcMain.removeHandler("workspace:select-directory");
    ipcMain.removeHandler("workspace:create-task");
    ipcMain.removeHandler("workspace:list-tasks");
    ipcMain.removeHandler("workspace:open-task");
    ipcMain.removeHandler("workspace:start-task");
    ipcMain.removeHandler("workspace:update-task");
    ipcMain.removeHandler("workspace:change-task-status");
    ipcMain.removeHandler("workspace:create-conversation");
    ipcMain.removeHandler("workspace:list-conversations");
    ipcMain.removeHandler("workspace:open-conversation");
    ipcMain.removeHandler("workspace:update-conversation");
    ipcMain.removeHandler("workspace:append-message");
    ipcMain.removeHandler("workspace:list-artifacts");
    ipcMain.removeHandler("workspace:list-activity");
    ipcMain.removeHandler("workspace:record-web-execution");
  };
}
