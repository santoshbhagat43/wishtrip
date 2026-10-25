import type { Metadata } from "next";
import { Geist_Mono, Inter, Playfair_Display } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

// Brand type (the B4 prototype): Playfair Display for display, Inter for everything functional.
const display = Playfair_Display({ variable: "--font-display-serif", subsets: ["latin"], weight: ["500", "600"] });
const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
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
