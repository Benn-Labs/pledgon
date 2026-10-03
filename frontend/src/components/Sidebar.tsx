"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { escrowFactoryAbi } from "@/generated/contracts";
import { HomeIcon, MarketplaceIcon, EscrowIcon, LendingIcon, FaucetIcon, SwapIcon, AdminIcon } from "@/components/ui/icons";

const NAV = [
  { href: "/", label: "Dashboard", icon: HomeIcon },
  { href: "/marketplace", label: "Marketplace", icon: MarketplaceIcon },
  { href: "/escrow", label: "Escrow", icon: EscrowIcon },
  { href: "/lending", label: "Lending", icon: LendingIcon },
  { href: "/faucet", label: "Faucet", icon: FaucetIcon },
  { href: "/swap", label: "Swap", icon: SwapIcon },
];

function ChevronIcon({ className, flipped }: { className?: string; flipped: boolean }) {
  return (
    <svg
      className={`${className ?? ""} transition-transform duration-200 ${flipped ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

/**
 * Primary navigation. Desktop (lg+): a sticky rail that collapses to icons
 * only (labels appear as tooltips). Below lg it becomes an off-canvas drawer
 * opened from the top bar, and is always shown expanded.
 */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const { address: account } = useAccount();

  const { data: factoryOwner } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "owner",
    query: { enabled: Boolean(addresses.escrowFactory && account) },
  });
  const isOwner = Boolean(account && factoryOwner && account.toLowerCase() === factoryOwner.toLowerCase());
  const nav = isOwner ? [...NAV, { href: "/admin", label: "Admin", icon: AdminIcon }] : NAV;

  // `collapsed` only applies at lg+; the mobile drawer always shows labels.
  const labelClass = collapsed ? "lg:hidden" : "";

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-ink-800 bg-ink-950 transition-[width,transform] duration-200 ease-out
          lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shrink-0 lg:z-30
          ${collapsed ? "lg:w-[68px]" : "lg:w-60"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-16 shrink-0 items-center border-b border-ink-800 px-4 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <Link href="/" onClick={onCloseMobile} aria-label="PLEDGON home" className="flex items-center">
            {/* Wordmark when expanded (always, in the mobile drawer); icon-only in the collapsed rail. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed local brand asset */}
            <img src="/logo.png" alt="PLEDGON" width={167} height={32} className={`h-8 w-auto ${labelClass}`} />
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed local brand asset */}
            <img src="/logo-mark.png" alt="" width={40} height={32} className={`h-8 w-auto ${collapsed ? "hidden lg:block" : "hidden"}`} />
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-3" aria-label="Primary">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
            const disabled = href === "/lending" && !isLendingConfigured;
            return (
              <Link
                key={href}
                href={disabled ? "/lending" : href}
                onClick={onCloseMobile}
                title={collapsed ? label : undefined}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  collapsed ? "lg:justify-center lg:px-0" : ""
                } ${
                  active
                    ? "bg-ink-800 text-white"
                    : disabled
                      ? "text-ink-600"
                      : "text-ink-300 hover:bg-ink-900 hover:text-white"
                }`}
              >
                {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-trust-500" />}
                <Icon className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                <span className={`whitespace-nowrap ${labelClass}`}>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden shrink-0 border-t border-ink-800 p-3 lg:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-400 transition-colors hover:bg-ink-900 hover:text-white ${
              collapsed ? "justify-center px-0" : ""
            }`}
          >
            <ChevronIcon className="h-5 w-5 shrink-0" flipped={collapsed} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
