import assert from "node:assert/strict";
import test from "node:test";
import { AttachmentService } from "../src/app/services/attachment-service.js";
import { ModelSelectionService } from "../src/app/services/model-selection-service.js";

test("Attachment Service distinguishes Web files from Desktop-only folders", async () => {
  const web = new AttachmentService(undefined, async () => [{
    token: "web-token",
    name: "context.txt",
    kind: "file",
    size: 10,
    type: "text/plain",
    source: "web",
    dataBase64: "Y29udGV4dDE="
  }]);
  assert.equal(web.getAvailability("file").available, true);
  assert.equal(web.getAvailability("folder").available, false);
  assert.equal((await web.prepareDropped([])).length, 1);
  await assert.rejects(() => web.select("folder"), /requiere CoCreate Desktop/);

  const desktop = new AttachmentService(async (kind) => [{ token: "safe-token", name: `context.${kind}`, kind: "file", size: 10, type: ".txt" }]);
  assert.equal(desktop.getAvailability().available, true);
  assert.equal((await desktop.select("file"))[0]?.token, "safe-token");
});

test("Model Selection Service uses only discovered models and their official default", async () => {
  const service = new ModelSelectionService(async () => ({
    data: [{
      id: "model-1",
      model: "upstream-model",
      displayName: "Upstream Model",
      description: "Discovered",
      isDefault: true,
      inputModalities: ["text", "image"],
      supportedReasoningEfforts: ["medium", "high"],
      defaultReasoningEffort: "medium"
    }]
  }));
  const result = await service.list();
  assert.equal(result.models[0]?.model, "upstream-model");
  assert.equal(service.selectDefault(result.models)?.defaultReasoningEffort, "medium");
});
