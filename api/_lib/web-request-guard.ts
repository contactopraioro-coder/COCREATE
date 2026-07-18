import { createHash } from "node:crypto";
import { normalizeWebAttachmentPayloads } from "../../shared/web-attachment-contracts.js";

type GuardRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type GuardResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string; retryAfterSeconds?: number };

function firstHeader(value: string | string[] | undefined) {
  const source = Array.isArray(value) ? value[0] : value;
  return typeof source === "string" ? source.split(",")[0].trim() : "anonymous";
}

function clientKey(request: GuardRequest) {
  const ip = firstHeader(request.headers?.["x-forwarded-for"] ?? request.headers?.["x-real-ip"]);
  return createHash("sha256").update(ip || "anonymous").digest("hex").slice(0, 24);
}

function bodyBytes(body: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function createChatRequestGuard(options: {
  maxRequests?: number;
  windowMs?: number;
  maxBodyBytes?: number;
  maxPromptChars?: number;
  maxHistoryItems?: number;
} = {}) {
  const maxRequests = Math.max(1, options.maxRequests ?? (Number(process.env.CHAT_RATE_LIMIT_MAX) || 30));
  const windowMs = Math.max(1_000, options.windowMs ?? (Number(process.env.CHAT_RATE_LIMIT_WINDOW_MS) || 60_000));
  const maxBodyBytes = Math.max(1_024, options.maxBodyBytes ?? (Number(process.env.CHAT_MAX_BODY_BYTES) || 4_000_000));
  const maxPromptChars = Math.max(400, options.maxPromptChars ?? 12_000);
  const maxHistoryItems = Math.max(0, options.maxHistoryItems ?? 12);
  const clients = new Map<string, { count: number; resetAt: number }>();

  return function guard(request: GuardRequest, now = Date.now()): GuardResult {
    if (bodyBytes(request.body) > maxBodyBytes) {
      return { ok: false, status: 413, code: "REQUEST_TOO_LARGE", message: "La solicitud excede el tamaño permitido." };
    }
    const prompt = typeof (request.body as any)?.prompt === "string" ? (request.body as any).prompt.trim() : "";
    if (!prompt || prompt.length > maxPromptChars) {
      return { ok: false, status: 400, code: "INVALID_PROMPT", message: "El prompt está vacío o excede el límite permitido." };
    }
    const history = (request.body as any)?.history;
    if (history !== undefined && (!Array.isArray(history) || history.length > maxHistoryItems)) {
      return { ok: false, status: 400, code: "INVALID_HISTORY", message: "El historial excede el límite permitido." };
    }
    const attachments = normalizeWebAttachmentPayloads((request.body as any)?.attachments);
    if (!attachments.ok) {
      return { ok: false, status: 400, code: "INVALID_ATTACHMENTS", message: attachments.error };
    }

    const key = clientKey(request);
    const current = clients.get(key);
    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    if (current.count >= maxRequests) {
      return {
        ok: false,
        status: 429,
        code: "CHAT_RATE_LIMITED",
        message: "Se alcanzó el límite temporal de solicitudes. Inténtalo más tarde.",
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000))
      };
    }
    current.count += 1;
    return { ok: true };
  };
}

export const guardChatRequest = createChatRequestGuard();
