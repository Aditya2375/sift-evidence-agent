import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sift - the evidence agent for credit teams",
  description: "Ask why. Get an investigation with receipts, not a vibe.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
