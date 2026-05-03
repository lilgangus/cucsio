"use client";

import type { ChatAttachment } from "@/lib/chat/attachments";
import {
  isSupportedAttachmentFile,
  isTextLikeAttachment,
  MAX_TEXT_ATTACHMENT_CHARS,
} from "@/lib/chat/attachments";

function uid(): string {
  return `att-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("could not read file"));
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function fileToChatAttachment(
  file: File
): Promise<ChatAttachment> {
  if (!isSupportedAttachmentFile(file)) {
    throw new Error(`${file.name} is not a supported image or document.`);
  }

  const mediaType = file.type || "application/octet-stream";
  const dataUrl = await readAsDataUrl(file);
  const isText = isTextLikeAttachment(mediaType, file.name);
  const text = isText
    ? (await file.text()).slice(0, MAX_TEXT_ATTACHMENT_CHARS)
    : undefined;

  return {
    id: uid(),
    kind: mediaType.startsWith("image/") ? "image" : "document",
    name: file.name || "attachment",
    mediaType,
    size: file.size,
    data: base64FromDataUrl(dataUrl),
    text,
  };
}
