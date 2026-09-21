import type { Address } from "viem";
import type { RecentTrade } from "@/hooks/useRecentTrades";
import type { TradeLifecycleStatus } from "@/lib/tradeStatus";
import { formatVaultNumber } from "@/lib/format";

const SNAPSHOT_PREFIX = "pledgon:activitySnapshot:";
const FEED_PREFIX = "pledgon:activityFeed:";
const MAX_ENTRIES = 20;

export type ActivityTone = "info" | "success" | "warning" | "danger";

export interface ActivityEntry {
  id: string;
  vault: Address;
  message: string;
  tone: ActivityTone;
  at: number;
}

type Snapshot = Record<string, TradeLifecycleStatus>;

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can throw (private browsing, quota, disabled) — losing
    // this local-only convenience isn't worth failing anything else.
  }
}

function describeTransition(status: TradeLifecycleStatus, label: string): { message: string; tone: ActivityTone } | undefined {
  switch (status) {
    case "Disputed":
      return { message: `Trade ${label} was disputed`, tone: "danger" };
    case "Completed":
      return { message: `Trade ${label} completed`, tone: "success" };
    case "Cancelled":
      return { message: `Trade ${label} was cancelled — any bond returned`, tone: "warning" };
    case "Active":
      return { message: `Trade ${label} is now funded and active`, tone: "info" };
    default:
      // "Awaiting Bond"/"Awaiting Funding" are the starting states a new
      // trade already occupies — not transitions worth a feed entry.
      return undefined;
  }
}

interface ActivityDiff {
  /** What to render this pass — already merged with the persisted feed. */
  displayFeed: ActivityEntry[];
  /** Undefined means nothing changed; the caller has nothing to persist. */
  nextSnapshot: Snapshot | undefined;
}

/**
 * Turns changes in the wallet's trades into "what happened since you were
 * last here" feed entries, by diffing against a snapshot kept in this
 * browser's localStorage — not a real on-chain history. There's no usable
 * historical source to build a true timeline from: EscrowFactory logs are a
 * dead end on this RPC (see useMyVaults.ts — the free tier caps eth_getLogs
 * to a handful of blocks), and nothing off-chain records trade lifecycle
 * events either. Local-only and per-browser, same tradeoff as
 * tradeDescriptions.ts. A wallet's first-ever run seeds the snapshot
 * silently instead of reporting every existing trade as new activity.
 *
 * Pure read — callers persist the result themselves (see
 * persistActivityDiff) so this can run from a render-phase useMemo without
 * a component reaching for setState inside an effect.
 */
export function computeActivityDiff(account: Address, trades: RecentTrade[]): ActivityDiff {
  const snapshotKey = SNAPSHOT_PREFIX + account.toLowerCase();
  const feedKey = FEED_PREFIX + account.toLowerCase();

  const previousSnapshot = readJson<Snapshot>(snapshotKey);
  const existingFeed = readJson<ActivityEntry[]>(feedKey) ?? [];
  const nextSnapshot: Snapshot = {};
  const newEntries: ActivityEntry[] = [];
  const now = Date.now();

  for (const trade of trades) {
    const key = trade.vault.toLowerCase();
    nextSnapshot[key] = trade.status;
    if (previousSnapshot === undefined) continue;

    const label = formatVaultNumber(trade.index);
    const previousStatus = previousSnapshot[key];
    if (previousStatus === undefined) {
      newEntries.push({ id: `${key}-${now}-new`, vault: trade.vault, at: now, tone: "info", message: `New trade ${label} created` });
      continue;
    }
    if (previousStatus === trade.status) continue;
    const transition = describeTransition(trade.status, label);
    if (transition) newEntries.push({ id: `${key}-${now}-${trade.status}`, vault: trade.vault, at: now, ...transition });
  }

  if (previousSnapshot !== undefined && JSON.stringify(previousSnapshot) === JSON.stringify(nextSnapshot)) {
    return { displayFeed: existingFeed, nextSnapshot: undefined };
  }

  const displayFeed = newEntries.length > 0 ? [...newEntries, ...existingFeed].slice(0, MAX_ENTRIES) : existingFeed;
  return { displayFeed, nextSnapshot };
}

/** Persists what computeActivityDiff decided — call from an effect, not during render. */
export function persistActivityDiff(account: Address, nextSnapshot: Snapshot, displayFeed: ActivityEntry[]) {
  writeJson(SNAPSHOT_PREFIX + account.toLowerCase(), nextSnapshot);
  writeJson(FEED_PREFIX + account.toLowerCase(), displayFeed);
}
