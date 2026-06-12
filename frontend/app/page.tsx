"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import ActivityLog, { classifyLine, type LogItem, type LogGroup } from "@/components/ActivityLog";
import ReelsTable from "@/components/ReelsTable";
import OnboardingDialog from "@/components/OnboardingDialog";
import VideoModal from "@/components/VideoModal";
import SourceTabs from "@/components/SourceTabs";
import AddSourceModal from "@/components/AddSourceModal";
import SkyBackground from "@/components/SkyBackground";
import StatsBar from "@/components/StatsBar";
import TranscriptionBubble from "@/components/TranscriptionBubble";
import {
  fetchStatus,
  fetchReels,
  startScrape,
  startCaptions,
  startTranscripts,
  startDownloadAll,
  refetchCaption,
  refetchTranscript,
  clearSession,
  openJobSocket,
  API_BASE,
  type Reel,
  type Source,
  type StoredSource,
  type WsEvent,
} from "@/lib/api";

type Status = "idle" | "scraping" | "captions" | "transcripts" | "downloading";

let _lineId = 0;
function nextId() { return ++_lineId; }

function loadStoredSources(): StoredSource[] {
  try {
    const raw = localStorage.getItem("lo_sources");
    if (raw) return JSON.parse(raw) as StoredSource[];
  } catch {}
  return [];
}

function saveStoredSources(sources: StoredSource[]) {
  localStorage.setItem("lo_sources", JSON.stringify(sources));
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [reels, setReels] = useState<Reel[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const activeGroupIdRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [sessionExists, setSessionExists] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [videoModal, setVideoModal] = useState<Reel | null>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [configuredSources, setConfiguredSources] = useState<StoredSource[]>([]);
  const [activeSource, setActiveSource] = useState<string>("all");
  const [rescrapeTarget, setRescrapeTarget] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [transcriptionProgress, setTranscriptionProgress] = useState({ current: 0, total: 0 });
  const [transcribingUrls, setTranscribingUrls] = useState<Set<string>>(new Set());
  const socketRef = useRef<WebSocket | null>(null);

  const captionsCount = reels.filter((r) => r.caption).length;
  const isActive = status !== "idle";

  // Derived: per-source reel counts and filtered reels
  const reelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of configuredSources) {
      counts[s.name] = reels.filter((r) => r.source_label === s.name).length;
    }
    return counts;
  }, [reels, configuredSources]);

  const filteredReels = useMemo(
    () =>
      !activeSource
        ? reels
        : reels.filter((r) => r.source_label === activeSource),
    [reels, activeSource]
  );

  // Reset search when switching tabs
  useEffect(() => { setSearch(""); }, [activeSource]);

  // Persist + apply theme
  useEffect(() => {
    const saved = localStorage.getItem("lo_theme") as "light" | "dark" | null;
    if (saved) setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("lo_theme", theme);
  }, [theme]);

  // Bootstrap: load existing reels + check session
  useEffect(() => {
    fetchStatus().then((s) => setSessionExists(s.session_exists));
    fetchReels().then((r) => { if (r.length > 0) setReels(r); });

    const stored = loadStoredSources();
    setConfiguredSources(stored);
    if (stored.length > 0) setActiveSource(stored[0].name);

    const configured =
      stored.length > 0 || localStorage.getItem("lo_sources_configured");
    if (!configured) setShowOnboarding(true);
  }, []);

  const addLog = useCallback((text: string, kind?: "info" | "success" | "error" | "reel") => {
    const lineKind = kind ?? classifyLine(text);
    const gid = activeGroupIdRef.current;
    if (gid !== null) {
      setLogs((prev) =>
        prev.map((item) =>
          item.type === "group" && item.id === gid
            ? { ...item, lines: [...item.lines, { id: nextId(), text, kind: lineKind }] }
            : item
        )
      );
    } else {
      setLogs((prev) => [...prev, { type: "line", id: nextId(), text, kind: lineKind }]);
    }
  }, []);

  const startGroup = useCallback((label: string) => {
    const id = nextId();
    activeGroupIdRef.current = id;
    setLogs((prev) => [
      ...prev,
      { type: "group", id, label, lines: [], done: false },
    ]);
  }, []);

  const endGroup = useCallback((success?: boolean) => {
    const gid = activeGroupIdRef.current;
    if (gid === null) return;
    activeGroupIdRef.current = null;
    setLogs((prev) =>
      prev.map((item) =>
        item.type === "group" && item.id === gid
          ? { ...item, done: true, success, error: success === false }
          : item
      )
    );
  }, []);

  function connectJob(jobId: string, jobStatus: Status) {
    socketRef.current?.close();
    const ws = openJobSocket(jobId);
    socketRef.current = ws;
    setStatus(jobStatus);

    ws.onmessage = (ev) => {
      const event: WsEvent = JSON.parse(ev.data);

      switch (event.type) {
        case "log_group_start":
          startGroup(event.label ?? "Processing…");
          break;

        case "log_group_end":
          endGroup(event.success !== false);
          break;

        case "transcription_start":
          setTranscriptionProgress({ current: 0, total: event.total ?? 0 });
          break;

        case "transcription_progress":
          setTranscriptionProgress({ current: event.current ?? 0, total: event.total ?? 0 });
          break;

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
              prev.map((r) =>
                r.url === event.url ? { ...r, caption: event.caption! } : r
              )
            );
          }
          break;

        case "transcript_update":
          if (event.id && event.transcript !== undefined) {
            const id = event.id;
            setReels((prev) =>
              prev.map((r) => {
                const rid = new URL(r.url).pathname
                  .split("/")
                  .filter(Boolean)
                  .pop();
                if (rid === id) {
                  setTranscribingUrls((s) => { const n = new Set(s); n.delete(r.url); return n; });
                  return { ...r, transcript: event.transcript };
                }
                return r;
              })
            );
          }
          break;

        case "reel_update":
          if (event.url && event.media) {
            setReels((prev) =>
              prev.map((r) => r.url === event.url ? { ...r, ...event.media } as Reel : r)
            );
          }
          break;

        case "done":
          addLog(`✓ Done — ${event.count ?? 0} items`, "success");
          setStatus("idle");
          setSessionExists(true);
          setTranscribingUrls(new Set());
          if (jobStatus === "scraping" || jobStatus === "downloading") {
            fetchReels().then((r) => { if (r.length > 0) setReels(r); });
          }
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

    ws.onclose = () => {
      if (status !== "idle") setStatus("idle");
    };
  }

  async function handleRelogin() {
    await clearSession();
    setSessionExists(false);
    addLog("Session cleared — login window will open on next scrape.");
  }

  async function handleScrape(sources: Source[], downloadMedia = false) {
    setReels([]);  // clear so only this run's reels appear
    addLog(
      `Starting scrape (${sources.length} source${sources.length > 1 ? "s" : ""}${downloadMedia ? " + media download" : ""})…`
    );
    const res = await startScrape(sources, downloadMedia);
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "scraping");
  }

  async function handleCaptions() {
    addLog("Fetching captions for all reels…");
    const res = await startCaptions();
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "captions");
  }

  async function handleTranscripts() {
    setTranscriptionProgress({ current: 0, total: 0 });
    addLog("Starting audio transcript pipeline…");
    const res = await startTranscripts();
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "transcripts");
  }

  async function handleCaptionRefetch(url: string) {
    addLog(`Re-fetching caption for ${url.slice(0, 50)}…`);
    const res = await refetchCaption(url);
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "captions");
  }

  async function handleTranscriptRefetch(url: string) {
    setTranscriptionProgress({ current: 0, total: 0 });
    setTranscribingUrls((prev) => new Set([...prev, url]));
    addLog(`Generating transcript for ${url.slice(0, 50)}…`);
    const res = await refetchTranscript(url);
    if (res.error) {
      addLog(`✗ ${res.error}`, "error");
      setTranscribingUrls((prev) => { const s = new Set(prev); s.delete(url); return s; });
      return;
    }
    connectJob(res.job_id!, "transcripts");
  }

  function handleMediaReady(
    url: string,
    result: { video_path?: string; image_paths?: string[] }
  ) {
    setReels((prev) =>
      prev.map((r) => (r.url === url ? { ...r, ...result } : r))
    );
    setVideoModal((prev) =>
      prev && prev.url === url ? { ...prev, ...result } : prev
    );
  }

  function handleOnboardingStart(sources: Source[], downloadMedia: boolean) {
    // Build StoredSource[] — auto-generate names for entries that left them blank
    const dmSources = sources.filter((s) => s.type === "dm");
    const n = dmSources.length;
    let dmIdx = 0;
    const stored: StoredSource[] = sources.map((s) => {
      if (s.type === "dm") {
        const defaultName = n === 1 ? "DM" : `DM ${dmIdx + 1}`;
        dmIdx++;
        return { ...s, name: s.name?.trim() || defaultName } as StoredSource;
      } else {
        return { ...s, name: s.name?.trim() || "Saved" } as StoredSource;
      }
    });
    setConfiguredSources(stored);
    saveStoredSources(stored);
    localStorage.setItem("lo_sources_configured", "1");
    setShowOnboarding(false);
    handleScrape(sources, downloadMedia);
  }

  function handleAddSource(source: StoredSource, downloadMedia: boolean) {
    setConfiguredSources((prev) => {
      const updated = [...prev, source];
      saveStoredSources(updated);
      return updated;
    });
    setActiveSource(source.name);
    setShowAddSource(false);
    handleScrape([source], downloadMedia);
  }

  async function handleRescrapeSource(name: string, downloadMedia = false) {
    const source = configuredSources.find((s) => s.name === name);
    if (!source) return;
    setReels((prev) => prev.filter((r) => r.source_label !== name));
    addLog(`Re-scraping ${name}…`);
    const res = await startScrape([{ ...source, fresh: true }], downloadMedia);
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "scraping");
  }

  async function handleDownloadAllMedia(name: string) {
    addLog(`Downloading all media for ${name}…`);
    const res = await startDownloadAll(name);
    if (res.error) { addLog(`✗ ${res.error}`, "error"); return; }
    connectJob(res.job_id!, "downloading");
  }

  function handleRemoveSource(name: string) {
    setConfiguredSources((prev) => {
      const updated = prev.filter((s) => s.name !== name);
      saveStoredSources(updated);
      if (activeSource === name) setActiveSource(updated[0]?.name ?? "");
      return updated;
    });
  }

  const innerClass = fullWidth
    ? "flex flex-col flex-1 overflow-hidden px-6 pt-5 min-h-0"
    : "flex flex-col flex-1 overflow-hidden max-w-[1100px] w-full mx-auto px-6 pt-5 min-h-0";

  return (
    <div className="h-screen flex flex-col overflow-hidden text-primary">
      <SkyBackground theme={theme} />

      <TopBar
        theme={theme}
        onThemeToggle={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        fullWidth={fullWidth}
      />

      <main className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className={innerClass}>
          {/* Export row */}
          <div className="flex items-center justify-between gap-2 mb-4 flex-shrink-0">
            <StatsBar reels={filteredReels} />
            <div className="flex items-center gap-2 flex-shrink-0">
              <a
                href={`${API_BASE}/api/export/json`}
                download="reels.json"
                className={`text-xs text-muted hover:text-primary border border-border/70 bg-surface/60 hover:bg-surface/90 rounded-lg px-3 py-1.5 transition-colors backdrop-blur-sm ${
                  reels.length === 0 ? "opacity-40 pointer-events-none" : ""
                }`}
              >
                ↓ Export data (JSON)
              </a>
              <a
                href={`${API_BASE}/api/export/links`}
                download="reel_links.txt"
                className={`text-xs text-muted hover:text-primary border border-border/70 bg-surface/60 hover:bg-surface/90 rounded-lg px-3 py-1.5 transition-colors backdrop-blur-sm ${
                  reels.length === 0 ? "opacity-40 pointer-events-none" : ""
                }`}
              >
                ↓ Export URL list
              </a>
              <button
                onClick={() => setFullWidth((f) => !f)}
                className="text-xs text-muted hover:text-primary border border-border/70 bg-surface/60 hover:bg-surface/90 rounded-lg px-3 py-1.5 transition-colors backdrop-blur-sm"
                title={fullWidth ? "Switch to focused layout" : "Switch to wide layout"}
              >
                {fullWidth ? "⊡ Focused view" : "⤢ Wide view"}
              </button>
            </div>
          </div>

          <div className="glass-surface rounded-2xl overflow-hidden shadow-panel flex flex-col flex-1 min-h-0 mb-5">
            {configuredSources.length > 0 && (
              <SourceTabs
                sources={configuredSources}
                activeSource={activeSource}
                onSelect={setActiveSource}
                onRescrape={(name) => setRescrapeTarget(name)}
                onDownloadMedia={handleDownloadAllMedia}
                onCaptions={() => handleCaptions()}
                onTranscripts={() => handleTranscripts()}
                onRemove={handleRemoveSource}
                onAdd={() => setShowAddSource(true)}
                reelCounts={reelCounts}
                search={search}
                onSearchChange={setSearch}
              />
            )}
            <ReelsTable
              reels={filteredReels}
              status={status}
              search={search}
              transcribingUrls={transcribingUrls}
              onCaptionFetch={handleCaptionRefetch}
              onTranscriptFetch={handleTranscriptRefetch}
              onOpen={setVideoModal}
            />
          </div>
        </div>
      </main>

      {/* Floating activity log */}
      <ActivityLog lines={logs} isActive={isActive} />

      {/* Transcription progress bubble */}
      <TranscriptionBubble
        isActive={status === "transcripts"}
        current={transcriptionProgress.current}
        total={transcriptionProgress.total}
      />

      {/* Onboarding dialog */}
      {showOnboarding && (
        <OnboardingDialog
          onStart={handleOnboardingStart}
          onClose={() => setShowOnboarding(false)}
        />
      )}

      {/* Add source modal */}
      {showAddSource && (
        <AddSourceModal
          onAdd={handleAddSource}
          onClose={() => setShowAddSource(false)}
          savedExists={configuredSources.some((s) => s.type === "saved")}
        />
      )}

      {/* Re-scrape confirm dialog */}
      {rescrapeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setRescrapeTarget(null)}
          />
          <div className="relative bg-surface rounded-2xl shadow-modal w-full max-w-sm overflow-hidden">
            <div className="px-7 pt-7 pb-5 border-b border-border">
              <h2 className="font-serif text-xl text-primary font-semibold mb-1">Re-scrape {rescrapeTarget}</h2>
              <p className="text-muted text-sm">Would you also like to download the media files?</p>
            </div>
            <div className="px-7 py-5 flex flex-col gap-3">
              <button
                className="w-full py-2.5 rounded-xl bg-accent text-white font-medium text-sm hover:bg-accent/90 transition-colors"
                onClick={() => { const t = rescrapeTarget; setRescrapeTarget(null); handleRescrapeSource(t, true); }}
              >
                Re-scrape + Download media
              </button>
              <button
                className="w-full py-2.5 rounded-xl bg-black/10 text-primary font-medium text-sm hover:bg-black/15 transition-colors"
                onClick={() => { const t = rescrapeTarget; setRescrapeTarget(null); handleRescrapeSource(t, false); }}
              >
                Re-scrape only
              </button>
              <button
                className="w-full py-2 text-muted text-sm hover:text-primary transition-colors"
                onClick={() => setRescrapeTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reel modal */}
      {videoModal && (
        <VideoModal
          reel={videoModal}
          allReels={filteredReels}
          onClose={() => setVideoModal(null)}
          onMediaReady={handleMediaReady}
          onCaptionFetch={handleCaptionRefetch}
          onTranscriptFetch={handleTranscriptRefetch}
        />
      )}
    </div>
  );
}
