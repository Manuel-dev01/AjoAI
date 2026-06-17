import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "./providers";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
});
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ajo-ai-tan.vercel.app"),
  title: "AjoAI | Save like your village always has",
  description:
    "A rotating savings circle (ajo/esusu/chama/stokvel) run by an autonomous agent, inside MiniPay on Celo.",
  // Browser-tab + home-screen icon = the RingMark (Circle & Baton). SVG for crisp tabs, PNG fallback.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
  // TalentApp project verification tag (renders <meta name="talentapp:project_verification" ...> in <head>).
  other: {
    "talentapp:project_verification":
      "f494d1c89e807c883285116ac619e4721a2a6be8229c1b352d2981673ea1b9da23c0b7585634146151b3b809af0a9e65407a20b60cfc521c225ca030a5806d8d",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#15694E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
