"use client";

import type { ReactNode } from "react";

import { SessionFocusProvider } from "@/lib/realtime/session-focus-context";

/**
 * Clients-only providers for anything under the room top bar — session
 * focus for cross-component presence aggregation, master prompt sync hooks
 * layered on descendants, etc.
 */
export function RoomProviders({ children }: { children: ReactNode }) {
  return <SessionFocusProvider>{children}</SessionFocusProvider>;
}
