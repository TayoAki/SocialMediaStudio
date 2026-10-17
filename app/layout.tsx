import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Social Agent Studio", description: "Researched drafts, exact-version approval, confirmed publication." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
