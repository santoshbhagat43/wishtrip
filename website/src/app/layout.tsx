import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans, Spectral } from "next/font/google";

import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const display = Spectral({ variable: "--font-display-serif", subsets: ["latin"], weight: ["600"] });
const ui = Plus_Jakarta_Sans({ variable: "--font-ui", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WishTrip — Travel your way",
  description: "See it. Make it yours. Plan trips built around you, from knowledge we've checked.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${ui.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>
          <SiteHeader />
          <main className="min-h-[calc(100dvh-8rem)]">{children}</main>
          <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted">
            WishTrip · Experiences, made for you. <span className="mx-1">·</span> MVP preview — prices and booking aren&apos;t live yet.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
