"use client";

import { formatTimeLeft, useNow } from "@/lib/countdown";

/**
 * A ticking "Xd Yh left" pill for a trade card or detail view. `deadline` is
 * the raw on-chain Unix-seconds value (`fundingDeadline`/`milestoneDeadline`)
 * — 0 renders nothing, since that's EscrowVault's "no deadline configured"
 * sentinel, not an actual expired-at-epoch deadline.
 */
export function CountdownBadge({ deadline, label }: { deadline: bigint | number | undefined; label: string }) {
  const now = useNow();
  if (deadline === undefined) return null;
  const timeLeft = formatTimeLeft(deadline, now);
  if (!timeLeft) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium px-2 py-0.5 text-xs ${
        timeLeft.expired
          ? "bg-danger-500/20 text-danger-400 border-danger-500/30"
          : "bg-warning-500/20 text-warning-400 border-warning-500/30"
      }`}
      title={label}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {label}: {timeLeft.label}
    </span>
  );
}
