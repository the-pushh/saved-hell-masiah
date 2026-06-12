"use client";

import { useState } from "react";
import type { Source } from "@/lib/api";

interface Props {
  onStart: (sources: Source[], downloadMedia: boolean) => void;
  onClose: () => void;
}

export default function OnboardingDialog({ onStart, onClose }: Props) {
  const [dmEnabled, setDmEnabled] = useState(true);
  const [dmEntries, setDmEntries] = useState<{ url: string; name: string }[]>([
    { url: "", name: "" },
  ]);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [savedUsername, setSavedUsername] = useState("");
  const [savedName, setSavedName] = useState("");
  const [downloadMedia, setDownloadMedia] = useState(false);

  function addDmEntry() {
    setDmEntries((prev) => [...prev, { url: "", name: "" }]);
  }

  function removeDmEntry(i: number) {
    setDmEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateDmEntry(i: number, field: "url" | "name", val: string) {
    setDmEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e))
    );
  }

  function handleStart() {
    const sources: Source[] = [];
    if (dmEnabled) {
      const validDm = dmEntries.filter((e) => e.url.trim());
      const n = validDm.length;
      validDm.forEach((entry, idx) => {
        const defaultName = n === 1 ? "DM" : `DM ${idx + 1}`;
        sources.push({
          type: "dm",
          url: entry.url.trim(),
          name: entry.name.trim() || defaultName,
        });
      });
    }
    if (savedEnabled && savedUsername.trim()) {
      sources.push({
        type: "saved",
        username: savedUsername.trim().replace(/^@/, ""),
        name: savedName.trim() || "Saved",
      });
    }
    if (sources.length === 0) return;
    onStart(sources, downloadMedia);
  }

  const canStart =
    (dmEnabled && dmEntries.some((e) => e.url.trim())) ||
    (savedEnabled && savedUsername.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative bg-surface rounded-2xl shadow-modal w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-border flex-shrink-0">
          <h1 className="font-serif text-2xl text-primary font-semibold mb-1">
            Choose your sources
          </h1>
          <p className="text-muted text-sm">
            Select where to pull your saved reels from
          </p>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-6 overflow-y-auto">
          {/* DMs */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={dmEnabled} onChange={setDmEnabled} />
              <span className="text-primary font-medium">Instagram DMs</span>
              <span className="text-xs text-muted">reels shared with you</span>
            </label>

            {dmEnabled && (
              <div className="ml-7 space-y-3">
                {dmEntries.map((entry, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={entry.url}
                        onChange={(e) => updateDmEntry(i, "url", e.target.value)}
                        placeholder="https://www.instagram.com/direct/t/…"
                        className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted-2 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
                      />
                      {dmEntries.length > 1 && (
                        <button
                          onClick={() => removeDmEntry(i)}
                          className="w-9 h-9 flex-shrink-0 flex items-center justify-center text-muted hover:text-error rounded-lg hover:bg-surface-2 transition-colors"
                          aria-label="Remove URL"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={entry.name}
                      onChange={(e) => updateDmEntry(i, "name", e.target.value)}
                      placeholder="Tab name (optional — e.g. Work, Friends…)"
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs text-muted placeholder-muted-2 focus:outline-none focus:border-accent/60 transition-colors"
                    />
                  </div>
                ))}
                <button
                  onClick={addDmEntry}
                  className="text-xs text-accent hover:text-accent-dim transition-colors flex items-center gap-1"
                >
                  <span>+</span> Add another thread
                </button>
              </div>
            )}
          </div>

          {/* Saved posts */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={savedEnabled} onChange={setSavedEnabled} />
              <span className="text-primary font-medium">Saved Posts</span>
              <span className="text-xs text-muted">reels you saved on Instagram</span>
            </label>

            {savedEnabled && (
              <div className="ml-7 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted text-sm flex-shrink-0">@</span>
                  <input
                    type="text"
                    value={savedUsername}
                    onChange={(e) => setSavedUsername(e.target.value)}
                    placeholder="your_username"
                    className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted-2 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
                  />
                </div>
                <input
                  type="text"
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                  placeholder="Tab name (optional — e.g. Saved Reels…)"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs text-muted placeholder-muted-2 focus:outline-none focus:border-accent/60 transition-colors"
                />
              </div>
            )}
          </div>
          {/* Download media option */}
          <div className="pt-2 border-t border-border">
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox checked={downloadMedia} onChange={setDownloadMedia} />
              <div>
                <span className="text-primary text-sm font-medium">Download media</span>
                <span className="text-muted text-xs ml-2">slower — videos &amp; images saved locally</span>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 flex items-center justify-between gap-4 flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-6 py-2.5 transition-colors"
          >
            Go offline
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 7h10M8 3l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
        checked
          ? "bg-accent border-accent"
          : "border-border hover:border-accent/60"
      }`}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path
            d="M1 4l3 3 5-6"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
