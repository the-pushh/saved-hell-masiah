"use client";

import { useState } from "react";
import type { StoredSource } from "@/lib/api";

interface Props {
  onAdd: (source: StoredSource, downloadMedia: boolean) => void;
  onClose: () => void;
  savedExists?: boolean;
}

export default function AddSourceModal({ onAdd, onClose, savedExists = false }: Props) {
  const [type, setType] = useState<"dm" | "saved">("dm");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [downloadMedia, setDownloadMedia] = useState(false);

  function handleAdd() {
    const trimmedName = name.trim();
    if (type === "dm") {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) return;
      onAdd({ type: "dm", url: trimmedUrl, name: trimmedName || "DM" }, downloadMedia);
    } else {
      const trimmedUser = username.trim().replace(/^@/, "");
      if (!trimmedUser) return;
      onAdd({ type: "saved", username: trimmedUser, name: trimmedName || "Saved" }, downloadMedia);
    }
  }

  const canAdd = type === "dm" ? url.trim() !== "" : username.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-surface rounded-2xl shadow-modal w-full max-w-md overflow-hidden">
        <div className="px-7 pt-7 pb-5 border-b border-border">
          <h2 className="font-serif text-xl text-primary font-semibold mb-1">
            Add source
          </h2>
          <p className="text-muted text-sm">Choose a new source to scrape and add as a tab</p>
        </div>

        <div className="px-7 py-5 space-y-5">
          {/* Type cards */}
          <div className="grid grid-cols-2 gap-3">
            <TypeCard
              active={type === "dm"}
              icon="›"
              title="DM Thread"
              desc="Reels shared with you"
              onClick={() => setType("dm")}
            />
            <TypeCard
              active={type === "saved"}
              icon="◈"
              title="Saved Posts"
              desc="Reels you've saved"
              onClick={() => !savedExists && setType("saved")}
              disabled={savedExists}
              disabledReason="Already exists"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-muted mb-1.5">
              Tab name{" "}
              <span className="text-muted-2">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "dm" ? "e.g. Work, Friends…" : "e.g. My Saved…"}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted-2 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
            />
          </div>

          {/* URL or username */}
          {type === "dm" ? (
            <div>
              <label className="block text-xs text-muted mb-1.5">Thread URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.instagram.com/direct/t/…"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted-2 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
                onKeyDown={(e) => e.key === "Enter" && canAdd && handleAdd()}
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs text-muted mb-1.5">
                Instagram username
              </label>
              <div className="flex items-center gap-2">
                <span className="text-muted text-sm flex-shrink-0">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username"
                  className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-muted-2 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && canAdd && handleAdd()}
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-7 pb-4 border-t border-border">
          <label className="flex items-center gap-3 cursor-pointer pt-4">
            <Checkbox checked={downloadMedia} onChange={setDownloadMedia} />
            <div>
              <span className="text-primary text-sm font-medium">Download media</span>
              <span className="text-muted text-xs ml-2">slower — videos &amp; images saved locally</span>
            </div>
          </label>
        </div>

        <div className="px-7 pb-7 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-5 py-2.5 transition-colors"
          >
            Scrape &amp; add
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
        checked ? "bg-accent border-accent" : "border-border hover:border-accent/60"
      }`}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function TypeCard({
  active,
  icon,
  title,
  desc,
  onClick,
  disabled,
  disabledReason,
}: {
  active: boolean;
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative text-left p-4 rounded-xl border-2 transition-colors ${
        disabled
          ? "border-border bg-surface-2 opacity-50 cursor-not-allowed"
          : active
          ? "border-accent bg-accent-light"
          : "border-border hover:border-border-2 bg-surface-2"
      }`}
    >
      {disabled && disabledReason && (
        <span className="absolute top-2 right-2 text-[10px] font-medium text-muted bg-surface border border-border rounded px-1.5 py-0.5">
          {disabledReason}
        </span>
      )}
      <div className={`text-lg mb-2 ${active && !disabled ? "text-accent" : "text-muted"}`}>
        {icon}
      </div>
      <div className={`text-sm font-medium mb-0.5 ${active && !disabled ? "text-accent" : "text-primary"}`}>
        {title}
      </div>
      <div className="text-xs text-muted">{desc}</div>
    </button>
  );
}
