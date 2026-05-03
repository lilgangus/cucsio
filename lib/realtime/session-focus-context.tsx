"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type OpenSessionFn = (
  sessionId: string,
  scrollToMessageId?: string | null
) => void;

type Value = {
  /** Session id whose chat overlay is open, or null if browsing the tree only */
  focusedSessionId: string | null;
  setFocusedSessionId: (id: string | null) => void;
  /**
   * Opens the chat for a session (forest overlay or sidebar chat). Optional
   * `scrollToMessageId` scrolls that message into view after messages load.
   * Implemented by whichever room surface is mounted (`ForestCanvas` or `ChatPanel`).
   */
  openSessionChat: OpenSessionFn;
  /** Internal: `ForestCanvas` / `ChatPanel` registers the navigation implementation. */
  setOpenSessionChatImpl: (fn: OpenSessionFn | null) => void;
};

const SessionFocusContext = createContext<Value | undefined>(undefined);

export function SessionFocusProvider({ children }: { children: ReactNode }) {
  const [focusedSessionId, setFocusedSessionIdState] = useState<string | null>(
    null
  );

  const openImplRef = useRef<OpenSessionFn | null>(null);

  const setFocusedSessionId = useCallback((id: string | null) => {
    setFocusedSessionIdState(id);
  }, []);

  const setOpenSessionChatImpl = useCallback((fn: OpenSessionFn | null) => {
    openImplRef.current = fn;
  }, []);

  const openSessionChat = useCallback(
    (sessionId: string, scrollToMessageId?: string | null) => {
      openImplRef.current?.(sessionId, scrollToMessageId ?? undefined);
    },
    []
  );

  const value = useMemo(
    () => ({
      focusedSessionId,
      setFocusedSessionId,
      openSessionChat,
      setOpenSessionChatImpl,
    }),
    [
      focusedSessionId,
      openSessionChat,
      setFocusedSessionId,
      setOpenSessionChatImpl,
    ]
  );

  return (
    <SessionFocusContext.Provider value={value}>
      {children}
    </SessionFocusContext.Provider>
  );
}

/** Must run under `<SessionFocusProvider />` inside the room UI. */
export function useSessionFocus(): Value {
  const ctx = useContext(SessionFocusContext);
  if (!ctx) {
    throw new Error("useSessionFocus must be used within SessionFocusProvider");
  }
  return ctx;
}
