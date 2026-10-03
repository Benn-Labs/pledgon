"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useRecentTrades } from "@/hooks/useRecentTrades";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { getActivitySeenAt, markActivitySeen, subscribeActivitySeen, type ActivityTone } from "@/lib/activityFeed";
import { useNow, formatRelativeTime } from "@/lib/countdown";
import { BellIcon } from "@/components/ui/icons";

const DOT: Record<ActivityTone, string> = {
  info: "bg-trust-400",
  success: "bg-success-400",
  warning: "bg-warning-400",
  danger: "bg-danger-400",
};

/**
 * Header notification bell. Same local-only "what changed since you were last
 * here" feed the dashboard used to show (see lib/activityFeed.ts), now
 * available on every page: the badge counts entries newer than the last time
 * the dropdown was opened, and the bell rings while any are unread.
 */
export function NotificationBell() {
  const { address: account, isConnected } = useAccount();
  const { trades, isLoading } = useRecentTrades(10);
  const feed = useActivityFeed(trades, isLoading);
  const now = useNow(60_000);

  const seenAt = useSyncExternalStore(
    subscribeActivitySeen,
    () => (account ? getActivitySeenAt(account) : 0),
    () => 0,
  );
  const unread = feed.filter((e) => e.at > seenAt).length;

  const [open, setOpen] = useState(false);
  // Frozen at open so the entries that were new stay highlighted while the
  // dropdown is showing, even though opening it marks them read.
  const [highlightAfter, setHighlightAfter] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open) {
      setHighlightAfter(seenAt);
      if (account) markActivitySeen(account);
    }
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isConnected || !account) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-ink-800 ${
          open ? "bg-ink-800 text-white" : "text-ink-300 hover:text-white"
        }`}
      >
        <BellIcon className={`h-5 w-5 ${unread > 0 ? "bell-ring text-white" : ""}`} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-ink-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fade-in absolute right-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-ink-800 bg-ink-900 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
            {feed.length > 0 && <span className="text-xs text-ink-500">{feed.length} recent</span>}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-3 p-4">
                <div className="h-4 animate-pulse rounded bg-ink-800" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-ink-800" />
              </div>
            ) : feed.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-400">Nothing new since your last visit.</p>
            ) : (
              <ul className="divide-y divide-ink-800">
                {feed.map((entry) => {
                  const isNew = entry.at > highlightAfter;
                  return (
                    <li key={entry.id}>
                      <Link
                        href={`/escrow/${entry.vault}`}
                        onClick={() => setOpen(false)}
                        className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ink-800 ${isNew ? "bg-trust-500/5" : ""}`}
                      >
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[entry.tone]}`} />
                        <p className={`min-w-0 flex-1 text-sm group-hover:text-white ${isNew ? "text-white" : "text-ink-300"}`}>
                          {entry.message}
                        </p>
                        <span className="shrink-0 text-xs text-ink-500">{formatRelativeTime(entry.at, now)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="border-t border-ink-800 px-4 py-2.5 text-[11px] text-ink-500">
            What changed since you were last here, in this browser — not a full on-chain history.
          </p>
        </div>
      )}
    </div>
  );
}
