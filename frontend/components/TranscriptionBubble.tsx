"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  isActive: boolean;
  current: number;
  total: number;
}

export default function TranscriptionBubble({ isActive, current, total }: Props) {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isActive) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
      setDone(false);
    } else if (visible) {
      setDone(true);
      hideTimer.current = setTimeout(() => setVisible(false), 3000);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [isActive]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-2 shadow-panel">
      {done ? (
        <>
          <span className="text-success text-xs font-medium">✓</span>
          <span className="text-sm text-primary font-medium">Transcripts done</span>
        </>
      ) : (
        <>
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
          <span className="text-sm text-primary font-medium">
            Transcribing
            {total > 0 && (
              <span className="text-muted font-normal ml-1">
                {current}/{total}
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}
