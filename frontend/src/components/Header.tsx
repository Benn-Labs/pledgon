"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { isLendingConfigured } from "@/lib/addresses";
import { HomeIcon, MarketplaceIcon, EscrowIcon, LendingIcon } from "@/components/ui/icons";
import { HeaderComplianceStatus } from "@/components/HeaderComplianceStatus";

const NAV = [
  { href: "/", label: "Dashboard", icon: HomeIcon },
  { href: "/marketplace", label: "Marketplace", icon: MarketplaceIcon },
  { href: "/escrow", label: "Escrow", icon: EscrowIcon },
  { href: "/lending", label: "Lending", icon: LendingIcon },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-ink-800 bg-ink-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-white hidden sm:inline">DEEDS</span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
              const disabled = href === "/lending" && !isLendingConfigured;
              return (
                <Link
                  key={href}
                  href={disabled ? "/lending" : href}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                    active
                      ? "bg-ink-800 text-white"
                      : disabled
                        ? "text-ink-600"
                        : "text-ink-300 hover:text-white hover:bg-ink-800"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden md:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <HeaderComplianceStatus />
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
