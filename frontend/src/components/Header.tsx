"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useChainId } from "wagmi";
import { mainnet, sepolia, holesky, goerli } from "wagmi/chains";
import { HeaderComplianceStatus } from "@/components/HeaderComplianceStatus";
import { NotificationBell } from "@/components/NotificationBell";

const TESTNET_NAMES: Record<number, string> = {
  [sepolia.id]: "Sepolia",
  [holesky.id]: "Holesky",
  [goerli.id]: "Goerli",
};

/** Slim top bar: navigation lives in the Sidebar, so this only carries the
 * mobile menu button (with the logo, since the drawer is closed) and wallet /
 * network / compliance status. */
export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const chainId = useChainId();
  const isMainnet = chainId === mainnet.id;
  const networkLabel = isMainnet ? "Ethereum" : (TESTNET_NAMES[chainId] ?? `Chain ${chainId}`);

  return (
    <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <Link href="/" aria-label="PLEDGON home" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed local brand asset */}
            <img src="/logo-mark.png" alt="" width={21} height={24} className="h-6 w-auto" />
            <span className="font-display text-white text-lg leading-none">PLEDGON</span>
          </Link>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <NotificationBell />
          <HeaderComplianceStatus />
          {/* Mainnet gets a trusted-green badge; testnets render in amber so a
              leftover testnet config can never masquerade as the live chain. */}
          <div
            className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              isMainnet ? "bg-success-500/10 border-success-500/40" : "bg-warning-500/10 border-warning-500/40"
            }`}
          >
            <div className={`w-2 h-2 rounded-full animate-pulse-subtle ${isMainnet ? "bg-success-400" : "bg-warning-400"}`} />
            <span className={`text-xs font-semibold ${isMainnet ? "text-success-400" : "text-warning-400"}`}>{networkLabel}</span>
          </div>
          <ConnectButton showBalance={false} />
        </div>
      </div>
    </header>
  );
}
