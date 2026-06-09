"use client";

import { useEffect, useRef } from "react";

interface LogLine {
  id: number;
  text: string;
  kind: "info" | "success" | "error" | "reel";
}

interface Props {
  lines: LogLine[];
}

export default function ActivityLog({ lines }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="h-48 border-b border-border overflow-y-auto bg-[#0c0c0c] font-mono">
      <div className="sticky top-0 z-10 px-4 py-2 bg-[#0c0c0c] border-b border-border flex items-center justify-between">
        <span className="text-muted text-xs font-sans font-medium uppercase tracking-wider">
          Activity
        </span>
        {lines.length > 0 && (
          <span className="text-muted text-xs font-sans">{lines.length} lines</span>
        )}
      </div>
      <div className="px-4 py-2 space-y-0.5">
        {lines.length === 0 ? (
          <p className="text-muted text-xs py-2">Waiting to start…</p>
        ) : (
          lines.map((line) => (
            <p key={line.id} className={`text-xs leading-5 ${lineColor(line.kind)}`}>
              <span className="text-muted select-none mr-2">›</span>
              {line.text}
            </p>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function lineColor(kind: LogLine["kind"]) {
  switch (kind) {
    case "success":
      return "text-success";
    case "error":
      return "text-error";
    case "reel":
      return "text-accent";
    default:
      return "text-[#888]";
  }
}

export function classifyLine(text: string): LogLine["kind"] {
  if (text.startsWith("✓") || text.startsWith("✔")) return "success";
  if (text.startsWith("✗") || text.toLowerCase().includes("error")) return "error";
  if (text.includes("reel")) return "reel";
  return "info";
}
