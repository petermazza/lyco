// ─── Chat attachments ────────────────────────────────────────
// Photos, PDFs, and text/CSV files the user drops into a
// conversation. They are read once by the assistant and never
// stored — the file bytes travel to the model and are discarded.
export type AttachmentKind = "image" | "pdf" | "text";

export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface ChatAttachment {
  name: string;
  mediaType: string;
  kind: AttachmentKind;
  data: string; // base64 for image/pdf, UTF-8 text for text/csv
  sizeBytes: number;
}

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_DATA_LENGTH = 7_000_000;
export const MAX_ATTACHMENT_NAME = 200;
export const ACCEPT_ATTACHMENTS =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,.txt,.csv,.md";

const IMAGE_TYPES: Record<string, ImageMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const IMAGE_MIMES = new Set<ImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const TEXT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/csv",
]);
const TEXT_EXTS = /\.(txt|csv|md)$/i;

// What kind of file is this? Returns null for anything we can't read.
export function classifyFile(
  name: string,
  mimeType: string
): { kind: AttachmentKind; mediaType: string } | null {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";

  if (IMAGE_MIMES.has(mimeType as ImageMediaType)) {
    return { kind: "image", mediaType: mimeType };
  }
  if (ext && ext in IMAGE_TYPES) {
    return { kind: "image", mediaType: IMAGE_TYPES[ext] };
  }
  if (mimeType === "application/pdf" || ext === ".pdf") {
    return { kind: "pdf", mediaType: "application/pdf" };
  }
  if (TEXT_MIMES.has(mimeType) || TEXT_EXTS.test(name)) {
    return { kind: "text", mediaType: "text/plain" };
  }
  return null;
}

const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;

export function validateAttachment(
  att: unknown
): { ok: true; value: ChatAttachment } | { ok: false; error: string } {
  if (!att || typeof att !== "object") {
    return { ok: false, error: "Each attachment must be an object" };
  }
  const a = att as Partial<ChatAttachment>;

  if (typeof a.name !== "string" || !a.name.trim() || a.name.length > MAX_ATTACHMENT_NAME) {
    return { ok: false, error: "Each attachment needs a name" };
  }
  const info = typeof a.mediaType === "string" ? classifyFile(a.name, a.mediaType) : null;
  if (!info || info.kind !== a.kind) {
    return { ok: false, error: `Attachment "${a.name}" has an unsupported type` };
  }
  if (typeof a.data !== "string" || a.data.length === 0) {
    return { ok: false, error: `Attachment "${a.name}" has no content` };
  }
  if (a.data.length > MAX_ATTACHMENT_DATA_LENGTH) {
    return { ok: false, error: `Attachment "${a.name}" is too large` };
  }
  if (typeof a.sizeBytes !== "number" || !(a.sizeBytes >= 0) || a.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `Attachment "${a.name}" is too large` };
  }
  if ((info.kind === "image" || info.kind === "pdf") && !BASE64_RE.test(a.data)) {
    return { ok: false, error: `Attachment "${a.name}" has invalid content` };
  }

  return {
    ok: true,
    value: {
      name: a.name.trim(),
      mediaType: info.mediaType,
      kind: info.kind,
      data: a.data,
      sizeBytes: a.sizeBytes,
    },
  };
}

// Browser-side: read a picked File into a ChatAttachment, or explain
// why it can't be used. Runs only in the browser (FileReader).
export async function readFileAsAttachment(
  file: File
): Promise<{ attachment?: ChatAttachment; error?: string }> {
  const info = classifyFile(file.name, file.type);
  if (!info) {
    return { error: "only photos, pdfs, and text or csv files work here." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: "that file is over 5 mb. try a smaller one." };
  }

  if (info.kind === "text") {
    const data = await file.text();
    return {
      attachment: {
        name: file.name,
        mediaType: info.mediaType,
        kind: "text",
        data,
        sizeBytes: file.size,
      },
    };
  }

  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  // readAsDataURL returns "data:<mime>;base64,<payload>" — the model
  // wants just the payload.
  const base64 = data.slice(data.indexOf(",") + 1);
  return {
    attachment: {
      name: file.name,
      mediaType: info.mediaType,
      kind: info.kind,
      data: base64,
      sizeBytes: file.size,
    },
  };
}
