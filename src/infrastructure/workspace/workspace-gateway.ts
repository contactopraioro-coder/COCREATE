export type WorkspaceGatewayBootstrap = {
  workspace: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  task: Record<string, unknown> | null;
  conversation: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
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
};

export type WorkspaceGateway = {
  isAvailable: () => boolean;
  getBootstrap: () => Promise<WorkspaceGatewayBootstrap | null>;
  createChat: (payload?: Record<string, unknown>) => Promise<{
    task: Record<string, unknown>;
    conversation: Record<string, unknown>;
  } | null>;
  createProject: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  listProjects: (options?: { includeArchived?: boolean }) => Promise<Array<Record<string, unknown>>>;
  openProject: (projectId: string) => Promise<Record<string, unknown> | null>;
  updateProject: (projectId: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  archiveProject: (projectId: string) => Promise<Record<string, unknown> | null>;
  selectDirectory: () => Promise<string | null>;
  createTask: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  listTasks: (projectId?: string | null, options?: { includeArchived?: boolean }) => Promise<Array<Record<string, unknown>>>;
  openTask: (taskId: string) => Promise<Record<string, unknown> | null>;
  updateTask: (taskId: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  changeTaskStatus: (taskId: string, status: string) => Promise<Record<string, unknown> | null>;
  createConversation: (payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  listConversations: (taskId?: string) => Promise<Array<Record<string, unknown>>>;
  openConversation: (conversationId: string) => Promise<Record<string, unknown> | null>;
  updateConversation: (conversationId: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  appendMessage: (
    conversationId: string,
    message: {
      id?: string;
      role: "user" | "assistant" | "system";
      body: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<{
    conversation: Record<string, unknown> | null;
    messages: Array<{
      id: string;
      role: "user" | "assistant" | "system";
      body: string;
      createdAt: string;
      metadata?: Record<string, unknown>;
    }>;
  } | null>;
  listArtifacts: (filters?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  listActivity: (filters?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  recordWebExecution: (event: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
};
