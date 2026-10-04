import type { TradeLifecycleStatus } from "@/lib/tradeStatus";

type Status = "Pending" | "DocsSubmitted" | "Released" | "Disputed" | "Refunded" | "Split" | "Active" | "Cancelled" | "Sold" | "TakenDown";

const STATUS_CONFIG: Record<Status, { classes: string; dot: string; label: string }> = {
  Pending: { classes: "bg-ink-700 text-ink-300 border-ink-600", dot: "bg-ink-400", label: "Pending" },
  DocsSubmitted: {
    classes: "bg-trust-500/20 text-trust-400 border-trust-500/30",
    dot: "bg-trust-400 animate-pulse-subtle",
    label: "Docs Submitted",
  },
  Released: { classes: "bg-success-500/20 text-success-400 border-success-500/30", dot: "bg-success-400", label: "Released" },
  Disputed: { classes: "bg-danger-500/20 text-danger-400 border-danger-500/30", dot: "bg-danger-400", label: "Disputed" },
  Refunded: { classes: "bg-warning-500/20 text-warning-400 border-warning-500/30", dot: "bg-warning-400", label: "Refunded" },
  Split: { classes: "bg-trust-500/20 text-trust-400 border-trust-500/30", dot: "bg-trust-400", label: "Split" },
  Active: { classes: "bg-success-500/20 text-success-400 border-success-500/30", dot: "bg-success-400", label: "Active" },
  Cancelled: { classes: "bg-ink-700 text-ink-400 border-ink-600", dot: "bg-ink-500", label: "Cancelled" },
  Sold: { classes: "bg-trust-500/20 text-trust-400 border-trust-500/30", dot: "bg-trust-400", label: "Sold" },
  TakenDown: { classes: "bg-danger-500/20 text-danger-400 border-danger-500/30", dot: "bg-danger-400", label: "Removed" },
};

export const MILESTONE_STATUS: Status[] = ["Pending", "DocsSubmitted", "Released", "Disputed", "Refunded", "Split"];
export const LISTING_STATUS: Status[] = ["Active", "Cancelled", "Sold", "TakenDown"];

export function StatusBadge({ status, size = "md" }: { status: Status; size?: "sm" | "md" }) {
  // Defensive fallback: an out-of-range status (e.g. a future enum value)
  // must not crash render.
  const config = STATUS_CONFIG[status] ?? { classes: "bg-ink-700 text-ink-300 border-ink-600", dot: "bg-ink-400", label: status };
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${config.classes} ${sizeClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

const TIER_COLORS = [
  "bg-ink-700 text-ink-300 border-ink-600",
  "bg-trust-500/20 text-trust-400 border-trust-500/30",
  "bg-success-500/20 text-success-400 border-success-500/30",
];

export function VerificationBadge({ tier, superUser = false }: { tier: number; superUser?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium px-3 py-1 text-sm ${TIER_COLORS[tier] ?? TIER_COLORS[0]}`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
      Tier {tier}
      {superUser && <span className="opacity-80">· Super user</span>}
    </span>
  );
}

const ROLE_COLORS = {
  buyer: "bg-trust-500/20 text-trust-400 border-trust-500/30",
  seller: "bg-success-500/20 text-success-400 border-success-500/30",
  arbiter: "bg-warning-500/20 text-warning-400 border-warning-500/30",
};

export function RoleBadge({ role }: { role: "buyer" | "seller" | "arbiter" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium px-3 py-1 text-sm capitalize ${ROLE_COLORS[role]}`}>
      {role}
    </span>
  );
}

// Amber = someone needs to act before this trade is live. Green = healthy
// (pulsing while active, a checkmark once settled — same color family on
// purpose, since both are "good" states, distinguished by motion/icon
// instead of color). Red is reserved exclusively for Disputed.
const TRADE_STATUS_CONFIG: Record<TradeLifecycleStatus, { classes: string; dot: string }> = {
  Cancelled: { classes: "bg-ink-700 text-ink-400 border-ink-600", dot: "bg-ink-500" },
  "Awaiting Bond": { classes: "bg-warning-500/20 text-warning-400 border-warning-500/30", dot: "bg-warning-400" },
  "Awaiting Funding": { classes: "bg-warning-500/20 text-warning-400 border-warning-500/30", dot: "bg-warning-400" },
  Active: { classes: "bg-success-500/20 text-success-400 border-success-500/30", dot: "bg-success-400 animate-pulse-subtle" },
  Disputed: { classes: "bg-danger-500/20 text-danger-400 border-danger-500/30", dot: "bg-danger-400" },
  Completed: { classes: "bg-success-500/20 text-success-400 border-success-500/30", dot: "" },
};

export function TradeStatusBadge({ status, size = "md" }: { status: TradeLifecycleStatus; size?: "sm" | "md" }) {
  const config = TRADE_STATUS_CONFIG[status] ?? { classes: "bg-ink-700 text-ink-300 border-ink-600", dot: "bg-ink-400" };
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${config.classes} ${sizeClasses}`}>
      {status === "Completed" ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      )}
      {status}
    </span>
  );
}
