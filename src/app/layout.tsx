import type { Metadata } from "next";
import { Rajdhani, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Matches nuscalibur.com's font pairing: Rajdhani (angular/technical) for
// display text, Space Grotesk for body copy.
const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Tele-QR Checkout",
  description: "Parts store checkout for the NUS RoboMaster club.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${rajdhani.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-full flex flex-col bg-neutral-950">{children}</body>
    </html>
  );
}
