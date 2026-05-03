import type { FilePart, TextPart, UserContent } from "ai";

export type ChatAttachment = {
  id: string;
  kind: "image" | "document";
  name: string;
  mediaType: string;
  size: number;
  data: string;
  text?: string;
};

export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_CHAT_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_CHARS = 24000;

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  "text/*",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".go",
  ".rs",
  ".sql",
  ".yaml",
  ".yml",
].join(",");

const ATTACHMENT_MARKER = "<!-- cucsio-attachments:";
const ATTACHMENT_MARKER_END = " -->";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "xml",
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "go",
  "rs",
  "sql",
  "yaml",
  "yml",
]);

const TEXT_MEDIA_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/sql",
  "application/yaml",
  "text/yaml",
]);

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanDocumentText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, max);
}

function extensionFor(name: string): string {
  const ext = name.split(".").pop();
  return ext ? ext.toLowerCase() : "";
}

export function isTextLikeAttachment(
  mediaType: string,
  name: string
): boolean {
  const mt = mediaType.toLowerCase();
  return (
    mt.startsWith("text/") ||
    TEXT_MEDIA_TYPES.has(mt) ||
    TEXT_EXTENSIONS.has(extensionFor(name))
  );
}

export function isSupportedAttachmentFile(file: File): boolean {
  const mediaType = file.type || "application/octet-stream";
  return (
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf" ||
    isTextLikeAttachment(mediaType, file.name)
  );
}

export function attachmentDataUrl(attachment: ChatAttachment): string {
  return `data:${attachment.mediaType};base64,${attachment.data}`;
}

export function normalizeChatAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ChatAttachment[] = [];
  let totalBytes = 0;

  for (const item of value) {
    if (attachments.length >= MAX_CHAT_ATTACHMENTS) break;
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const name = clean(raw.name, 120) || "attachment";
    const mediaType =
      clean(raw.mediaType, 80).toLowerCase() || "application/octet-stream";
    const kind = mediaType.startsWith("image/") ? "image" : "document";
    if (
      !mediaType.startsWith("image/") &&
      mediaType !== "application/pdf" &&
      !isTextLikeAttachment(mediaType, name)
    ) {
      continue;
    }

    const data = clean(raw.data, MAX_CHAT_ATTACHMENT_BYTES * 2).replace(
      /\s+/g,
      ""
    );
    const size =
      typeof raw.size === "number" && Number.isFinite(raw.size)
        ? Math.max(0, Math.floor(raw.size))
        : 0;
    if (!data || size <= 0 || size > MAX_CHAT_ATTACHMENT_BYTES) continue;
    if (totalBytes + size > MAX_CHAT_TOTAL_ATTACHMENT_BYTES) break;

    totalBytes += size;
    attachments.push({
      id: clean(raw.id, 64) || `att-${attachments.length}`,
      kind,
      name,
      mediaType,
      size,
      data,
      text: isTextLikeAttachment(mediaType, name)
        ? cleanDocumentText(raw.text, MAX_TEXT_ATTACHMENT_CHARS)
        : undefined,
    });
  }

  return attachments;
}

export function packMessageContent(
  text: string,
  attachments: ChatAttachment[]
): string {
  const cleanText = text.trim();
  const safeAttachments = normalizeChatAttachments(attachments);
  if (safeAttachments.length === 0) return cleanText;
  const payload = encodeURIComponent(JSON.stringify(safeAttachments));
  return `${cleanText}\n\n${ATTACHMENT_MARKER}${payload}${ATTACHMENT_MARKER_END}`.trim();
}

export function unpackMessageContent(content: string): {
  text: string;
  attachments: ChatAttachment[];
} {
  const markerStart = content.lastIndexOf(ATTACHMENT_MARKER);
  if (markerStart < 0) return { text: content, attachments: [] };
  const markerEnd = content.indexOf(ATTACHMENT_MARKER_END, markerStart);
  if (markerEnd < 0) return { text: content, attachments: [] };

  const encoded = content.slice(
    markerStart + ATTACHMENT_MARKER.length,
    markerEnd
  );
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
    return {
      text: content.slice(0, markerStart).trim(),
      attachments: normalizeChatAttachments(parsed),
    };
  } catch {
    return { text: content, attachments: [] };
  }
}

export function describeAttachments(attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return "";
  return attachments
    .map((a) => {
      const type = a.kind === "image" ? "image" : "document";
      return `${type}: ${a.name}`;
    })
    .join("; ");
}

export function messageTextForPrompt(content: string): string {
  const parsed = unpackMessageContent(content);
  const text = parsed.text.trim();
  const attachmentText = describeAttachments(parsed.attachments);
  if (!attachmentText) return text;
  return [text, `Attachments: ${attachmentText}`].filter(Boolean).join("\n");
}

export function messageContentToModelContent(
  content: string
): UserContent {
  const parsed = unpackMessageContent(content);
  if (parsed.attachments.length === 0) return parsed.text;

  const parts: Array<TextPart | FilePart> = [];
  const text = parsed.text.trim();
  if (text) {
    parts.push({ type: "text", text });
  }

  for (const attachment of parsed.attachments) {
    if (
      attachment.mediaType.startsWith("image/") ||
      attachment.mediaType === "application/pdf"
    ) {
      parts.push({
        type: "file",
        data: attachment.data,
        filename: attachment.name,
        mediaType: attachment.mediaType,
      });
      continue;
    }

    parts.push({
      type: "text",
      text: [
        `Uploaded document: ${attachment.name}`,
        attachment.text?.trim() || "(No text preview was available.)",
      ].join("\n"),
    });
  }

  if (parts.length === 0) return "Uploaded attachment.";
  return parts;
}
