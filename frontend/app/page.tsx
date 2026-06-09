"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfigPanel from "@/components/ConfigPanel";
import ActivityLog, { classifyLine } from "@/components/ActivityLog";
import ReelsTable from "@/components/ReelsTable";
import {
  fetchStatus,
  fetchReels,
  startScrape,
  startCaptions,
  startTranscripts,
  clearSession,
  openJobSocket,
  type Reel,
  type WsEvent,
} from "@/lib/api";

interface LogLine {
  id: number;
  text: string;
  kind: "info" | "success" | "error" | "reel";
}

type Status = "idle" | "scraping" | "captions" | "transcripts";

let _lineId = 0;
function nextId() {
  return ++_lineId;
}

export default function Home() {
  const [threadUrl, setThreadUrl] = useState("");
  const [reels, setReels] = useState<Reel[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [sessionExists, setSessionExists] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const reelsCount = reels.length;
  const captionsCount = reels.filter((r) => r.caption).length;

  const addLog = useCallback((text: string, kind?: LogLine["kind"]) => {
    setLogs((prev) => [
      ...prev,
      { id: nextId(), text, kind: kind ?? classifyLine(text) },
    ]);
  }, []);

  useEffect(() => {
    fetchStatus().then((s) => {
      setSessionExists(s.session_exists);
      if (s.default_thread_url) setThreadUrl(s.default_thread_url);
    });
  }, []);

  function connectJob(jobId: string, jobStatus: Status) {
    socketRef.current?.close();
    const ws = openJobSocket(jobId);
    socketRef.current = ws;
    setStatus(jobStatus);

    ws.onmessage = (ev) => {
      const event: WsEvent = JSON.parse(ev.data);

      switch (event.type) {
        case "log":
          addLog(event.msg ?? "");
          break;

        case "reel":
          if (event.data) {
            setReels((prev) => {
              if (prev.some((r) => r.url === event.data!.url)) return prev;
              return [...prev, event.data!];
            });
            addLog(`+ @${event.data.sender}`, "reel");
          }
          break;

        case "caption_update":
          if (event.url && event.caption !== undefined) {
            setReels((prev) =>
              prev.map((r) => r.url === event.url ? { ...r, caption: event.caption! } : r)
            );
          }
          break;

        case "transcript_update":
          if (event.id && event.transcript !== undefined) {
            setReels((prev) =>
              prev.map((r) => {
                const id = new URL(r.url).pathname.split("/").filter(Boolean).pop();
                return id === event.id ? { ...r, transcript: event.transcript } : r;
              })
            );
          }
          break;

        case "done":
          addLog(`✓ Done — ${event.count ?? 0} items`, "success");
          setStatus("idle");
          setSessionExists(true);
          fetchReels().then((r) => { if (r.length > 0) setReels(r); });
          break;

        case "error":
          addLog(`✗ ${event.msg ?? "Unknown error"}`, "error");
          setStatus("idle");
          break;
      }
    };

    ws.onerror = () => {
      addLog("✗ WebSocket error — check backend is running", "error");
      setStatus("idle");
    };

    ws.onclose = () => { if (status !== "idle") setStatus("idle"); };
  }

  async function handleRelogin() {
    await clearSession();
    setSessionExists(false);
    addLog("Session cleared — login window will open on next scrape.");
  }

  async function handleScrape() {
    if (!threadUrl.trim()) return;
    addLog("Starting scrape + caption fetch…");
    const res = await startScrape(threadUrl.trim());
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "scraping");
  }

  async function handleCaptions() {
    addLog("Fetching captions for existing reels…");
    const res = await startCaptions();
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "captions");
  }

  async function handleTranscripts() {
    addLog("Starting audio transcript pipeline…");
    const res = await startTranscripts();
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "transcripts");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-base text-primary">
      <ConfigPanel
        threadUrl={threadUrl}
        onThreadUrlChange={setThreadUrl}
        onScrape={handleScrape}
        onCaptions={handleCaptions}
        onTranscripts={handleTranscripts}
        onRelogin={handleRelogin}
        reelsCount={reelsCount}
        captionsCount={captionsCount}
        status={status}
        sessionExists={sessionExists}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-10 border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
          <span className="text-muted text-xs">DM Reels</span>
          <span className="text-border">·</span>
          <StatusBadge status={status} />
          {reelsCount > 0 && (
            <>
              <span className="text-border">·</span>
              <span className="text-muted text-xs">{reelsCount} reels</span>
            </>
          )}
        </header>

        <ActivityLog lines={logs} />
        <ReelsTable reels={reels} />
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { dot: string; label: string }> = {
    idle:        { dot: "bg-muted/40",             label: "idle" },
    scraping:    { dot: "bg-accent animate-pulse",  label: "scraping" },
    captions:    { dot: "bg-warn animate-pulse",    label: "fetching captions" },
    transcripts: { dot: "bg-success animate-pulse", label: "transcribing" },
  };
  const { dot, label } = map[status];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
