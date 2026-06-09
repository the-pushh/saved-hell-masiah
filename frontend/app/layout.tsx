import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IG DM Scraper",
  description: "Instagram DM reel scraper — local only",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
