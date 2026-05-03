"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import { toast } from "sonner";

import { fileToChatAttachment } from "@/lib/chat/attachment-client";
import type { ChatAttachment } from "@/lib/chat/attachments";
import {
  isSupportedAttachmentFile,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/chat/attachments";

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

export function useChatAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList).filter(isSupportedAttachmentFile);
      if (incoming.length === 0) return;

      const currentBytes = attachments.reduce((sum, a) => sum + a.size, 0);
      const remainingSlots = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remainingSlots <= 0) {
        toast.error(`Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`);
        return;
      }

      const next: ChatAttachment[] = [];
      let nextBytes = currentBytes;
      for (const file of incoming.slice(0, remainingSlots)) {
        if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
          toast.error(
            `${file.name} is larger than ${formatLimit(
              MAX_CHAT_ATTACHMENT_BYTES
            )}.`
          );
          continue;
        }
        if (nextBytes + file.size > MAX_CHAT_TOTAL_ATTACHMENT_BYTES) {
          toast.error(
            `Attachments are capped at ${formatLimit(
              MAX_CHAT_TOTAL_ATTACHMENT_BYTES
            )} total.`
          );
          break;
        }
        try {
          const attachment = await fileToChatAttachment(file);
          next.push(attachment);
          nextBytes += file.size;
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : `Could not attach ${file.name}`
          );
        }
      }

      if (next.length > 0) {
        setAttachments((prev) =>
          [...prev, ...next].slice(0, MAX_CHAT_ATTACHMENTS)
        );
      }
    },
    [attachments]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  const onFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (files?.length) void addFiles(files);
      event.currentTarget.value = "";
    },
    [addFiles]
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files).filter(
        isSupportedAttachmentFile
      );
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    },
    [addFiles]
  );

  return {
    attachments,
    fileInputRef,
    addFiles,
    removeAttachment,
    clearAttachments,
    onFileInputChange,
    onPaste,
  };
}
