import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIProviderAdapter } from "../api/_lib/providers/openai-provider-adapter.js";
import {
  WEB_ATTACHMENT_MAX_FILE_BYTES,
  normalizeWebAttachmentPayloads,
  sanitizeWebAttachmentName
} from "../shared/web-attachment-contracts.js";
import {
  prepareWebAttachments,
  releaseWebAttachments
} from "../src/infrastructure/attachments/create-attachment-gateway.js";

function file(parts: BlobPart[], name: string, type: string) {
  return new File(parts, name, { type });
}

test("Web attachment gateway prepares multiple files, previews images and releases resources", async () => {
  const attachments = await prepareWebAttachments([
    file(["hello"], "README.md", "text/markdown"),
    file([new Uint8Array([1, 2, 3])], "preview.png", "image/png")
  ]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0]?.source, "web");
  assert.equal(attachments[0]?.dataBase64, "aGVsbG8=");
  assert.equal(attachments[1]?.kind, "image");
  assert.match(attachments[1]?.previewUrl ?? "", /^blob:/);
  assert.deepEqual(await releaseWebAttachments(attachments.map((attachment) => attachment.token)), { ok: true, released: 1 });
});

test("Web attachment validation rejects unsafe types, empty files and oversized files", async () => {
  await assert.rejects(() => prepareWebAttachments([file(["run"], "payload.exe", "application/x-msdownload")]), /no es compatible/);
  await assert.rejects(() => prepareWebAttachments([file([], "empty.txt", "text/plain")]), /está vacío/);
  const oversized = {
    name: "large.pdf",
    type: "application/pdf",
    size: WEB_ATTACHMENT_MAX_FILE_BYTES + 1,
    arrayBuffer: async () => new ArrayBuffer(0)
  } as File;
  await assert.rejects(() => prepareWebAttachments([oversized]), /supera el límite/);
});

test("Server attachment contract strips local paths and validates base64 content", () => {
  assert.equal(sanitizeWebAttachmentName("/Users/private/secreto.md"), "secreto.md");
  const result = normalizeWebAttachmentPayloads([{
    token: "token",
    name: "C:\\Users\\private\\notes.txt",
    path: "/must/not/leave/browser",
    kind: "file",
    size: 5,
    type: "text/plain",
    dataBase64: "aGVsbG8="
  }]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.attachments[0]?.name, "notes.txt");
    assert.equal("path" in result.attachments[0]!, false);
  }
  assert.equal(normalizeWebAttachmentPayloads([{ name: "bad.txt", size: 5, type: "text/plain", dataBase64: "bad" }]).ok, false);
});

test("OpenAI server adapter builds Responses API image, text and PDF inputs", async () => {
  let upstreamBody: any = null;
  const adapter = createOpenAIProviderAdapter({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output_text: "Adjuntos procesados" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const result = await adapter.execute!({
    operation: "chat",
    capability: "chat",
    input: {
      prompt: "Analiza estos adjuntos",
      attachments: [
        { name: "image.png", kind: "image", type: "image/png", dataBase64: "YWJj" },
        { name: "notes.txt", kind: "file", type: "text/plain", dataBase64: "aGVsbG8=" },
        { name: "brief.pdf", kind: "file", type: "application/pdf", dataBase64: "JVBERg==" }
      ]
    }
  });

  assert.equal(result.output, "Adjuntos procesados");
  const content = upstreamBody.input[0].content;
  assert.equal(content[1].type, "input_image");
  assert.equal(content[1].image_url, "data:image/png;base64,YWJj");
  assert.equal(content[2].type, "input_text");
  assert.match(content[2].text, /Archivo adjunto: notes\.txt/);
  assert.match(content[2].text, /hello/);
  assert.equal(content[3].type, "input_file");
  assert.equal(content[3].filename, "brief.pdf");
  assert.equal(content[3].file_data, "JVBERg==");
});
