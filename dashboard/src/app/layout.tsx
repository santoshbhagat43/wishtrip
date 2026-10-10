import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans, Spectral } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

// Brand type: Spectral for display/headings, Plus Jakarta Sans for everything functional.
const display = Spectral({ variable: "--font-display-serif", subsets: ["latin"], weight: ["600"] });
const ui = Plus_Jakarta_Sans({ variable: "--font-ui", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WishTrip Dashboard",
  description: "Knowledge management for WishTrip",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${ui.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
