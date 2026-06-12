"use client";

import { useState } from "react";
import type { Reel } from "@/lib/api";

interface Props {
  reels: Reel[];
}

export default function StatsBar({ reels }: Props) {
  const [showNerds, setShowNerds] = useState(false);

  const total = reels.length;
  const captions = reels.filter((r) => r.caption).length;
  const transcripts = reels.filter((r) => r.transcript).length;
  const videos = reels.filter((r) => r.video_path).length;
  const dmCount = reels.filter((r) => !r.source || r.source === "dm").length;
  const savedCount = reels.filter((r) => r.source === "saved").length;

  if (total === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-sm text-muted flex-wrap">
        <span className="font-medium text-primary tabular-nums">{total}</span>
        <span>reels</span>
        <Dot />
        <span className="tabular-nums">{captions}</span>
        <span>captions</span>
        <Dot />
        <span className="tabular-nums">{transcripts}</span>
        <span>transcripts</span>
        {videos > 0 && (
          <>
            <Dot />
            <span className="tabular-nums">{videos}</span>
            <span>videos</span>
          </>
        )}
        <button
          onClick={() => setShowNerds((s) => !s)}
          className="ml-2 text-xs text-muted hover:text-accent transition-colors"
        >
          stats for nerds {showNerds ? "▴" : "▾"}
        </button>
      </div>

      {showNerds && (
        <div className="flex items-center gap-4 text-xs text-muted bg-surface-2 border border-border rounded-lg px-4 py-2.5 flex-wrap">
          <Stat label="DM reels" value={dmCount} />
          <Stat label="Saved reels" value={savedCount} />
          <Stat label="Caption rate" value={total > 0 ? `${Math.round((captions / total) * 100)}%` : "—"} />
          <Stat label="Transcript rate" value={total > 0 ? `${Math.round((transcripts / total) * 100)}%` : "—"} />
          <Stat label="Missing captions" value={total - captions} />
        </div>
      )}
    </div>
  );
}

function Dot() {
  return <span className="text-border-2">·</span>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <span className="text-muted-2">{label}:</span>{" "}
      <span className="text-primary font-medium tabular-nums">{value}</span>
    </span>
  );
}
