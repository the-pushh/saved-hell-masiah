export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_BASE ?? "ws://localhost:8000";

export interface Reel {
  url: string;
  thumbnail: string;
  caption: string;
  sender: string;
  timestamp: string;
  transcript?: string;
}

export interface WsEvent {
  type:
    | "log"
    | "reel"
    | "caption_update"
    | "transcript_update"
    | "done"
    | "error";
  msg?: string;
  data?: Reel;
  url?: string;
  caption?: string;
  id?: string;
  transcript?: string;
  stage?: "scrape" | "captions" | "transcripts";
  count?: number;
}

export interface StatusResponse {
  session_exists: boolean;
  reels_count: number;
  current_job: string | null;
}

export async function fetchStatus(): Promise<StatusResponse> {
  const r = await fetch(`${API_BASE}/api/status`);
  return r.json();
}

export async function fetchReels(): Promise<Reel[]> {
  const r = await fetch(`${API_BASE}/api/reels`);
  return r.json();
}

export async function startScrape(threadUrl: string): Promise<{ job_id?: string; error?: string }> {
  const r = await fetch(`${API_BASE}/api/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_url: threadUrl }),
  });
  return r.json();
}

export async function startCaptions(): Promise<{ job_id?: string; error?: string }> {
  const r = await fetch(`${API_BASE}/api/enrich/captions`, { method: "POST" });
  return r.json();
}

export async function startTranscripts(): Promise<{ job_id?: string; error?: string }> {
  const r = await fetch(`${API_BASE}/api/enrich/transcripts`, { method: "POST" });
  return r.json();
}

export function openJobSocket(jobId: string): WebSocket {
  return new WebSocket(`${WS_BASE}/ws/${jobId}`);
}
