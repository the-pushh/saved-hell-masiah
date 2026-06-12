"use client";

import { useEffect, useRef, useState } from "react";

export interface LogLine {
  type: "line";
  id: number;
  text: string;
  kind: "info" | "success" | "error" | "reel";
}

export interface LogGroup {
  type: "group";
  id: number;
  label: string;
  lines: Array<{ id: number; text: string; kind: "info" | "success" | "error" | "reel" }>;
  done: boolean;
  success?: boolean;
  error?: boolean;
}

export type LogItem = LogLine | LogGroup;

interface Props {
  lines: LogItem[];
  isActive: boolean;
}

export default function ActivityLog({ lines, isActive }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, expanded]);

  useEffect(() => {
    if (isActive && lines.length > 0) setExpanded(true);
  }, [isActive, lines.length]);

  function toggleGroup(id: number) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalCount = lines.reduce(
    (n, item) => n + (item.type === "group" ? item.lines.length : 1),
    0
  );

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 pointer-events-none">
      {expanded && (
        <div className="pointer-events-auto w-[650px] bg-surface border border-border rounded-xl shadow-modal overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
            <div className="flex items-center gap-2">
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              )}
              <span className="text-sm font-medium text-primary">Activity</span>
              <span className="text-xs text-muted">{totalCount} events</span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="text-muted hover:text-primary text-lg leading-none transition-colors"
              aria-label="Collapse"
            >
              ×
            </button>
          </div>
          <div className="h-[435px] overflow-y-auto px-4 py-2 font-mono">
            {lines.length === 0 ? (
              <p className="text-xs text-muted py-2">Waiting to start…</p>
            ) : (
              lines.map((item) => {
                if (item.type === "group") {
                  const isOpen = openGroups.has(item.id);
                  const statusIcon = !item.done ? (
                    <span className="w-2.5 h-2.5 rounded-full border border-accent/60 animate-pulse inline-block align-middle" />
                  ) : item.error ? (
                    <span className="text-error text-xs">✗</span>
                  ) : (
                    <span className="text-success text-xs">✓</span>
                  );
                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => toggleGroup(item.id)}
                        className="w-full text-left flex items-center gap-2 py-0.5 text-xs text-muted hover:text-primary transition-colors"
                      >
                        <span className="text-muted-2 select-none w-3">
                          {isOpen ? "▾" : "▸"}
                        </span>
                        <span className="flex-1">{item.label}</span>
                        <span className="text-muted-2 text-[10px] mr-1">
                          {item.lines.length} lines
                        </span>
                        <span className="w-4 inline-flex items-center justify-center">
                          {statusIcon}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="ml-4 border-l border-border/40 pl-3 mb-1">
                          {item.lines.map((line) => (
                            <p
                              key={line.id}
                              className={`text-xs leading-5 ${lineColor(line.kind)}`}
                            >
                              <span className="text-muted-2 select-none mr-2">›</span>
                              {line.text}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <p
                    key={item.id}
                    className={`text-xs leading-5 ${lineColor(item.kind)}`}
                  >
                    <span className="text-muted-2 select-none mr-2">›</span>
                    {item.text}
                  </p>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      <button
        onClick={() => setExpanded((e) => !e)}
        className="pointer-events-auto flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-2 shadow-panel hover:border-border-2 transition-colors"
      >
        {isActive ? (
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-border-2" />
        )}
        <span className="text-sm text-muted">
          {isActive ? "Running…" : lines.length > 0 ? `${totalCount} events` : "Activity"}
        </span>
        <span className="text-muted text-xs">{expanded ? "▼" : "▲"}</span>
      </button>
    </div>
  );
}

function lineColor(kind: "info" | "success" | "error" | "reel") {
  switch (kind) {
    case "success": return "text-success";
    case "error":   return "text-error";
    case "reel":    return "text-accent";
    default:        return "text-muted";
  }
}

export function classifyLine(text: string): LogLine["kind"] {
  if (text.startsWith("✓") || text.startsWith("✔")) return "success";
  if (text.startsWith("✗") || text.toLowerCase().includes("error")) return "error";
  if (text.includes("reel") || text.startsWith("+ @")) return "reel";
  return "info";
}
