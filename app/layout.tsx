import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase:new URL("https://sift-evidence-agent.vercel.app"),
  alternates:{canonical:"/"},
  openGraph:{title:"Sift / Synthetic evidence demo",description:"Not a lending decision. Model and database connectivity require verification.",url:"https://sift-evidence-agent.vercel.app/",type:"website"},
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
