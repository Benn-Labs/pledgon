"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

const STORAGE_KEY = "pledgon.sidebar.collapsed";

// Footer network label — the protocol is deployed on Sepolia only right now,
// so the footer always says Sepolia rather than mirroring the wallet's chain.
const FOOTER_NETWORK_LABEL = "Sepolia testnet";

const listeners = new Set<() => void>();

function subscribeCollapsed(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

function readCollapsed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // storage blocked/empty — default expanded
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Persisted preference read via an external-store subscription so server
  // and first client render agree (server snapshot = expanded).
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // The drawer is "open" only for the route it was opened on, so navigating
  // closes it without a setState-in-effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const mobileOpen = openedOn !== null && openedOn === pathname;

  const toggleCollapsed = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, readCollapsed() ? "0" : "1");
    } catch {}
    listeners.forEach((cb) => cb());
  }, []);

  return (
    <div className="flex flex-1">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setOpenedOn(null)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMenu={() => setOpenedOn(pathname)} />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
        <footer className="border-t border-ink-800 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-sm text-ink-500 flex items-center gap-2">
            <span>PLEDGON Protocol</span>
            <span className="text-ink-700">·</span>
            <span className="font-mono text-xs">{FOOTER_NETWORK_LABEL}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
