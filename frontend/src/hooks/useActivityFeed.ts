import { useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import type { RecentTrade } from "@/hooks/useRecentTrades";
import { computeActivityDiff, persistActivityDiff, type ActivityEntry } from "@/lib/activityFeed";

/**
 * Diffs trades against the persisted feed during render (computeActivityDiff
 * is a pure read), then persists the result in an effect — never setState
 * inside the effect itself, which would cost an extra render pass for what's
 * already known synchronously. Keyed off `fingerprint`, not `trades` itself:
 * useRecentTrades hands back a fresh array reference every poll tick even
 * when nothing changed, and re-diffing/re-writing localStorage on each of
 * those would be pure waste.
 */
export function useActivityFeed(trades: RecentTrade[], isLoading: boolean): ActivityEntry[] {
  const { address: account } = useAccount();
  const fingerprint = trades.map((t) => `${t.vault.toLowerCase()}:${t.status}`).join("|");

  const { displayFeed, nextSnapshot } = useMemo(() => {
    if (!account || isLoading) return { displayFeed: [], nextSnapshot: undefined };
    return computeActivityDiff(account, trades);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fingerprint` is the stable identity for `trades`
  }, [account, isLoading, fingerprint]);

  useEffect(() => {
    if (!account || !nextSnapshot) return;
    persistActivityDiff(account, nextSnapshot, displayFeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fingerprint` is the stable identity for `trades`/displayFeed/nextSnapshot
  }, [account, fingerprint]);

  return displayFeed;
}
