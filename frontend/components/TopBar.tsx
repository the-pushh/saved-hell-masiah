"use client";

interface Props {
  theme: "light" | "dark";
  onThemeToggle: () => void;
  fullWidth: boolean;
}

export default function TopBar({ theme, onThemeToggle, fullWidth }: Props) {
  const inner = fullWidth
    ? "flex items-center justify-between h-14 px-6"
    : "flex items-center justify-between h-14 px-6 max-w-[1100px] mx-auto";

  return (
    <header className="sticky top-0 z-40 glass border-b border-border/50 flex-shrink-0">
      <div className={inner}>
        <span className="font-serif text-xl font-semibold text-primary tracking-tight">
          LifeOffline
        </span>

        <button
          onClick={onThemeToggle}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/10 text-muted hover:text-primary transition-colors"
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M7.5 1v1m0 11v1M1 7.5h1m11 0h1M3.2 3.2l.7.7m7.2 7.2.7.7M3.2 11.8l.7-.7m7.2-7.2.7-.7M7.5 5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"
                stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M2.9 10.6A6 6 0 009.5 3c.3 0 .6 0 .9.05A6 6 0 112.9 10.6z"
                stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
