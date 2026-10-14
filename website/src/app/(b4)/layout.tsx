import { Inter, Playfair_Display } from "next/font/google";

import "./b4.css";

// The B4 design's type: Playfair Display for headlines, Inter for everything else.
const display = Playfair_Display({
  variable: "--font-b4-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});
const body = Inter({ variable: "--font-b4-body", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

/** Pages in the B4 design bring their own header and footer. */
export default function B4Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={`b4 ${display.variable} ${body.variable}`}>{children}</div>;
}
