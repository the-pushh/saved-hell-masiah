import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0a0a0a",
        surface: "#111111",
        "surface-2": "#161616",
        border: "#1e1e1e",
        "border-2": "#2a2a2a",
        muted: "#666666",
        "muted-2": "#888888",
        primary: "#ededed",
        accent: "#6366f1",
        "accent-dim": "#4f51c7",
        success: "#22c55e",
        error: "#ef4444",
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'Geist Mono'", "'JetBrains Mono'", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
