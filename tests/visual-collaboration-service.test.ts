import test from "node:test";
import assert from "node:assert/strict";
import {
  getVisualCollaborationAvailability,
  VisualCollaborationService
} from "../src/app/services/visual-collaboration-service.js";
import { buildVisualInstructionPrompt } from "../src/app/services/codex-conversation-service.js";

const timestamp = "2026-07-17T14:00:00.000Z";

test("Visual preview only accepts safe web URLs and strips credentials, query and fragments", () => {
  const service = new VisualCollaborationService();
  const rejected = service.setPreviewUrl("javascript:alert(1)", timestamp);
  assert.equal(rejected.ok, false);

  const accepted = service.setPreviewUrl("https://user:secret@example.com/app?token=private#account", timestamp);
  assert.equal(accepted.ok, true);
  const snapshot = service.getSnapshot();
  assert.equal(snapshot.preview.url, "https://example.com/app");
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("private"), false);
});

test("A named visual selection contributes friendly context instead of selectors or raw coordinates", () => {
  const service = new VisualCollaborationService();
  service.setPreviewUrl("http://localhost:4173/dashboard");
  service.select({ x: 0.74, y: 0.05, width: 0.2, height: 0.1 });
  service.renameSelection("Botón Guardar");
  const context = service.buildInstructionContext({ project: "CoCreate", task: "Pulir header", conversation: "Live" });

  assert.equal(context.selection?.label, "Botón Guardar");
  assert.match(context.selection?.location ?? "", /superior, derecha/);
  assert.equal(JSON.stringify(context).includes("selector"), false);
  assert.equal(JSON.stringify(context).includes("className"), false);
  assert.equal(JSON.stringify(context).includes('"x"'), false);
});

test("Pointer and annotations are ephemeral and disappear when a session ends", () => {
  const service = new VisualCollaborationService();
  service.start("project:task:conversation", timestamp);
  service.movePointer({ x: 0.5, y: 0.4 });
  service.addAnnotation("arrow", { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.5 });
  assert.equal(service.getSnapshot().annotations.length, 1);

  service.end("2026-07-17T14:05:00.000Z");
  const ended = service.getSnapshot();
  assert.equal(ended.pointer, null);
  assert.deepEqual(ended.annotations, []);
});

test("Current, Split and Overlay comparison modes are persistent product state", () => {
  const service = new VisualCollaborationService();
  service.setComparisonMode("current");
  assert.equal(service.getSnapshot().comparisonMode, "current");
  service.setComparisonMode("overlay");
  assert.equal(service.serialize().comparisonMode, "overlay");
  service.setComparisonMode("proposal");
  assert.equal(service.serialize().comparisonMode, "proposal");
});

test("Proposal history remains isolated and approval never creates or applies code changes", () => {
  const service = new VisualCollaborationService();
  service.select({ x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, "Tarjeta de precio");
  const { proposal } = service.beginProposal("Haz esta tarjeta más clara", "text", timestamp);
  service.completeProposal(proposal.id, "Reducir contraste secundario y reforzar el precio.");
  service.decideProposal(proposal.id, "approve");

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.proposals[0].status, "approved");
  assert.equal(snapshot.proposals[0].selectionLabel, "Tarjeta de precio");
  assert.equal("workingChanges" in snapshot, false);
  assert.equal("applied" in snapshot.proposals[0], false);
});

test("Voice proposals preserve the selected visual target", () => {
  const service = new VisualCollaborationService();
  service.select({ x: 0.3, y: 0.7, width: 0.4, height: 0.15 }, "Formulario de contacto");
  const { proposal } = service.beginProposal("Hazlo más corto", "voice", timestamp);
  assert.equal(proposal.source, "voice");
  assert.equal(proposal.selectionLabel, "Formulario de contacto");
  assert.equal(service.getSnapshot().timeline.some((item) => item.source === "voice"), true);
});

test("Live keeps multiple proposal iterations, can return to a previous one and discards without touching Current", () => {
  const service = new VisualCollaborationService();
  service.start("conversation-one", timestamp);
  service.describeSharedSurface("Design review window");
  const first = service.beginProposal("Reduce el espacio superior", "text").proposal;
  service.completeProposal(first.id, "Primera propuesta");
  const second = service.beginProposal("Mueve el botón a la derecha", "voice").proposal;
  service.completeProposal(second.id, "Segunda propuesta");
  const third = service.beginProposal("Cambia el texto", "text").proposal;
  service.completeProposal(third.id, "Tercera propuesta");

  assert.equal(service.getSnapshot().proposals.length, 3);
  assert.equal(service.getSnapshot().activeProposalId, third.id);
  assert.equal(service.undoProposal().activeProposalId, second.id);
  assert.equal(service.selectProposal(first.id).activeProposalId, first.id);
  assert.equal(service.getSnapshot().preview.title, "Design review window");

  const discarded = service.discardSession();
  assert.equal(discarded.proposals.length, 0);
  assert.equal(discarded.preview.title, "Design review window");
  assert.equal("workingChanges" in discarded, false);
});

test("Persistence restores session, layout, selection, proposals and timeline but never annotations or pointer", () => {
  const service = new VisualCollaborationService();
  service.start("project:task:conversation", timestamp);
  service.setPreviewUrl("http://localhost:4173");
  service.setComparisonMode("overlay");
  service.select({ x: 0.2, y: 0.2, width: 0.3, height: 0.2 }, "Hero principal");
  const { proposal } = service.beginProposal("Mejora la jerarquía", "text", timestamp);
  service.completeProposal(proposal.id, "Aumentar separación entre título y acción.");
  service.movePointer({ x: 0.6, y: 0.6 });
  service.addAnnotation("circle", { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 });

  const serialized = service.serialize();
  assert.equal("pointer" in serialized, false);
  assert.equal("annotations" in serialized, false);

  const restoredService = new VisualCollaborationService();
  const restored = restoredService.restore(serialized);
  assert.equal(restored.active, true);
  assert.equal(restored.comparisonMode, "overlay");
  assert.equal(restored.selection?.label, "Hero principal");
  assert.equal(restored.proposals.length, 1);
  assert.equal(restored.timeline.length > 0, true);
  assert.equal(restored.pointer, null);
  assert.deepEqual(restored.annotations, []);
});

test("Desktop and Web expose explicit screen sharing without semantic DOM access", () => {
  const desktop = getVisualCollaborationAvailability("desktop", "http://localhost:4173", "file://cocreate");
  const web = getVisualCollaborationAvailability("web", "https://cocreate.test/preview", "https://cocreate.test");
  assert.equal(desktop.interactivePreview, true);
  assert.equal(desktop.semanticSelection, false);
  assert.equal(desktop.screenCapture, true);
  assert.equal(web.semanticSelection, false);
  assert.equal(web.screenCapture, true);
});

test("Codex receives the named selection without DOM internals or URL secrets", () => {
  const prompt = buildVisualInstructionPrompt("Haz esto más claro", {
    mode: "visual-collaboration",
    preview: { title: "Dashboard", location: "https://user:secret@example.com/app?token=private", viewport: "1440x900" },
    selection: { label: "Botón Guardar", location: "parte superior, derecha", kind: "region" },
    workspace: { project: "CoCreate", task: "Pulir interfaz", conversation: "Live" }
  });
  assert.match(prompt, /Botón Guardar/);
  assert.match(prompt, /parte superior, derecha/);
  assert.equal(prompt.includes("secret"), false);
  assert.equal(prompt.includes("private"), false);
  assert.equal(prompt.includes("selector"), false);
  assert.equal(prompt.includes("className"), false);
});
