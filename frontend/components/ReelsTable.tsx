"use client";

import { useState } from "react";
import type { Reel } from "@/lib/api";

type Status = "idle" | "scraping" | "captions" | "transcripts" | "downloading";

interface Props {
  reels: Reel[];
  status: Status;
  search: string;
  transcribingUrls: Set<string>;
  onCaptionFetch: (url: string) => void;
  onTranscriptFetch: (url: string) => void;
  onOpen: (reel: Reel) => void;
}

export default function ReelsTable({
  reels,
  status,
  search,
  transcribingUrls,
  onCaptionFetch,
  onTranscriptFetch,
  onOpen,
}: Props) {
  const busy = status !== "idle";
  const bulkTranscribing = status === "transcripts";

  const visible = reels.filter((r) => {
    if (!search) return true;
    return (
      r.sender.toLowerCase().includes(search.toLowerCase()) ||
      r.caption?.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="bg-surface flex flex-col flex-1 min-h-0 overflow-hidden">
      {reels.length === 0 ? (
        <EmptyState />
      ) : (
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted font-medium w-10">#</th>
                <th className="px-3 py-3 text-xs text-muted font-medium w-14">Media</th>
                <th className="text-left px-3 py-3 text-xs text-muted font-medium">Author</th>
                <th className="text-left px-3 py-3 text-xs text-muted font-medium w-20">Source</th>
                <th className="text-left px-3 py-3 text-xs text-muted font-medium whitespace-nowrap">Date</th>
                <th className="text-left px-3 py-3 text-xs text-muted font-medium">Caption</th>
                <th className="text-left px-3 py-3 text-xs text-muted font-medium w-32">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((reel, i) => (
                <tr
                  key={reel.url}
                  onClick={() => onOpen(reel)}
                  className="border-b border-border/60 hover:bg-surface-2/60 transition-colors cursor-pointer group"
                >
                  {/* # */}
                  <td className="px-4 py-3 text-sm text-muted tabular-nums">{i + 1}</td>

                  {/* Media */}
                  <td className="px-3 py-3">
                    {(() => {
                      const hasMedia = !!(reel.video_path || reel.image_paths?.length);
                      const hasThumbnail = !!reel.thumbnail;
                      const btnBase = "w-10 h-10 flex-shrink-0 rounded-lg border border-border hover:border-accent hover:scale-105 transition-transform";
                      if (hasMedia && hasThumbnail) {
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpen(reel); }}
                            title="Play"
                            className={`relative overflow-hidden hover:text-accent text-white ${btnBase}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={reel.thumbnail} alt={reel.sender} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                              <svg width="15" height="15" viewBox="0 0 8 8" fill="currentColor" className="drop-shadow">
                                <path d="M1.5 1.5l5 2.5-5 2.5V1.5z" />
                              </svg>
                            </span>
                          </button>
                        );
                      }
                      return (
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpen(reel); }}
                          title={hasMedia ? "Play" : "Download"}
                          className={`flex items-center justify-center bg-surface-2 text-muted hover:text-accent ${btnBase}`}
                        >
                          {hasMedia ? (
                            <svg width="15" height="15" viewBox="0 0 8 8" fill="currentColor">
                              <path d="M1.5 1.5l5 2.5-5 2.5V1.5z" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 9 9" fill="none">
                              <path d="M4.5 1v5M2 4l2.5 2.5L7 4M1 8h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      );
                    })()}
                  </td>

                  {/* Sender */}
                  <td className="px-3 py-3">
                    <span className="text-sm text-primary">@{reel.sender}</span>
                  </td>

                  {/* Source */}
                  <td className="px-3 py-3">
                    <SourceBadge source={reel.source} label={reel.source_label} />
                  </td>

                  {/* Date */}
                  <td className="px-3 py-3 text-sm text-muted whitespace-nowrap">{reel.timestamp}</td>

                  {/* Caption */}
                  <td className="px-3 py-3 max-w-sm">
                    {reel.caption ? (
                      <span className="text-sm text-muted leading-relaxed line-clamp-2">{reel.caption}</span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCaptionFetch(reel.url); }}
                        disabled={busy}
                        className="text-xs px-2 py-0.5 rounded-md bg-accent text-white hover:bg-accent/80 disabled:opacity-30 transition-colors font-medium"
                      >
                        Fetch
                      </button>
                    )}
                  </td>

                  {/* Transcript */}
                  <td className="px-3 py-3">
                    {reel.transcript ? (
                      <CopyButton text={reel.transcript} />
                    ) : (bulkTranscribing || transcribingUrls.has(reel.url)) ? (
                      <TranscribingIndicator />
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); onTranscriptFetch(reel.url); }}
                        disabled={busy}
                        className="text-xs px-2 py-0.5 rounded-md border border-border text-muted hover:border-accent hover:text-accent disabled:opacity-30 transition-colors"
                      >
                        Transcribe
                      </button>
                    )}
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
      </div>
      )}
    </div>
  );
}


function SourceBadge({ source, label }: { source?: "dm" | "saved"; label?: string }) {
  const text = label ?? (source === "saved" ? "Saved" : "DM");
  const isSaved = source === "saved" || text === "Saved";
  const dmIdx = text.match(/^DM\s*(\d+)$/)?.[1];
  const dmColors = [
    "bg-surface-2 border-border text-muted",
    "bg-blue-50 border-blue-200 text-blue-600",
    "bg-purple-50 border-purple-200 text-purple-600",
    "bg-orange-50 border-orange-200 text-orange-600",
  ];
  let cls = "bg-surface-2 border-border text-muted";
  if (isSaved) cls = "bg-accent-light border-accent/20 text-accent";
  else if (dmIdx) cls = dmColors[parseInt(dmIdx) % dmColors.length] ?? dmColors[0];
  return (
    <span className={`inline-flex text-xs px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${cls}`}>
      {text}
    </span>
  );
}

function TranscribingIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <svg className="animate-spin w-3 h-3 text-accent flex-shrink-0" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
        <path d="M10.5 6A4.5 4.5 0 016 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>···</span>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button
      onClick={copy}
      title="Copy transcript"
      className="flex items-center gap-1 text-xs text-success font-medium hover:text-accent transition-colors"
    >
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 5.5l3 3 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="1" y="3.5" width="6.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
            <path d="M3.5 3.5V2a1 1 0 011-1h5a1 1 0 011 1v6.5a1 1 0 01-1 1H8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <div className="mb-5 opacity-20">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4z" stroke="var(--fg-muted)" strokeWidth="2" />
          <path d="M20 18l8 6-8 6V18z" fill="var(--fg-muted)" />
        </svg>
      </div>
      <p className="text-primary font-medium mb-1">No reels yet</p>
      <p className="text-muted text-sm">Configure sources and start scraping</p>
    </div>
  );
}
