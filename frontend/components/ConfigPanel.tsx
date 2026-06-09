"use client";

interface Props {
  threadUrl: string;
  onThreadUrlChange: (v: string) => void;
  onScrape: () => void;
  onCaptions: () => void;
  onTranscripts: () => void;
  reelsCount: number;
  captionsCount: number;
  status: "idle" | "scraping" | "captions" | "transcripts";
  sessionExists: boolean;
}

export default function ConfigPanel({
  threadUrl,
  onThreadUrlChange,
  onScrape,
  onCaptions,
  onTranscripts,
  reelsCount,
  captionsCount,
  status,
  sessionExists,
}: Props) {
  const busy = status !== "idle";

  return (
    <aside className="w-60 flex-shrink-0 border-r border-border flex flex-col">
      {/* Logo / title */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-base">📲</span>
          <span className="text-primary font-semibold text-sm tracking-tight">
            IG DM Scraper
          </span>
        </div>
        <p className="text-muted text-xs mt-1">local · personal · private</p>
      </div>

      {/* Session status */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              sessionExists ? "bg-success" : "bg-warn"
            }`}
          />
          <span className="text-muted-2 text-xs">
            {sessionExists ? "Session active" : "No session — login on first scrape"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* Thread URL */}
        <section>
          <label className="block text-muted text-xs font-medium mb-2 uppercase tracking-wider">
            Thread URL
          </label>
          <input
            type="url"
            value={threadUrl}
            onChange={(e) => onThreadUrlChange(e.target.value)}
            placeholder="https://www.instagram.com/direct/t/…"
            className="w-full bg-surface border border-border rounded px-3 py-2 text-xs text-primary placeholder-muted focus:outline-none focus:border-border-2 focus:ring-1 focus:ring-accent/30 transition-colors"
            disabled={busy}
          />
        </section>

        {/* Scrape */}
        <section>
          <label className="block text-muted text-xs font-medium mb-2 uppercase tracking-wider">
            Scrape
          </label>
          <button
            onClick={onScrape}
            disabled={busy || !threadUrl.trim()}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded px-3 py-2 transition-colors"
          >
            {status === "scraping" ? (
              <>
                <Spinner /> Scraping…
              </>
            ) : (
              "▶ Scrape DM Thread"
            )}
          </button>
        </section>

        {/* Enrich */}
        <section>
          <label className="block text-muted text-xs font-medium mb-2 uppercase tracking-wider">
            Enrich
          </label>
          <div className="space-y-2">
            <button
              onClick={onCaptions}
              disabled={busy || reelsCount === 0}
              className="w-full flex items-center justify-center gap-2 bg-surface-2 hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-primary text-xs font-medium rounded px-3 py-2 border border-border transition-colors"
            >
              {status === "captions" ? (
                <><Spinner /> Fetching captions…</>
              ) : (
                `Captions${reelsCount > 0 ? ` (${reelsCount})` : ""}`
              )}
            </button>
            <button
              onClick={onTranscripts}
              disabled={busy || captionsCount === 0}
              className="w-full flex items-center justify-center gap-2 bg-surface-2 hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed text-primary text-xs font-medium rounded px-3 py-2 border border-border transition-colors"
            >
              {status === "transcripts" ? (
                <><Spinner /> Transcribing…</>
              ) : (
                "Transcribe Audio"
              )}
            </button>
          </div>
          <p className="text-muted/50 text-xs mt-2">
            Captions also auto-run after each scrape
          </p>
        </section>

        {/* Export */}
        <section>
          <label className="block text-muted text-xs font-medium mb-2 uppercase tracking-wider">
            Export
          </label>
          <div className="space-y-2">
            <a
              href="http://localhost:8000/api/export/json"
              download="reels.json"
              className={`w-full flex items-center justify-center gap-2 text-xs text-muted-2 hover:text-primary border border-border rounded px-3 py-2 transition-colors ${
                reelsCount === 0 ? "opacity-40 pointer-events-none" : ""
              }`}
            >
              ↓ reels.json
            </a>
            <a
              href="http://localhost:8000/api/export/links"
              download="reel_links.txt"
              className={`w-full flex items-center justify-center gap-2 text-xs text-muted-2 hover:text-primary border border-border rounded px-3 py-2 transition-colors ${
                reelsCount === 0 ? "opacity-40 pointer-events-none" : ""
              }`}
            >
              ↓ reel_links.txt
            </a>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-muted text-xs">v1 · DM reels only</p>
      </div>
    </aside>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-3 h-3"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
