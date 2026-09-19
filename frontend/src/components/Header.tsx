"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-800 bg-ink-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white">DEEDS</span>
              <span className="ml-2 text-xs text-ink-500 font-mono hidden sm:inline">Milestone Escrow</span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link href="/" className="px-3 py-2 rounded-lg text-sm font-medium text-ink-300 hover:text-white hover:bg-ink-800">
              Marketplace
            </Link>
            <Link href="/create" className="px-3 py-2 rounded-lg text-sm font-medium text-ink-300 hover:text-white hover:bg-ink-800">
              Create Listing
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-ink-800 border border-ink-700">
              <div className="w-2 h-2 rounded-full bg-success-500 animate-pulse-subtle" />
              <span className="text-xs font-medium text-ink-300">Sepolia</span>
            </div>
            <ConnectButton showBalance={false} />
          </div>
        </div>
      </div>
    </header>
  );
}
