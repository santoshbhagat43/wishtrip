import type { Metadata } from "next";
import { Geist_Mono, Inter, Playfair_Display } from "next/font/google";

import { CreatorHeader } from "@/components/creator/creator-header";
import { Providers } from "@/components/providers";

import "./globals.css";

const display = Playfair_Display({ variable: "--font-display-serif", subsets: ["latin"], weight: ["500", "600"] });
const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WishTrip for creators",
  description: "Turn your travel reels into trips people book, and earn when they do.",
};

/** The creator site (creator.<domain>): its own app, header and pages, apart from the traveller website. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${ui.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>
          <div className="min-h-dvh bg-bg">
            <CreatorHeader />
            <main className="px-4 py-8 sm:px-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
