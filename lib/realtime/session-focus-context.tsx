"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Value = {
  /** Session id whose chat overlay is open, or null if browsing the tree only */
  focusedSessionId: string | null;
  setFocusedSessionId: (id: string | null) => void;
};

const SessionFocusContext = createContext<Value | undefined>(undefined);

export function SessionFocusProvider({ children }: { children: ReactNode }) {
  const [focusedSessionId, setFocusedSessionIdState] = useState<string | null>(
    null
  );

  const setFocusedSessionId = useCallback((id: string | null) => {
    setFocusedSessionIdState(id);
  }, []);

  const value = useMemo(
    () => ({ focusedSessionId, setFocusedSessionId }),
    [focusedSessionId, setFocusedSessionId]
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
