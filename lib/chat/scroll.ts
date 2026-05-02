"use client";

const FLASH_DURATION_MS = 1500;
const FLASH_RING_CLASSES = ["ring-2", "ring-yellow-400"];

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function flashBubbleRing(element: HTMLElement) {
  element.classList.add(...FLASH_RING_CLASSES);
  window.setTimeout(() => {
    element.classList.remove(...FLASH_RING_CLASSES);
  }, FLASH_DURATION_MS);
}

function unwrapMark(mark: HTMLElement, replacementText: string) {
  const textNode = document.createTextNode(replacementText);
  mark.replaceWith(textNode);
}

function flashSnippet(container: HTMLElement, snippet: string): boolean {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    if (!(textNode instanceof Text)) {
      textNode = walker.nextNode();
      continue;
    }

    const index = textNode.data.indexOf(snippet);
    if (index === -1) {
      textNode = walker.nextNode();
      continue;
    }

    const before = textNode.data.slice(0, index);
    const match = textNode.data.slice(index, index + snippet.length);
    const after = textNode.data.slice(index + snippet.length);
    const fragment = document.createDocumentFragment();

    if (before) {
      fragment.appendChild(document.createTextNode(before));
    }

    const mark = document.createElement("mark");
    mark.className = "cucsio-flash rounded bg-yellow-200 px-0.5 text-foreground";
    mark.textContent = match;
    fragment.appendChild(mark);

    if (after) {
      fragment.appendChild(document.createTextNode(after));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);

    window.setTimeout(() => {
      unwrapMark(mark, match);
    }, FLASH_DURATION_MS);

    return true;
  }

  return false;
}

export function findAndFlashMessage(messageId: string, snippet?: string) {
  if (typeof document === "undefined") return;

  const bubble = document.querySelector<HTMLElement>(
    `[data-message-id="${cssEscape(messageId)}"]`
  );
  if (!bubble) return;

  bubble.scrollIntoView({ behavior: "smooth", block: "center" });

  if (snippet && flashSnippet(bubble, snippet)) {
    return;
  }

  flashBubbleRing(bubble);
}
