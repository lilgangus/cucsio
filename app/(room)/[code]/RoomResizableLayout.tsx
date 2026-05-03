"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";

import { cn } from "@/lib/utils";

import { AgentSection } from "./agent/AgentSection";
import { ForestCanvas } from "./forest/ForestCanvas";
import { RightPanel } from "./right/RightPanel";

type Props = {
  projectId: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function RoomResizableLayout({ projectId }: Props) {
  const mainRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [leftPct, setLeftPct] = useState(68);
  const [userPct, setUserPct] = useState(60);

  const dragMain = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const root = mainRef.current;
    if (!root) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();

    const onMove = (e: globalThis.PointerEvent) => {
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(clamp(pct, 48, 82));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  const dragCanvas = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const root = canvasRef.current;
    if (!root) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();

    const onMove = (e: globalThis.PointerEvent) => {
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setUserPct(clamp(pct, 36, 76));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  return (
    <div ref={mainRef} className="flex min-h-0 flex-1 flex-row">
      <div
        className="relative flex min-w-0 flex-col overflow-hidden"
        style={{ flexBasis: `${leftPct}%` }}
      >
        <div ref={canvasRef} className="flex min-h-0 flex-1 flex-row">
          <div
            className="relative flex min-w-0 flex-col overflow-hidden"
            style={{ flexBasis: `${userPct}%` }}
          >
            <ForestCanvas projectId={projectId} />
          </div>

          <VerticalHandle
            label="agent"
            onPointerDown={dragCanvas}
            className="from-violet-500/20 via-violet-500/70 to-fuchsia-500/20"
          />

          <div
            className="relative flex min-w-[320px] flex-1 flex-col overflow-hidden bg-gradient-to-r from-violet-50/30 via-background to-background dark:from-violet-950/20"
            style={{ flexBasis: `${100 - userPct}%` }}
          >
            <AgentSection projectId={projectId} />
          </div>
        </div>
      </div>

      <VerticalHandle
        label="panel"
        onPointerDown={dragMain}
        className="from-border via-border to-border"
      />

      <aside
        className="flex min-w-[280px] flex-1 min-h-0 flex-col bg-card"
        style={{ flexBasis: `${100 - leftPct}%` }}
      >
        <RightPanel projectId={projectId} />
      </aside>
    </div>
  );
}

function VerticalHandle({
  label,
  onPointerDown,
  className,
}: {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} section`}
      onPointerDown={onPointerDown}
      className="group relative z-20 flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center"
    >
      <div
        className={cn(
          "h-full w-[3px] bg-gradient-to-b transition group-hover:w-1.5",
          className
        )}
      />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none opacity-90 transition group-hover:opacity-100">
        <span className="inline-flex rotate-90 items-center gap-1.5 rounded-full border border-violet-400/60 bg-card px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-700 shadow-sm dark:border-violet-300/40 dark:text-violet-200">
          <span className="size-1.5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500" />
          {label}
        </span>
      </div>
    </div>
  );
}
