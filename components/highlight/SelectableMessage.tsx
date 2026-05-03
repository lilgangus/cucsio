"use client";

import { PinIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, createHighlight } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  sessionId: string;
  messageId: string;
  className?: string;
  children: ReactNode;
};

/**
 * Wraps a chat bubble so a text selection can be pinned to the project
 * highlights board (toolbar appears near the selection).
 */
export function SelectableMessage({
  sessionId,
  messageId,
  className,
  children,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [pinning, setPinning] = useState(false);

  const clearToolbar = useCallback(() => {
    setToolbar(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearToolbar();
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      const t = e.target as Node;
      if (toolbar && rootRef.current.contains(t)) return;
      // toolbar is portaled — clicks on it are outside rootRef; check portal by class
      const el = t as HTMLElement;
      if (el.closest?.("[data-highlight-toolbar]")) return;
      if (!rootRef.current.contains(t)) clearToolbar();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [clearToolbar, toolbar]);

  const onMouseUp = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setToolbar(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setToolbar(null);
      return;
    }
    const r = range.getBoundingClientRect();
    setToolbar({
      x: r.left + r.width / 2,
      y: r.bottom + 6,
      text,
    });
  }, []);

  const onPin = useCallback(async () => {
    if (!toolbar) return;
    setPinning(true);
    try {
      await createHighlight({
        sessionId,
        messageId,
        content: toolbar.text,
      });
      toast.success("Pinned to highlights");
      window.getSelection()?.removeAllRanges();
      setToolbar(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not pin highlight");
    } finally {
      setPinning(false);
    }
  }, [sessionId, messageId, toolbar]);

  return (
    <>
      <div
        ref={rootRef}
        data-message-id={messageId}
        className={cn(className)}
        onMouseUp={onMouseUp}
      >
        {children}
      </div>
      {typeof document !== "undefined" &&
        toolbar &&
        createPortal(
          <div
            data-highlight-toolbar
            className="fixed z-[80] flex -translate-x-1/2 rounded-lg border border-border bg-popover px-1 py-1 shadow-lg"
            style={{
              left: toolbar.x,
              top: toolbar.y,
            }}
          >
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={pinning}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void onPin()}
            >
              <PinIcon className="size-3.5" />
              {pinning ? "Pinning…" : "Highlight"}
            </Button>
          </div>,
          document.body
        )}
    </>
  );
}
