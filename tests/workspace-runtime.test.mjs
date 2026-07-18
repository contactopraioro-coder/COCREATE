import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspaceStore } from "../electron/workspace-store.mjs";
import { createLocalIdentity, createDefaultUserProfile } from "../shared/identity-domain.js";
import { createWorkspaceRuntime } from "../shared/workspace-runtime.js";
import { createWorkspaceEventBus } from "../shared/workspace-event-bus.js";

async function createTestRuntime() {
  const directory = await mkdtemp(path.join(tmpdir(), "cocreate-workspace-"));
  const filePath = path.join(directory, "workspace-runtime.json");
  const store = createWorkspaceStore({ filePath });
  const runtime = createWorkspaceRuntime({ store });
  return {
    directory,
    filePath,
    store,
    runtime
  };
}

test("Workspace runtime creates and restores the personal local workspace with stable identity", async () => {
  const first = await createTestRuntime();
  const identity = createLocalIdentity({ displayName: "Local User" });
  const profile = createDefaultUserProfile(identity, { displayName: "Local User" });
  await first.runtime.initialize({
    identityContext: {
      identity,
      profile
    }
  });
  const bootstrap = await first.runtime.getBootstrap();

  assert.equal(bootstrap.workspace?.type, "personal-local");
  assert.equal(typeof bootstrap.workspace?.id, "string");
  assert.equal(typeof bootstrap.project?.id, "string");
  assert.equal(typeof bootstrap.session?.id, "string");
  assert.equal(bootstrap.workspace?.owner?.id, identity.id);

  await first.runtime.dispose();

  const secondStore = createWorkspaceStore({ filePath: first.filePath });
  const secondRuntime = createWorkspaceRuntime({ store: secondStore });
  await secondRuntime.initialize({
    identityContext: {
      identity,
      profile
    }
  });
  const restored = await secondRuntime.getBootstrap();

  assert.equal(restored.workspace?.id, bootstrap.workspace?.id);
  assert.equal(restored.project?.id, bootstrap.project?.id);
  assert.notEqual(restored.session?.id, bootstrap.session?.id);
  assert.equal(restored.session?.status, "restored");
  assert.equal(restored.workspace?.owner?.id, identity.id);
});

test("Workspace runtime preserves the active custom Project across initialization", async () => {
  const first = await createTestRuntime();
  await first.runtime.initialize();
  const project = await first.runtime.createProject({
    name: "Persistent project",
    rootPath: "/tmp/persistent-project"
  });
  const { task, conversation } = await first.runtime.createChat({
    projectId: project.id,
    title: "Persistent task"
  });
  await first.runtime.openConversation(conversation.id);
  await first.runtime.dispose();

  const restoredRuntime = createWorkspaceRuntime({
    store: createWorkspaceStore({ filePath: first.filePath })
  });
  await restoredRuntime.initialize();
  const restored = await restoredRuntime.getBootstrap();

  assert.equal(restored.project?.id, project.id);
  assert.equal(restored.project?.rootPath, "/tmp/persistent-project");
  assert.equal(restored.task?.id, task.id);
  assert.equal(restored.conversation?.id, conversation.id);
  assert.equal(restored.session?.projectId, project.id);
});

test("Workspace runtime migrates legacy thread snapshots into task and conversation records", async () => {
  const { runtime, store } = await createTestRuntime();

  await runtime.initialize({
    legacyAppState: {
      sessions: [
        {
          id: "legacy-session",
          createdAt: Date.now() - 5000,
          updatedAt: Date.now() - 1000,
          renderer: {
            workbench: {
              threads: [
                {
                  id: "thread-1",
                  title: "Migrated chat",
                  preview: "Legacy preview"
                }
              ],
              activeThreadId: "thread-1",
              messagesByThread: {
                "thread-1": [
                  {
                    id: "m-1",
                    role: "user",
                    body: "Necesito migrar este chat"
                  },
                  {
                    id: "m-2",
                    role: "assistant",
                    body: "Migracion lista"
                  }
                ]
              }
            }
          }
        }
      ]
    }
  });

  const bootstrap = await runtime.getBootstrap();
  assert.equal(bootstrap.conversations.length, 1);
  assert.equal(bootstrap.conversations[0].title, "Migrated chat");
  assert.equal(bootstrap.conversations[0].messages.length, 2);
  assert.equal(bootstrap.conversations[0].messages[0].body, "Necesito migrar este chat");

  const stored = await store.load();
  assert.equal(stored.metadata.legacyMigrationCompleted, true);
  assert.equal(stored.activeConversationId, bootstrap.conversations[0].id);

  await runtime.initialize({
    legacyAppState: {
      sessions: [
        {
          id: "legacy-session-2",
          renderer: {
            workbench: {
              threads: [
                {
                  id: "thread-1",
                  title: "Migrated chat",
                  preview: "Legacy preview"
                }
              ],
              activeThreadId: "thread-1",
              messagesByThread: {
                "thread-1": [
                  {
                    id: "m-1",
                    role: "user",
                    body: "Necesito migrar este chat"
                  }
                ]
              }
            }
          }
        }
      ]
    }
  });

  const idempotent = await runtime.getBootstrap();
  assert.equal(idempotent.conversations.length, 1);
});

test("Workspace runtime validates task status transitions", async () => {
  const { runtime } = await createTestRuntime();
  await runtime.initialize();
  const task = await runtime.createTask({
    title: "Task de prueba"
  });

  await runtime.changeTaskStatus(task.id, "active");
  await runtime.changeTaskStatus(task.id, "review");
  const reviewed = await runtime.changeTaskStatus(task.id, "done");

  assert.equal(reviewed.status, "done");

  await assert.rejects(() => runtime.changeTaskStatus(task.id, "active"), /no es válida/i);
});

test("Workspace runtime recovers from a corrupted or unsupported persisted file", async () => {
  const { filePath } = await createTestRuntime();
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(filePath, JSON.stringify({ version: 99, bad: true }), "utf8")
  );
  const unsupportedStore = createWorkspaceStore({ filePath });
  const unsupportedState = await unsupportedStore.load();
  assert.equal(unsupportedState.version, 1);
  assert.equal(unsupportedState.metadata.recoveredFromUnsupportedVersion, 99);

  await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, "{broken", "utf8"));
  const corruptedStore = createWorkspaceStore({ filePath });
  const corruptedState = await corruptedStore.load();
  assert.equal(corruptedState.version, 1);
  assert.equal(Array.isArray(corruptedState.workspaces), true);
});

test("Workspace runtime allows projectless tasks and links them to a project later", async () => {
  const { store } = await createTestRuntime();
  const runtime = createWorkspaceRuntime({ store });

  await assert.rejects(() => runtime.createProject({ name: "Sin init" }), /workspace activo/i);

  await runtime.initialize();
  const raw = await store.load();
  raw.activeProjectId = null;
  await store.save(raw);
  const task = await runtime.createTask({ projectId: null, title: "Sin proyecto" });
  assert.equal(task.projectId, null);
  const conversation = await runtime.createConversation({ taskId: task.id, title: "Chat independiente" });
  assert.equal(conversation.projectId, null);

  const project = await runtime.createProject({ name: "Proyecto posterior" });
  const associated = await runtime.updateTask(task.id, { projectId: project.id });
  assert.equal(associated.projectId, project.id);
  const bootstrap = await runtime.getBootstrap();
  assert.equal(bootstrap.task?.id, task.id);
  assert.equal(bootstrap.project?.id, project.id);
  assert.equal(bootstrap.conversation?.projectId, project.id);

  const anotherRuntime = createWorkspaceRuntime({ store: (await createTestRuntime()).store });
  await anotherRuntime.initialize();
  await assert.rejects(() => anotherRuntime.createConversation({ title: "Sin tarea" }), /tarea activa/i);
});

test("Workspace runtime restores sessions without duplicating the active one and supports multiple conversations", async () => {
  const { filePath, runtime } = await createTestRuntime();
  await runtime.initialize();
  const task = await runtime.createTask({
    title: "Explorar runtime"
  });
  await runtime.startTask(task.id);
  const firstConversation = await runtime.createConversation({
    taskId: task.id,
    title: "Chat A"
  });
  const secondConversation = await runtime.createConversation({
    taskId: task.id,
    title: "Chat B"
  });
  await runtime.openConversation(firstConversation.id);
  await runtime.dispose();

  const restoredStore = createWorkspaceStore({ filePath });
  const restoredRuntime = createWorkspaceRuntime({ store: restoredStore });
  await restoredRuntime.initialize();
  const bootstrap = await restoredRuntime.getBootstrap();

  assert.equal(bootstrap.conversations.length, 2);
  assert.equal(bootstrap.conversations.some((entry) => entry.id === firstConversation.id), true);
  assert.equal(bootstrap.conversations.some((entry) => entry.id === secondConversation.id), true);
  assert.equal(bootstrap.session?.restoredFromSessionId !== null, true);

  const raw = JSON.parse(await readFile(filePath, "utf8"));
  const activeSessions = raw.sessions.filter((entry) => entry.status === "active" || entry.status === "restored");
  assert.equal(activeSessions.length, 1);

  await restoredRuntime.dispose();
  const thirdRuntime = createWorkspaceRuntime({ store: createWorkspaceStore({ filePath }) });
  await thirdRuntime.initialize();
  const thirdState = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(thirdState.sessions.filter((entry) => entry.status === "active" || entry.status === "restored").length, 1);
});

test("Workspace runtime links executions to tasks, records activity, and creates artifacts", async () => {
  const { runtime } = await createTestRuntime();
  const identity = createLocalIdentity({ displayName: "Martin" });
  const profile = createDefaultUserProfile(identity, { displayName: "Martin" });
  await runtime.initialize({
    identityContext: {
      identity,
      profile
    }
  });
  const task = await runtime.createTask({
    title: "Implementar runtime"
  }, { identity, profile });
  await runtime.startTask(task.id, { identity, profile });
  const conversation = await runtime.createConversation({
    taskId: task.id,
    title: "Implementacion"
  }, { identity, profile });
  await runtime.openConversation(conversation.id, { identity, profile });

  await runtime.recordExecutionEvent(
    {
      type: "execution.started",
      executionId: "exec-123",
      timestamp: new Date().toISOString(),
      stage: "starting",
      origin: "desktop-renderer",
      promptPreview: "Implementa el runtime"
    },
    {
      prompt: "Implementa el runtime"
    },
    {
      identity,
      profile
    }
  );

  await runtime.recordExecutionEvent(
    {
      type: "execution.completed",
      executionId: "exec-123",
      timestamp: new Date().toISOString(),
      stage: "completed",
      output: "Runtime implementado",
      exitCode: 0
    },
    {
      prompt: "Implementa el runtime"
    },
    {
      identity,
      profile
    }
  );

  const artifacts = await runtime.listArtifacts({
    taskId: task.id
  });
  const activity = await runtime.listActivity({
    taskId: task.id
  });

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].executionId, "exec-123");
  assert.equal(activity.some((entry) => entry.type === "execution.started"), true);
  assert.equal(activity.some((entry) => entry.type === "execution.completed"), true);
  assert.equal(activity.some((entry) => entry.type === "artifact.created"), true);
  const executionStart = activity.find((entry) => entry.type === "execution.started");
  assert.equal(executionStart.actor.displayName, "Codex");
});

test("Workspace runtime records failed and cancelled executions without duplicating activity", async () => {
  const { runtime } = await createTestRuntime();
  await runtime.initialize();
  const { task, conversation } = await runtime.createChat({
    title: "Errores"
  });
  await runtime.openConversation(conversation.id);

  const timestamp = new Date().toISOString();
  await runtime.recordExecutionEvent(
    {
      type: "execution.failed",
      executionId: "exec-failed",
      timestamp,
      stage: "failed",
      error: {
        safeMessage: "Fallo controlado"
      }
    },
    {
      prompt: "rompe"
    }
  );
  await runtime.recordExecutionEvent(
    {
      type: "execution.cancelled",
      executionId: "exec-cancelled",
      timestamp,
      stage: "cancelled",
      reason: "user-requested",
      output: ""
    },
    {
      prompt: "cancela"
    }
  );
  await runtime.recordExecutionEvent(
    {
      type: "execution.cancelled",
      executionId: "exec-cancelled",
      timestamp,
      stage: "cancelled",
      reason: "user-requested",
      output: ""
    },
    {
      prompt: "cancela"
    }
  );

  const activity = await runtime.listActivity({ taskId: task.id });
  assert.equal(activity.some((entry) => entry.type === "execution.failed"), true);
  assert.equal(activity.some((entry) => entry.type === "execution.cancelled"), true);
  assert.equal(activity.filter((entry) => entry.type === "execution.cancelled").length, 1);
});

test("Workspace runtime records web execution metadata without pages or artifacts", async () => {
  const { runtime } = await createTestRuntime();
  const identity = createLocalIdentity({ displayName: "Martin" });
  const profile = createDefaultUserProfile(identity, { displayName: "Martin" });
  await runtime.initialize({ identityContext: { identity, profile } });
  const { task, conversation } = await runtime.createChat({ title: "Web grounding" }, { identity, profile });
  await runtime.openConversation(conversation.id, { identity, profile });
  const startedAt = "2026-07-16T15:00:00.000Z";
  await runtime.recordWebExecution({
    type: "web.execution.started",
    requestId: "web-123",
    timestamp: startedAt,
    queryPreview: "cargo publico actual"
  }, { identity, profile });
  await runtime.recordWebExecution({
    type: "web.execution.completed",
    requestId: "web-123",
    startedAt,
    timestamp: "2026-07-16T15:00:01.500Z",
    provider: "brave-search",
    sourcesCount: 3,
    verifiedAt: "2026-07-16T15:00:01.000Z",
    confidence: "Verified"
  }, { identity, profile });

  const activity = await runtime.listActivity({ taskId: task.id });
  const completed = activity.find((entry) => entry.type === "web.execution.completed");
  assert.match(completed.summary, /3 fuentes públicas/i);
  assert.equal(completed.metadata.duration, 1500);
  assert.equal(completed.metadata.tool, "TrustedWebTool");
  assert.equal("page" in completed.metadata, false);
  assert.equal((await runtime.listArtifacts({ taskId: task.id })).length, 0);
});

test("Workspace messages persist only valid grounded citations", async () => {
  const { runtime } = await createTestRuntime();
  await runtime.initialize();
  const { conversation } = await runtime.createChat({ title: "Citations" });
  const retrievedAt = new Date().toISOString();
  const result = await runtime.appendMessage(conversation.id, {
    role: "assistant",
    body: "Respuesta verificada",
    metadata: {
      confidence: "Verified",
      grounded: true,
      verifiedAt: retrievedAt,
      citations: [
        { id: "c1", sourceId: "s1", title: "Official", url: "https://example.gov/current", domain: "example.gov", retrievedAt },
        { id: "c2", sourceId: "s2", title: "Unsafe", url: "javascript:alert(1)", domain: "example.com", retrievedAt }
      ]
    }
  });
  assert.equal(result.messages.at(-1).metadata.citations.length, 1);
  assert.equal(result.messages.at(-1).metadata.citations[0].url, "https://example.gov/current");
});

test("Workspace event bus unsubscribes cleanly and ignores duplicate listeners", async () => {
  const bus = createWorkspaceEventBus();
  const seen = [];
  const listener = (event) => {
    seen.push(event.type);
  };

  const unsubscribeA = bus.subscribe("task.created", listener);
  const unsubscribeB = bus.subscribe("task.created", listener);
  await bus.publish({ type: "task.created" });
  unsubscribeA();
  unsubscribeB();
  await bus.publish({ type: "task.created" });

  assert.deepEqual(seen, ["task.created"]);
});

test("Workspace runtime archives and restores Projects and Tasks without losing their hierarchy", async () => {
  const { runtime } = await createTestRuntime();
  await runtime.initialize();
  const project = await runtime.createProject({ name: "Project restaurable" });
  const { task, conversation } = await runtime.createChat({ projectId: project.id, title: "Task restaurable" });

  await runtime.changeTaskStatus(task.id, "active");
  await runtime.changeTaskStatus(task.id, "archived");
  assert.equal((await runtime.listTasks(project.id)).length, 0);
  assert.equal((await runtime.listTasks(project.id, { includeArchived: true }))[0].status, "archived");

  await runtime.changeTaskStatus(task.id, "active");
  await runtime.openTask(task.id);
  await runtime.openConversation(conversation.id);
  assert.equal((await runtime.getBootstrap()).task.id, task.id);

  await runtime.archiveProject(project.id);
  assert.equal((await runtime.listProjects()).some((entry) => entry.id === project.id), false);
  await runtime.updateProject(project.id, { status: "active" });
  await runtime.openProject(project.id);
  assert.equal((await runtime.getBootstrap()).project.id, project.id);
});

test("Workspace runtime keeps terminal events, Artifacts and Activity on the originating Task after switching", async () => {
  const { runtime } = await createTestRuntime();
  await runtime.initialize();
  const projectId = (await runtime.getBootstrap()).project.id;
  const first = await runtime.createChat({ projectId, title: "Task A" });
  await runtime.changeTaskStatus(first.task.id, "active");
  const contextA = await runtime.getCodexExecutionContext();
  const startedAt = "2026-07-16T18:00:00.000Z";
  await runtime.recordExecutionEvent({
    type: "execution.started",
    executionId: "exec-background",
    timestamp: startedAt,
    stage: "starting",
    origin: "desktop-renderer",
    promptPreview: "background"
  }, { prompt: "background", metadata: { workspaceContext: contextA } });

  const second = await runtime.createChat({ projectId, title: "Task B" });
  await runtime.changeTaskStatus(second.task.id, "active");
  await runtime.recordExecutionEvent({
    type: "execution.completed",
    executionId: "exec-background",
    timestamp: "2026-07-16T18:00:01.000Z",
    stage: "completed",
    output: "Resultado A",
    exitCode: 0
  }, { prompt: "background", metadata: { workspaceContext: contextA } });

  assert.equal((await runtime.listArtifacts({ taskId: first.task.id })).length, 1);
  assert.equal((await runtime.listArtifacts({ taskId: second.task.id })).length, 0);
  assert.equal((await runtime.listActivity({ taskId: first.task.id })).some((entry) => entry.type === "execution.completed"), true);
  assert.equal((await runtime.listActivity({ taskId: second.task.id })).some((entry) => entry.type === "execution.completed"), false);
  assert.equal((await runtime.getBootstrap()).task.id, second.task.id);

  await runtime.openConversation(first.conversation.id);
  const restoredFirst = await runtime.getBootstrap();
  assert.equal(restoredFirst.runtime.activeExecution.executionId, "exec-background");
  assert.equal(restoredFirst.runtime.activeExecution.status, "completed");
  assert.equal(restoredFirst.runtime.codex.executionId, null);

  await runtime.openConversation(second.conversation.id);
  assert.equal((await runtime.getBootstrap()).runtime.activeExecution, null);
});

test("Workspace runtime marks an unfinished execution interrupted on restoration", async () => {
  const { runtime, filePath } = await createTestRuntime();
  await runtime.initialize();
  const { task, conversation } = await runtime.createChat({ title: "Restart gate" });
  await runtime.changeTaskStatus(task.id, "active");
  await runtime.openConversation(conversation.id);
  const context = await runtime.getCodexExecutionContext();
  await runtime.recordExecutionEvent({
    type: "execution.started",
    executionId: "exec-interrupted",
    timestamp: "2026-07-16T19:00:00.000Z",
    stage: "starting",
    origin: "desktop-renderer",
    promptPreview: "restart"
  }, { prompt: "restart", metadata: { workspaceContext: context } });
  await runtime.dispose();

  const restoredRuntime = createWorkspaceRuntime({ store: createWorkspaceStore({ filePath }) });
  await restoredRuntime.initialize();
  const restored = await restoredRuntime.getBootstrap();
  assert.equal(restored.session.status, "restored");
  assert.equal(restored.runtime.codex.status, "Interrupted");
  assert.equal(restored.runtime.activeExecution.executionId, "exec-interrupted");
  assert.equal(restored.runtime.activeExecution.status, "interrupted");
  assert.equal(restored.task.metadata.activeExecutionId, null);
});
