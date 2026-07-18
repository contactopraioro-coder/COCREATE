export const WEB_ATTACHMENT_MAX_FILES: 8;
export const WEB_ATTACHMENT_MAX_FILE_BYTES: number;
export const WEB_ATTACHMENT_MAX_TOTAL_BYTES: number;
export const WEB_ATTACHMENT_ACCEPT: string;
export const WEB_IMAGE_ACCEPT: string;

export type WebAttachmentPayload = {
  token: string;
  name: string;
  kind: "image" | "file";
  size: number;
  type: string;
  source: "web";
  dataBase64: string;
};

export function sanitizeWebAttachmentName(value: unknown): string;
export function webAttachmentKind(name: unknown, mimeType: unknown): "image" | "file";
export function validateWebAttachmentMetadata(value: unknown):
  | { ok: true; value: { name: string; type: string; size: number; kind: "image" | "file" } }
  | { ok: false; error: string };
export function estimateBase64Bytes(value: unknown): number | null;
export function normalizeWebAttachmentPayloads(value: unknown):
  | { ok: true; attachments: WebAttachmentPayload[] }
  | { ok: false; error: string };
