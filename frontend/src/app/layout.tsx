import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { ConfigWarning } from "@/components/ConfigWarning";
import { Toaster } from "@/components/Toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ink-950 text-ink-100">
        <Providers>
          <ConfigWarning />
          <Header />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
          <footer className="border-t border-ink-800 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-sm text-ink-500 flex items-center gap-2">
              <span>PLEDGON Protocol</span>
              <span className="text-ink-700">·</span>
              <span className="font-mono text-xs">Sepolia testnet</span>
            </div>
          </footer>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
