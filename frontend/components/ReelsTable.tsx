"use client";

import { useState } from "react";
import Image from "next/image";
import type { Reel } from "@/lib/api";

interface Props {
  reels: Reel[];
}

export default function ReelsTable({ reels }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const visible = filter
    ? reels.filter(
        (r) =>
          r.sender.toLowerCase().includes(filter.toLowerCase()) ||
          r.caption.toLowerCase().includes(filter.toLowerCase())
      )
    : reels;

  function toggleExpand(url: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Table header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <span className="text-muted text-xs font-medium uppercase tracking-wider">
          Reels
        </span>
        <span className="text-muted text-xs">
          {reels.length > 0 ? `${visible.length}${filter ? `/${reels.length}` : ""} found` : "—"}
        </span>
        <div className="ml-auto">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by sender or caption…"
            className="bg-surface border border-border rounded px-3 py-1.5 text-xs text-primary placeholder-muted focus:outline-none focus:border-border-2 focus:ring-1 focus:ring-accent/30 w-64 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {reels.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-base">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 text-muted font-medium w-8">#</th>
                <th className="text-left px-3 py-2.5 text-muted font-medium w-8"></th>
                <th className="text-left px-3 py-2.5 text-muted font-medium">Sender</th>
                <th className="text-left px-3 py-2.5 text-muted font-medium">Sent At</th>
                <th className="text-left px-3 py-2.5 text-muted font-medium">Caption</th>
                <th className="text-left px-3 py-2.5 text-muted font-medium w-24">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((reel, i) => {
                const isExpanded = expanded.has(reel.url);
                return (
                  <tr
                    key={reel.url}
                    className="border-b border-border/50 hover:bg-surface transition-colors group"
                  >
                    <td className="px-4 py-2.5 text-muted tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <Thumb src={reel.thumbnail} alt={reel.sender} />
                    </td>
                    <td className="px-3 py-2.5">
                      <a
                        href={reel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-accent transition-colors"
                      >
                        @{reel.sender}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                      {reel.timestamp}
                    </td>
                    <td
                      className="px-3 py-2.5 max-w-sm cursor-pointer"
                      onClick={() => reel.caption && toggleExpand(reel.url)}
                    >
                      {reel.caption ? (
                        <span
                          className={`text-muted-2 leading-relaxed ${
                            isExpanded ? "" : "line-clamp-1"
                          }`}
                        >
                          {reel.caption}
                        </span>
                      ) : (
                        <span className="text-muted/40 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {reel.transcript ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs">
                          <span>✓</span>
                          <span>done</span>
                        </span>
                      ) : (
                        <span className="text-muted/40 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Thumb({ src, alt }: { src: string; alt: string }) {
  if (!src) {
    return (
      <div className="w-7 h-7 rounded bg-surface-2 border border-border flex items-center justify-center text-muted text-xs">
        ▶
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded overflow-hidden bg-surface-2 border border-border flex-shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center px-8">
      <div className="text-2xl mb-3 opacity-30">📭</div>
      <p className="text-muted text-sm">No reels yet</p>
      <p className="text-muted/60 text-xs mt-1">
        Enter a thread URL and click Scrape DM Thread
      </p>
    </div>
  );
}
