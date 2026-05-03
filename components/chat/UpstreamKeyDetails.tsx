"use client";

import { ChevronDownIcon, ListTreeIcon } from "lucide-react";

import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  className?: string;
};

/**
 * Collapsible block for AI-generated key details from parent sessions
 * (`sessions.smart_context`). New branches have no copied message list;
 * this is the handoff from upstream work.
 */
export function UpstreamKeyDetails({ content, className }: Props) {
  const text = content.trim();
  if (!text) return null;

  return (
    <details
      className={cn(
        "group rounded-xl border border-emerald-200/90 bg-emerald-50/90 text-emerald-950",
        "dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100",
        "open:shadow-sm",
        className
      )}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium",
          "marker:content-none [&::-webkit-details-marker]:hidden",
          "rounded-xl outline-none hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40",
          "focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <ListTreeIcon className="size-3.5 shrink-0 opacity-90" aria-hidden />
        <span className="flex-1 text-left">
          Key details from prior sessions
          <span className="ml-1.5 font-normal text-emerald-800/85 dark:text-emerald-300/90">
            (AI summary — tap to expand)
          </span>
        </span>
        <ChevronDownIcon
          className="size-4 shrink-0 text-emerald-700 transition-transform group-open:rotate-180 dark:text-emerald-400"
          aria-hidden
        />
      </summary>
      <div className="border-t border-emerald-200/80 px-3 pb-3 pt-1 dark:border-emerald-800/50">
        <MarkdownContent
          content={text}
          className="text-[12px] leading-relaxed text-emerald-900 dark:text-emerald-100/95 [&_.markdown-chat]:text-[12px]"
        />
      </div>
    </details>
  );
}
