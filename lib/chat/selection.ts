"use client";

import { toast } from "sonner";

export type MessageSelection = {
  messageId: string;
  content: string;
};

let lastSelectionToastAt = 0;

function getNearestMessageElement(node: Node | null): HTMLElement | null {
  let current: Node | null = node;

  while (current) {
    if (current instanceof HTMLElement && current.dataset.messageId) {
      return current;
    }
    current = current.parentNode;
  }

  return null;
}

export function getMessageSelection(): MessageSelection | null {
  if (typeof window === "undefined") return null;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startMessage = getNearestMessageElement(range.startContainer);
  const endMessage = getNearestMessageElement(range.endContainer);

  if (!startMessage || !endMessage || startMessage.dataset.messageId !== endMessage.dataset.messageId) {
    return null;
  }

  const content = selection.toString().trim();
  if (content.length === 0 || content.length > 1000) {
    return null;
  }

  return {
    messageId: startMessage.dataset.messageId ?? "",
    content,
  };
}

export function showSingleMessageSelectionToast() {
  const now = Date.now();
  if (now - lastSelectionToastAt < 1200) return;

  lastSelectionToastAt = now;
  toast.error("Select within a single message to pin.");
}
