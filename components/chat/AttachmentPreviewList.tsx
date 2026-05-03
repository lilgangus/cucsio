"use client";

import { FileTextIcon, ImageIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChatAttachment } from "@/lib/chat/attachments";
import { attachmentDataUrl } from "@/lib/chat/attachments";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentPreviewList({
  attachments,
  onRemove,
  className,
  tone = "composer",
}: {
  attachments: ChatAttachment[];
  onRemove?: (id: string) => void;
  className?: string;
  tone?: "composer" | "message";
}) {
  if (attachments.length === 0) return null;
  const messageTone = tone === "message";

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment) => {
        const isImage = attachment.mediaType.startsWith("image/");
        return (
          <div
            key={attachment.id}
            className={cn(
              "group/attachment relative overflow-hidden rounded-lg border text-left shadow-sm",
              messageTone
                ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground"
                : "border-border bg-background text-foreground"
            )}
          >
            {isImage ? (
              <div className="relative h-24 w-32">
                {/* eslint-disable-next-line @next/next/no-img-element -- Pasted image previews are local data URLs. */}
                <img
                  src={attachmentDataUrl(attachment)}
                  alt={attachment.name}
                  className="h-full w-full object-cover"
                />
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 flex items-center gap-1 px-2 py-1 text-[10px]",
                    "bg-black/55 text-white"
                  )}
                >
                  <ImageIcon className="size-3 shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                </div>
              </div>
            ) : (
              <div className="flex max-w-[220px] items-center gap-2 px-2.5 py-2">
                <FileTextIcon className="size-4 shrink-0 opacity-80" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {attachment.name}
                  </p>
                  <p
                    className={cn(
                      "text-[10px]",
                      messageTone
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatBytes(attachment.size)}
                  </p>
                </div>
              </div>
            )}

            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${attachment.name}`}
                className={cn(
                  "absolute top-1 right-1 opacity-0 shadow-sm transition-opacity group-hover/attachment:opacity-100 focus-visible:opacity-100",
                  messageTone
                    ? "bg-black/35 text-white hover:bg-black/50 hover:text-white"
                    : "bg-background/85"
                )}
                onClick={() => onRemove(attachment.id)}
              >
                <XIcon className="size-3" />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
