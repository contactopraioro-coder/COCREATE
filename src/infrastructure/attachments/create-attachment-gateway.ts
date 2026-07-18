import type { ComposerAttachment } from "../../app/services/attachment-service.js";
import {
  WEB_ATTACHMENT_MAX_FILES,
  WEB_ATTACHMENT_MAX_TOTAL_BYTES,
  validateWebAttachmentMetadata
} from "../../../shared/web-attachment-contracts.js";

const webPreviewUrls = new Map<string, string>();

function createToken() {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export async function prepareWebAttachments(files: FileList | File[]): Promise<ComposerAttachment[]> {
  const selected = Array.from(files ?? []).slice(0, WEB_ATTACHMENT_MAX_FILES);
  if (!selected.length) return [];
  if (Array.from(files ?? []).length > WEB_ATTACHMENT_MAX_FILES) {
    throw new Error(`Puedes adjuntar hasta ${WEB_ATTACHMENT_MAX_FILES} archivos por Turn.`);
  }

  let totalBytes = 0;
  const validated = selected.map((file) => {
    const result = validateWebAttachmentMetadata(file);
    if (!result.ok) throw new Error(result.error);
    totalBytes += result.value.size;
    return { file, metadata: result.value };
  });
  if (totalBytes > WEB_ATTACHMENT_MAX_TOTAL_BYTES) {
    throw new Error(`Los adjuntos superan el límite total de ${Math.round(WEB_ATTACHMENT_MAX_TOTAL_BYTES / 1024 / 1024)} MB por Turn en Web.`);
  }

  const encoded = await Promise.all(validated.map(async ({ file, metadata }) => ({
    file,
    metadata,
    dataBase64: arrayBufferToBase64(await file.arrayBuffer())
  })));
  return encoded.map(({ file, metadata, dataBase64 }) => {
    const token = createToken();
    const previewUrl = metadata.kind === "image" ? URL.createObjectURL(file) : undefined;
    if (previewUrl) webPreviewUrls.set(token, previewUrl);
    return {
      token,
      ...metadata,
      source: "web" as const,
      dataBase64,
      previewUrl
    };
  });
}

export async function releaseWebAttachments(tokens: string[]) {
  let released = 0;
  for (const token of tokens) {
    const previewUrl = webPreviewUrls.get(token);
    if (!previewUrl) continue;
    URL.revokeObjectURL(previewUrl);
    webPreviewUrls.delete(token);
    released += 1;
  }
  return { ok: true, released };
}

export function createAttachmentSelector() {
  if (!window.overlayBridge?.selectAttachments) return undefined;
  return (kind: "file" | "folder"): Promise<ComposerAttachment[]> => window.overlayBridge!.selectAttachments({ kind });
}

export function createDroppedAttachmentPreparer() {
  if (window.overlayBridge?.prepareDroppedAttachments) {
    return (files: FileList | File[]): Promise<ComposerAttachment[]> => window.overlayBridge!.prepareDroppedAttachments(files);
  }
  return prepareWebAttachments;
}

export function createAttachmentReleaser() {
  if (window.overlayBridge?.releaseAttachments) {
    return (tokens: string[]) => window.overlayBridge!.releaseAttachments({ tokens });
  }
  return releaseWebAttachments;
}
