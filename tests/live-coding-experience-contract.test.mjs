import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const experiencePath = new URL("../src/cocreate/CoCreateV01Experience.tsx", import.meta.url);
const workspacePath = new URL("../src/cocreate/live/VisualCollaborationWorkspace.tsx", import.meta.url);
const chooserPath = new URL("../src/cocreate/live/LiveShareChooser.tsx", import.meta.url);
const routeOutletPath = new URL("../src/cocreate/feature-parity/FeatureRouteOutlet.tsx", import.meta.url);
const gatewayPath = new URL("../src/infrastructure/screen-sharing/create-screen-sharing-gateway.ts", import.meta.url);
const cssPath = new URL("../src/cocreate/cocreate-v01.css", import.meta.url);
const implementationCardPath = new URL("../src/cocreate/implementation/ImplementationProgressCard.tsx", import.meta.url);

test("Live replaces the same conversation area and keeps the global sidebar outside its mode boundary", async () => {
  const [experience, workspace, css] = await Promise.all([
    readFile(experiencePath, "utf8"),
    readFile(workspacePath, "utf8"),
    readFile(cssPath, "utf8")
  ]);

  assert.match(experience, /type ConversationMode = "chat" \| "live"/);
  assert.match(experience, /workspaceMode === "chat" \? <>/);
  assert.match(experience, /<VisualCollaborationWorkspace/);
  assert.doesNotMatch(experience, /<LiveTimeline|<LiveActivityPanel/);
  assert.match(workspace, /Live Header|live-workspace-header/);
  assert.match(css, /workspace-mode-layout\.mode-live[\s\S]*display: block/);
  assert.match(css, /v01-center\.live-active[\s\S]*width: 100%/);
});

test("Live entry prioritizes explicit screen sharing and capture never requests system audio", async () => {
  const [chooser, gateway] = await Promise.all([
    readFile(chooserPath, "utf8"),
    readFile(gatewayPath, "utf8")
  ]);
  const screenIndex = chooser.indexOf("Compartir pantalla");
  const previewIndex = chooser.indexOf("Usar preview del proyecto");
  const urlIndex = chooser.indexOf("Abrir una URL");
  assert.ok(screenIndex >= 0 && screenIndex < previewIndex && previewIndex < urlIndex);
  assert.match(gateway, /getDisplayMedia/);
  assert.match(gateway, /audio: false/);
});

test("New task creates a projectless blank conversation and the previous project form is gone", async () => {
  const [experience, routeOutlet] = await Promise.all([
    readFile(experiencePath, "utf8"),
    readFile(routeOutletPath, "utf8")
  ]);
  assert.match(experience, /createBlankTask/);
  assert.match(experience, /projectId: null,[\s\S]*title: "Nueva tarea"/);
  assert.match(experience, /aria-label="Proyectos"/);
  assert.match(experience, /aria-label="Tareas"/);
  assert.doesNotMatch(routeOutlet, /function NewTaskView|Elige un proyecto y define el resultado/);
});

test("Approve and Develop exits Live before starting the persistent Implementation Runtime in chat", async () => {
  const experience = await readFile(experiencePath, "utf8");
  const approval = experience.slice(experience.indexOf("const approveAndDevelop"), experience.indexOf("const startSidebarResize"));
  assert.match(approval, /runtime\.approve/);
  assert.match(approval, /screenSharingServiceRef\.current\.stop\("approval"\)/);
  assert.ok(approval.indexOf('setWorkspaceMode("chat")') < approval.indexOf("implementationRuntimeServiceRef.current.createAndStart"));
  assert.match(approval, /appendImplementationUpdate/);
  assert.doesNotMatch(approval, /runtime\.apply/);
});

test("Implementation progress remains compact while conflicts, validations, diff navigation and rollback stay actionable", async () => {
  const [card, css] = await Promise.all([
    readFile(implementationCardPath, "utf8"),
    readFile(cssPath, "utf8")
  ]);
  assert.match(card, /Encontré cambios que se cruzan con la propuesta/);
  assert.match(card, /Conservar Current/);
  assert.match(card, /Usar Proposal/);
  assert.match(card, /Filtrar diff/);
  assert.match(card, /Archivos del diff/);
  assert.match(card, /Volver a comprobar/);
  assert.match(card, /Revertir esta implementación/);
  assert.match(css, /implementation-diff-browser[\s\S]*grid-template-columns: 1fr/);
});
