"use client";

import { GitBranchPlusIcon, MessageSquareIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { UpstreamKeyDetails } from "@/components/chat/UpstreamKeyDetails";
import { AgenticTimeline } from "@/components/chat/AgenticTimeline";
import { ChatBubble, type ChatBubbleSenderChip } from "@/components/chat/ChatBubble";
import { PersistedAgentTrace } from "@/components/chat/PersistedAgentTrace";
import { SelectableMessage } from "@/components/highlight/SelectableMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, createSession, sendMessage } from "@/lib/api";
import { useAgentActivity } from "@/lib/agent/agent-activity-context";
import { loadIdentity, type Identity } from "@/lib/identity";
import { useAgentTimeline, safeParseTrace } from "@/lib/llm/agent-timeline-state";
import { useSessionFocus } from "@/lib/realtime/session-focus-context";

import {
  type MessageAuthorSnippet,
  useProjectSessions,
  useSessionMessages,
} from "../forest/hooks";

type Props = {
  roomCode: string;
  projectId: string;
};

function isSendAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

function resolveSenderChip(
  userId: string,
  snippets: Record<string, MessageAuthorSnippet>,
  identity: Identity | null
): ChatBubbleSenderChip {
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
  return {
    label: `Unknown#${userId.slice(0, 4)}`,
    color: "#64748b",
  };
}

/**
 * Fallback chat surface when `?tree=off`: pick a session, load messages
 * over Realtime, send through `/api/sessions/:id/messages` (OpenRouter).
 */
export function ChatPanel({ roomCode, projectId }: Props) {
  const { setOpenSessionChatImpl, openSessionChat } = useSessionFocus();
  const { sessions, loading: sessionsLoading, error: sessionsError } =
    useProjectSessions(projectId);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);

  useLayoutEffect(() => {
    setOpenSessionChatImpl((sid, mid) => {
      setPickedId(sid);
      setJumpMessageId(mid ?? null);
    });
    return () => setOpenSessionChatImpl(null);
  }, [setOpenSessionChatImpl]);

  const sessionId = useMemo(() => {
    if (pickedId && sessions.some((s) => s.id === pickedId)) return pickedId;
    return sessions[0]?.id ?? null;
  }, [sessions, pickedId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId]
  );

  const {
    messages,
    authorsByUserId,
    ensureAuthorsKnown,
    loading: messagesLoading,
  } = useSessionMessages(sessionId, null);

  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(loadIdentity());
  }, []);

  const lockedBy = activeSession?.pending_user_id ?? null;
  const lockedByOther =
    lockedBy != null && lockedBy !== identity?.clientId;

  useEffect(() => {
    if (!lockedByOther || !lockedBy) return;
    if (authorsByUserId[lockedBy]) return;
    ensureAuthorsKnown([lockedBy]);
  }, [lockedByOther, lockedBy, authorsByUserId, ensureAuthorsKnown]);

  const lockSenderChip = useMemo(() => {
    if (!lockedByOther || !lockedBy) return null;
    return resolveSenderChip(lockedBy, authorsByUserId, identity);
  }, [lockedByOther, lockedBy, authorsByUserId, identity]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const {
    state: agentState,
    apply: applyAgentEvent,
    reset: resetAgentTimeline,
    start: startAgentTimeline,
  } = useAgentTimeline();
  const { trigger: triggerAgent } = useAgentActivity();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sendAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => sendAbortRef.current?.abort();
  }, []);

  /** Changing session while a stream is in flight must release the server lock. */
  useEffect(() => {
    sendAbortRef.current?.abort();
    resetAgentTimeline();
  }, [sessionId, resetAgentTimeline]);

  const showAgentTimeline = useMemo(() => {
    if (agentState.phases.length === 0 && !agentState.running) return false;
    const doneId = agentState.finalAssistantMessageId;
    if (doneId && !agentState.running) {
      const row = messages.find((m) => m.id === doneId);
      if (row && safeParseTrace(row.agent_trace)) return false;
    }
    return true;
  }, [agentState, messages]);

  const synthesisLen = agentState.byId.synthesis?.text.length ?? 0;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    messages.length,
    showAgentTimeline,
    agentState.phases.length,
    synthesisLen,
  ]);

  useEffect(() => {
    if (!jumpMessageId || !sessionId) return;
    const root = scrollerRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-message-id="${jumpMessageId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setJumpMessageId(null);
    }
  }, [jumpMessageId, sessionId, messages]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !sessionId) return;
    if (lockedByOther) return;

    sendAbortRef.current?.abort();
    const ac = new AbortController();
    sendAbortRef.current = ac;
    setSending(true);
    resetAgentTimeline();
    startAgentTimeline();
    triggerAgent({
      reason: `chat query: "${text.slice(0, 80)}"`,
      source: "chat",
      targetPrompt: text,
      context: [
        activeSession?.session_target
          ? `Session target: ${activeSession.session_target}`
          : null,
        activeSession?.label ? `Session label: ${activeSession.label}` : null,
        activeSession?.smart_context
          ? `Upstream context: ${activeSession.smart_context.slice(0, 240)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    try {
      await sendMessage(sessionId, { content: text }, {
        onAgentEvent: applyAgentEvent,
        signal: ac.signal,
      });
      setDraft("");
    } catch (err) {
      resetAgentTimeline();
      if (isSendAbortError(err)) return;
      const msg =
        err instanceof ApiError
          ? err.status === 409
            ? "Someone else is sending in this session. Try again in a moment."
            : err.status === 503
              ? err.message
              : err.message
          : "Could not send";
      toast.error(msg);
    } finally {
      if (sendAbortRef.current === ac) sendAbortRef.current = null;
      setSending(false);
    }
  }, [
    draft,
    sending,
    sessionId,
    lockedByOther,
    activeSession,
    applyAgentEvent,
    resetAgentTimeline,
    startAgentTimeline,
    triggerAgent,
  ]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const onNewSession = useCallback(async () => {
    try {
      const { session } = await createSession({
        projectId,
        sessionTarget: "Sidebar chat",
      });
      setPickedId(session.id);
      toast.success("Started a new session");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create session");
    }
  }, [projectId]);

  const inputDisabled = lockedByOther || sending || !sessionId;
  const emptyProject = !sessionsLoading && sessions.length === 0;

  return (
    <section className="relative z-10 flex h-full min-h-0 flex-1 flex-col bg-background/80 backdrop-blur-sm">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <MessageSquareIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Chat</span>
        <span className="text-xs text-muted-foreground">
          Room <code className="rounded bg-muted px-1 font-mono">{roomCode}</code>
          {" · "}
          <code className="rounded bg-muted px-1 font-mono">?tree=off</code>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="chat-session-picker">
            Active session
          </label>
          <select
            id="chat-session-picker"
            className="h-9 max-w-[220px] rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            value={sessionId ?? ""}
            onChange={(e) =>
              setPickedId(e.target.value ? e.target.value : null)
            }
            disabled={sessions.length === 0}
          >
            {sessions.map((s) => {
              const label = (s.label ?? s.session_target).slice(0, 72);
              return (
                <option key={s.id} value={s.id}>
                  {label}
                  {(s.label ?? s.session_target).length > 72 ? "…" : ""}
                </option>
              );
            })}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => void onNewSession()}
          >
            <GitBranchPlusIcon className="size-3.5" />
            New session
          </Button>
        </div>
      </header>

      {activeSession?.smart_context?.trim() ? (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <UpstreamKeyDetails content={activeSession.smart_context} />
        </div>
      ) : null}

      {sessionsError ? (
        <p className="p-4 text-sm text-destructive">{sessionsError}</p>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        >
        {sessionsLoading ? (
          <p className="text-center text-sm text-muted-foreground">
            Loading sessions…
          </p>
        ) : emptyProject ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <p className="max-w-sm text-sm">No sessions in this project yet.</p>
            <Button type="button" onClick={() => void onNewSession()}>
              Create a session
            </Button>
          </div>
        ) : messagesLoading && messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Loading messages…
          </p>
        ) : (
          <>
            {messages.map((m) => {
              const bubble = (
                <ChatBubble
                  role={m.role === "assistant" ? "assistant" : "user"}
                  content={m.content}
                  senderChip={
                    m.role === "user" && m.author_id
                      ? resolveSenderChip(
                          m.author_id,
                          authorsByUserId,
                          identity
                        )
                      : null
                  }
                />
              );
              const trace =
                m.role === "assistant" ? (
                  <PersistedAgentTrace
                    trace={m.agent_trace}
                    assistantReply={m.content}
                    onOpenSession={(sid) => openSessionChat(sid)}
                  />
                ) : null;
              return sessionId ? (
                <SelectableMessage
                  key={m.id}
                  sessionId={sessionId}
                  messageId={m.id}
                >
                  {bubble}
                  {trace}
                </SelectableMessage>
              ) : (
                <div key={m.id}>
                  {bubble}
                  {trace}
                </div>
              );
            })}
            {showAgentTimeline ? (
              <AgenticTimeline
                state={agentState}
                onOpenSession={(sid) => openSessionChat(sid)}
              />
            ) : null}
          </>
        )}
        </div>

        {lockedByOther ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
            <span>
              {lockSenderChip
                ? `${lockSenderChip.label} is sending…`
                : "Someone is sending…"}
              {" "}Inputs pause until the reply is saved.
            </span>
          </div>
        ) : null}

        <form
          className="flex shrink-0 items-end gap-2 border-t border-border bg-card/80 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={inputDisabled || emptyProject}
            placeholder={
              emptyProject
                ? "Create a session first…"
                : lockedByOther
                  ? "Waiting for the current reply…"
                  : "Message the assistant…"
            }
            rows={2}
            className="resize-none"
          />
          <Button
            type="submit"
            disabled={
              inputDisabled || emptyProject || draft.trim().length === 0
            }
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </form>

      </div>
    </section>
  );
}
