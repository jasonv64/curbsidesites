import "./globals.css";
import { fontVariableClasses } from "@/lib/fonts";

/**
 * Root layout: loads every curated font pairing's CSS variables (build-time,
 * Part 6) and nothing else. All tenant-specific markup — brand tokens,
 * metadata, header/footer — lives in src/app/s/[host]/layout.tsx.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fontVariableClasses} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
