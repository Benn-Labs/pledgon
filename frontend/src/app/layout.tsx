import type { Metadata } from "next";
import { Manrope, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";
import { ConfigWarning } from "@/components/ConfigWarning";
import { Toaster } from "@/components/Toaster";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["italic"],
  weight: ["500"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PLEDGON",
  description: "Marketplace, milestone escrow, and compliance-gated trades on Chainlink CRE",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${manrope.variable} ${fraunces.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ink-950 text-ink-100">
        <Providers>
          <ConfigWarning />
          <AppShell>{children}</AppShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
