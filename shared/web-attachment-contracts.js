export const WEB_ATTACHMENT_MAX_FILES = 8;
export const WEB_ATTACHMENT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const WEB_ATTACHMENT_MAX_TOTAL_BYTES = 2_400_000;

export const WEB_ATTACHMENT_ACCEPT = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf",
  ".txt", ".md", ".json", ".js", ".jsx", ".ts", ".tsx",
  ".css", ".html", ".yml", ".yaml", ".toml", ".py", ".rs",
  ".go", ".java", ".swift", ".kt", ".sh"
].join(",");

export const WEB_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const allowedExtensions = new Set(WEB_ATTACHMENT_ACCEPT.split(","));
const allowedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const allowedDocumentMimeTypes = new Set([
  "application/pdf",
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/x-typescript",
  "application/x-sh",
  "text/plain",
  "text/markdown",
  "text/javascript",
  "text/typescript",
  "text/css",
  "text/html",
  "text/yaml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "text/x-python",
  "text/x-shellscript"
]);

function extensionFor(name) {
  const normalized = String(name ?? "").trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

export function sanitizeWebAttachmentName(value) {
  const leaf = String(value ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 160);
  return leaf || "archivo";
}

export function webAttachmentKind(name, mimeType) {
  const extension = extensionFor(name);
  return imageExtensions.has(extension) || allowedImageMimeTypes.has(String(mimeType ?? "").toLowerCase())
    ? "image"
    : "file";
}

export function validateWebAttachmentMetadata(value) {
  const name = sanitizeWebAttachmentName(value?.name);
  const type = String(value?.type ?? "").trim().toLowerCase();
  const size = Number(value?.size);
  const extension = extensionFor(name);
  const kind = webAttachmentKind(name, type);

  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: `“${name}” está vacío y no puede adjuntarse.` };
  }
  if (size > WEB_ATTACHMENT_MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `“${name}” supera el límite de ${Math.round(WEB_ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024)} MB por archivo en Web.`
    };
  }
  const mimeAllowed = allowedImageMimeTypes.has(type) || allowedDocumentMimeTypes.has(type);
  if (!allowedExtensions.has(extension) || (type && !mimeAllowed && !type.startsWith("text/"))) {
    return {
      ok: false,
      error: `“${name}” no es compatible. Adjunta imágenes, PDF o archivos de texto y código.`
    };
  }
  if (kind === "image" && !allowedImageMimeTypes.has(type)) {
    return { ok: false, error: `“${name}” no tiene un formato de imagen compatible.` };
  }
  return { ok: true, value: { name, type: type || "application/octet-stream", size, kind } };
}

export function estimateBase64Bytes(value) {
  const base64 = String(value ?? "").replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function normalizeWebAttachmentPayloads(value) {
  if (value === undefined) return { ok: true, attachments: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Los adjuntos Web no tienen un formato válido." };
  if (value.length > WEB_ATTACHMENT_MAX_FILES) {
    return { ok: false, error: `Puedes adjuntar hasta ${WEB_ATTACHMENT_MAX_FILES} archivos por Turn.` };
  }

  const attachments = [];
  let totalBytes = 0;
  for (const candidate of value) {
    const metadata = validateWebAttachmentMetadata(candidate);
    if (!metadata.ok) return metadata;
    const dataBase64 = typeof candidate?.dataBase64 === "string" ? candidate.dataBase64.replace(/\s/g, "") : "";
    const decodedBytes = estimateBase64Bytes(dataBase64);
    if (decodedBytes === null || Math.abs(decodedBytes - metadata.value.size) > 2) {
      return { ok: false, error: `El contenido de “${metadata.value.name}” no coincide con su tamaño declarado.` };
    }
    totalBytes += decodedBytes;
    if (totalBytes > WEB_ATTACHMENT_MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error: `Los adjuntos superan el límite total de ${Math.round(WEB_ATTACHMENT_MAX_TOTAL_BYTES / 1024 / 1024)} MB por Turn en Web.`
      };
    }
    attachments.push({
      token: typeof candidate?.token === "string" ? candidate.token.slice(0, 120) : "",
      name: metadata.value.name,
      kind: metadata.value.kind,
      size: metadata.value.size,
      type: metadata.value.type,
      source: "web",
      dataBase64
    });
  }
  return { ok: true, attachments };
}
