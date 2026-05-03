"use client";

import {
  ArrowDownIcon,
  GitBranchIcon,
  LockIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, sendMessage } from "@/lib/api";
import { loadIdentity, type Identity } from "@/lib/identity";
import type { PresenceState } from "@/lib/realtime/channels";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import type { MessageRow, SessionRow } from "@/types/db";

import {
  type MessageAuthorSnippet,
  useSessionMessages,
} from "./hooks";

/** Collapsed label beside a user bubble (AGENTS collision rule: `#first4` of identity id). */
type SenderChip = { label: string; color: string };

function resolveSenderChip(
  userId: string,
  snippets: Record<string, MessageAuthorSnippet>,
  presence: PresenceState[],
  identity: Identity | null
): SenderChip {
  if (identity?.clientId === userId) {
    return {
      label: `${identity.displayName}#${userId.slice(0, 4)}`,
      color: identity.color,
    };
  }
  const row = snippets[userId];
  if (row) {
    return {
      label: `${row.display_name}#${userId.slice(0, 4)}`,
      color: row.color,
    };
  }
  const live = presence.find((p) => p.clientId === userId);
  if (live) {
    return {
      label: `${live.displayName}#${userId.slice(0, 4)}`,
      color: live.color,
    };
  }
  return {
    label: `Unknown#${userId.slice(0, 4)}`,
    color: "#64748b",
  };
}

/**
 * The "popped-up" view of one chat session. Three modes (driven by the
 * parent's `target` prop):
 *
 *   1. session    — the common case: load + stream the session's
 *                   messages, send into it, branch off it.
 *   2. new-tree   — overlay shown before the session exists; the parent
 *                   creates it on first send.
 *   3. new-fork   — overlay shown immediately after New branch so the
 *                   user sees the parent's history while the fork API
 *                   is still in flight; parent finalizes on first send.
 *
 * Lock rules (see API route): one user holds `pending_user_id` while
 * sending. While someone else holds it, our input is disabled and we
 * show "Alice is sending...".
 */

export type OverlayProps = {
  session: SessionRow | null;
  /**
   * Live presence list for this session, supplied by the canvas. The
   * canvas owns the per-session Realtime channels (see `hooks.ts` for
   * why we don't subscribe in here).
   */
  presence: PresenceState[];
  /** Pre-fetched messages to render while we wait for the live ones. */
  prefetchedMessages?: MessageRow[];
  /** True when no session exists yet (new-tree or new-fork). */
  isPending: boolean;
  pendingMode?: "new-tree" | "new-fork" | "new-combine";
  /**
   * All parent session ids for this overlay. Empty for root nodes.
   * The overlay renders "Branched from [parent labels]" for these.
   */
  parentIds: string[];
  /**
   * Map of session_id → human label, so "Branched from" can render
   * actual names instead of raw UUIDs.
   */
  parentLabels: Record<string, string>;
  /** Async hook the parent provides for first-send creation flows. */
  onSendNew?: (
    content: string,
    sessionTarget?: string
  ) => Promise<{ sessionId: string } | null>;
  /** Optional lineage/context box for a forked session or pending fork. */
  forkContext?: {
    ancestorTargets: string[];
    inheritedSummary: string | null;
  } | null;
  onBranchOff: () => void;
  /** Open a different session in the overlay (used by "Branched from" links). */
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
};

export function NodeOverlay(props: OverlayProps) {
  const {
    session,
    presence,
    prefetchedMessages,
    isPending,
    pendingMode,
    parentIds,
    parentLabels,
    onSendNew,
    forkContext,
    onBranchOff,
    onOpenSession,
    onClose,
  } = props;

  const sessionId = session?.id ?? null;

  // Live messages still come from this component (no channel-dedup
  // risk: the messages hook uses a `session-messages:<id>` topic that
  // no other hook subscribes to).
  const {
    messages: liveMessages,
    loading: messagesLoading,
    authorsByUserId,
    ensureAuthorsKnown,
  } = useSessionMessages(sessionId, prefetchedMessages ?? null);

  const messages = useMemo(() => {
    // Prefer live data once it arrives. Until then show whatever
    // history the parent passed in (e.g. for a freshly-forked session).
    if (sessionId && (liveMessages.length > 0 || !messagesLoading)) {
      return liveMessages;
    }
    return prefetchedMessages ?? [];
  }, [sessionId, liveMessages, messagesLoading, prefetchedMessages]);

  // Identity / presence filtering --------------------------------------
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    // Canonical sync-with-external-system read for localStorage; same
    // pattern as top-bar.tsx + room-guard.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(loadIdentity());
  }, []);

  const others = useMemo(
    () => presence.filter((p) => p.clientId !== identity?.clientId),
    [presence, identity]
  );

  // Lock awareness -----------------------------------------------------
  const lockedBy = session?.pending_user_id ?? null;
  const lockedBySelf = lockedBy != null && lockedBy === identity?.clientId;
  const lockedByOther = lockedBy != null && !lockedBySelf;
  useEffect(() => {
    if (!lockedByOther || !lockedBy) return;
    if (presence.some((p) => p.clientId === lockedBy) || authorsByUserId[lockedBy])
      return;
    ensureAuthorsKnown([lockedBy]);
  }, [
    lockedByOther,
    lockedBy,
    presence,
    authorsByUserId,
    ensureAuthorsKnown,
  ]);

  const lockSenderChip = useMemo(() => {
    if (!lockedByOther || !lockedBy) return null;
    return resolveSenderChip(
      lockedBy,
      authorsByUserId,
      presence,
      identity
    );
  }, [authorsByUserId, identity, lockedBy, lockedByOther, presence]);

  // Send action --------------------------------------------------------
  const [draft, setDraft] = useState("");
  const [pendingTarget, setPendingTarget] = useState("");
  const [sessionTargetDraft, setSessionTargetDraft] = useState("");
  const sessionTargetFocusedRef = useRef(false);
  const sessionTargetLastWrittenRef = useRef("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isPending) return;
    if (pendingMode === "new-fork") {
      setPendingTarget(forkContext?.ancestorTargets[0] ?? "");
      return;
    }
    setPendingTarget("");
  }, [isPending, pendingMode, forkContext]);

  useEffect(() => {
    if (!session) return;
    const fromServer = session.session_target ?? "";
    if (sessionTargetFocusedRef.current) return;
    setSessionTargetDraft(fromServer);
    sessionTargetLastWrittenRef.current = fromServer.trim();
  }, [session?.id, session?.session_target]);

  useEffect(() => {
    if (isPending || !sessionId) return;
    const t = window.setTimeout(async () => {
      const next = sessionTargetDraft.trim();
      if (next === sessionTargetLastWrittenRef.current) return;
      try {
        const supabase = getSupabaseBrowser();
        const { error } = await supabase
          .from("sessions")
          .update({
            session_target: next,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
        if (error) throw error;
        sessionTargetLastWrittenRef.current = next;
      } catch (e) {
        console.warn("[NodeOverlay] session_target save failed", e);
        toast.error("Could not save session target");
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [sessionTargetDraft, sessionId, isPending]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (lockedByOther) return;

    setSending(true);
    try {
      if (isPending && onSendNew) {
        const created = await onSendNew(
          text,
          pendingTarget.trim() || undefined
        );
        if (!created) return;
        // The parent will swap our `target` to point at the new
        // session id; nothing else for us to do here.
      } else if (sessionId) {
        await sendMessage(sessionId, { content: text });
      }
      setDraft("");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 409
            ? "Someone else just sent a message. Wait a beat and try again."
            : err.message
          : "Could not send";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }, [
    draft,
    sending,
    lockedByOther,
    isPending,
    onSendNew,
    pendingTarget,
    sessionId,
  ]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  // Keep the message list scrolled to the bottom on new messages.
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const inputDisabled = lockedByOther || sending;

  const pendingHeadline =
    pendingMode === "new-tree"
      ? "Start a new tree"
      : pendingMode === "new-fork"
        ? "New branch — first message starts the new node"
        : pendingMode === "new-combine"
          ? "New chat with context — first message creates the node"
          : "Chat";

  const overlayAriaLabel = isPending
    ? pendingHeadline
    : sessionTargetDraft.trim() || "Session chat";

  const canBranch = !isPending && messages.length > 0;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal
        aria-label={overlayAriaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative flex h-full max-h-[90%] w-full max-w-3xl flex-col overflow-hidden rounded-3xl",
          "border border-border bg-card shadow-2xl"
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
            {isPending ? (
              <span className="truncate text-sm text-muted-foreground">
                {pendingHeadline}
              </span>
            ) : (
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="overlay-session-target"
                  className="sr-only"
                >
                  Session target
                </label>
                <Input
                  id="overlay-session-target"
                  value={sessionTargetDraft}
                  onChange={(e) => setSessionTargetDraft(e.target.value)}
                  onFocus={() => {
                    sessionTargetFocusedRef.current = true;
                  }}
                  onBlur={() => {
                    sessionTargetFocusedRef.current = false;
                  }}
                  placeholder="What this session is for…"
                  className="h-9 w-full border-dashed font-medium"
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PresenceChip others={others} />
            <Button
              variant="ghost"
              size="sm"
              onClick={onBranchOff}
              disabled={!canBranch}
              aria-label="Start a new branch from this chat"
            >
              <GitBranchIcon />
              New branch
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close"
            >
              <XIcon />
            </Button>
          </div>
        </header>

        <div
          ref={scrollerRef}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
        >
          {/* "Branched from" breadcrumb for any node with parents */}
          {parentIds.length > 0 ? (
            <BranchedFrom
              parentIds={parentIds}
              parentLabels={parentLabels}
              onOpenSession={onOpenSession}
            />
          ) : null}

          {forkContext ? (
            <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-blue-900 dark:text-blue-100">
              <p className="font-medium">
                Context: {forkContext.ancestorTargets.join(" → ")}
              </p>
              {forkContext.inheritedSummary ? (
                <p className="mt-1 line-clamp-3 text-[11px] text-blue-800/90 dark:text-blue-200/90">
                  {forkContext.inheritedSummary}
                </p>
              ) : null}
            </div>
          ) : null}

          {isPending ? (
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-3">
              <label
                htmlFor="pending-session-target"
                className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                Optional session target
              </label>
              <Input
                id="pending-session-target"
                value={pendingTarget}
                onChange={(e) => setPendingTarget(e.target.value)}
                placeholder="What this new session should attempt to fix..."
              />
            </div>
          ) : null}

          {pendingMode === "new-tree" && messages.length === 0 ? (
            <EmptyHint text="Send the first message to plant this tree." />
          ) : pendingMode === "new-fork" && messages.length === 0 ? (
            <EmptyHint text="First send will create the fork." />
          ) : pendingMode === "new-combine" &&
            messages.length === 0 &&
            parentIds.length === 0 ? (
            <EmptyHint text="First send will create the new node." />
          ) : null}

          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              role={m.role === "assistant" ? "assistant" : "user"}
              content={m.content}
              senderChip={
                m.role === "user" && m.author_id
                  ? resolveSenderChip(
                      m.author_id,
                      authorsByUserId,
                      presence,
                      identity
                    )
                  : null
              }
            />
          ))}

          {messagesLoading && messages.length === 0 && !isPending ? (
            <p className="text-center text-xs text-muted-foreground">
              Loading messages…
            </p>
          ) : null}
        </div>

        {lockedByOther ? (
          <div className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs text-amber-700 dark:text-amber-300">
            <LockIcon className="size-3.5" />
            <span>
              {lockSenderChip
                ? `${lockSenderChip.label} is sending…`
                : "Someone is sending…"}
              {" "}Inputs are paused until the reply lands.
            </span>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex items-end gap-2 border-t border-border bg-card/80 px-5 py-3"
        >
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={inputDisabled}
            placeholder={
              lockedByOther
                ? "Waiting for the current reply..."
                : isPending
                  ? "Type the first message..."
                  : "Continue this chat..."
            }
            rows={2}
            className="resize-none"
          />
          <Button
            type="submit"
            disabled={inputDisabled || draft.trim().length === 0}
          >
            {sending ? "Sending…" : "Send"}
            <ArrowDownIcon className="rotate-[-90deg]" />
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Pill in the overlay header showing other users in the same session.
 * Click to expand into a popover with their full names — that's what
 * the user request meant by "expanded for a realtime view of the
 * other user's chat" (since the chat itself is the body of this
 * dialog, the expansion is the participant list).
 */
function PresenceChip({ others }: { others: PresenceState[] }) {
  if (others.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/70"
            aria-label={`${others.length} other user${others.length === 1 ? "" : "s"} in this chat`}
          >
            <UsersIcon className="size-3.5" />
            <span>{others.length} chatting</span>
            <span className="flex items-center">
              {others.slice(0, 3).map((u) => (
                <span
                  key={u.clientId}
                  className="-ml-1 inline-block size-3 rounded-full ring-2 ring-muted first:ml-0"
                  style={{ background: u.color }}
                />
              ))}
            </span>
          </button>
        }
      />
      <PopoverContent align="end" className="w-60 p-2">
        <p className="px-1 pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          Live in this chat
        </p>
        <ul className="flex flex-col gap-1">
          {others.map((u) => (
            <li
              key={u.clientId}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <span
                className="inline-block size-3 rounded-full"
                style={{ background: u.color }}
                aria-hidden
              />
              <span className="truncate">{u.displayName}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {u.clientId.slice(0, 6)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ChatBubble({
  role,
  content,
  senderChip,
}: {
  role: "user" | "assistant";
  content: string;
  senderChip: SenderChip | null;
}) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {isUser && senderChip ? (
        <span
          className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground"
        >
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: senderChip.color }}
            aria-hidden
          />
          <span>{senderChip.label}</span>
        </span>
      ) : null}
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-muted text-foreground"
        )}
      >
        {content}
      </div>
    </div>
  );
}

/**
 * "Branched from [A] [B] [C]" breadcrumb shown at the top of the message
 * list for any node that has parents. Clicking a parent label fires
 * `onOpenSession` to swap the overlay to that node.
 */
function BranchedFrom({
  parentIds,
  parentLabels,
  onOpenSession,
}: {
  parentIds: string[];
  parentLabels: Record<string, string>;
  onOpenSession: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/40 dark:text-violet-300">
      <GitBranchIcon className="size-3.5 shrink-0 opacity-70" />
      <span className="font-medium">Branched from</span>
      {parentIds.map((pid, i) => (
        <span key={pid} className="flex items-center gap-1">
          {i > 0 ? <span className="opacity-50">+</span> : null}
          <button
            type="button"
            onClick={() => onOpenSession(pid)}
            className="rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:bg-violet-100 dark:hover:bg-violet-900/50"
          >
            {parentLabels[pid] ?? pid.slice(0, 8)}
          </button>
        </span>
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <SparklesIcon className="size-7 opacity-50" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
