import type { Metadata, Viewport } from "next";
import { Manrope, Chakra_Petch, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";
import { ConfigWarning } from "@/components/ConfigWarning";
import { Toaster } from "@/components/Toaster";
import { ThemeProvider } from "@/lib/theme";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

// Page-title display face (see .font-display in globals.css).
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PLEDGON",
  description: "Marketplace, milestone escrow, and compliance-gated trades on Chainlink CRE",
};

// Lock the layout on mobile: no pinch-zoom / gesture scaling — the app is
// designed to fit phone and narrow fold-cover widths as-is.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // No hardcoded `dark` class here — ThemeProvider applies the resolved
  // theme (dark default, data-theme="light" for light) on mount so the
  // server render stays dark and there is no flash of the wrong theme.
  return (
    <html lang="en" className={`${manrope.variable} ${chakraPetch.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ink-950 text-ink-100">
        <Providers>
          <ThemeProvider>
            <ConfigWarning />
            <AppShell>{children}</AppShell>
            <Toaster />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
