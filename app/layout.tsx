import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shared AI Room",
  description: "One AI, one context, the whole group.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
