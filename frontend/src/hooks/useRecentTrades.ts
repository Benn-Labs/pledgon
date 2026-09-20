import { useMemo } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { useMyVaults, type VaultCreatedEvent } from "@/hooks/useMyVaults";
import { useEscrowMetadataMap } from "@/hooks/useEscrowMetadataMap";
import { useListingTitleByVault } from "@/hooks/useListingTitleByVault";
import { deriveTradeStatus, deriveTradeProgress, type TradeLifecycleStatus, type TradeProgress } from "@/lib/tradeStatus";

export interface RecentTrade {
  vault: Address;
  /** Position in EscrowFactory.allVaults() — shown as a stable vault number (e.g. #0000001). */
  index: number;
  role: "buyer" | "seller" | "arbiter";
  status: TradeLifecycleStatus;
  progress: TradeProgress;
  totalAmount: bigint;
  decimals: number | undefined;
  symbol: string | undefined;
  description: string | undefined;
  /** The Marketplace listing's title, for trades opened via purchase() rather than Create Escrow. */
  listingTitle: string | undefined;
}

/**
 * The `limit` most recently created vaults the connected wallet is party to
 * (any role), each with its derived status and progress — the Dashboard's
 * at-a-glance feed. "Recent" relies on EscrowFactory.allVaults() appending in
 * creation order, so the tail of that array is the newest.
 */
export function useRecentTrades(limit: number) {
  const { data, isLoading: vaultsLoading } = useMyVaults();

  const allMine = useMemo(() => {
    const map = new Map<string, { entry: VaultCreatedEvent; role: RecentTrade["role"] }>();
    for (const v of data?.asBuyer ?? []) map.set(v.vault.toLowerCase(), { entry: v, role: "buyer" });
    for (const v of data?.asSeller ?? []) if (!map.has(v.vault.toLowerCase())) map.set(v.vault.toLowerCase(), { entry: v, role: "seller" });
    for (const v of data?.asArbiter ?? []) if (!map.has(v.vault.toLowerCase())) map.set(v.vault.toLowerCase(), { entry: v, role: "arbiter" });
    return [...map.values()].slice(-limit).reverse();
  }, [data, limit]);

  const { data: scalarResults, isLoading: scalarLoading } = useReadContracts({
    contracts: allMine.flatMap(({ entry }) => [
      { address: entry.vault, abi: escrowVaultAbi, functionName: "funded" as const },
      { address: entry.vault, abi: escrowVaultAbi, functionName: "bondDeposited" as const },
      { address: entry.vault, abi: escrowVaultAbi, functionName: "milestoneCount" as const },
      { address: entry.vault, abi: escrowVaultAbi, functionName: "cancelled" as const },
    ]),
    query: { enabled: allMine.length > 0 },
  });

  const perVaultScalars = useMemo(
    () =>
      allMine.map(({ entry, role }, i) => ({
        entry,
        role,
        funded: scalarResults?.[i * 4]?.result as boolean | undefined,
        bondDeposited: scalarResults?.[i * 4 + 1]?.result as boolean | undefined,
        milestoneCount: scalarResults?.[i * 4 + 2]?.result as bigint | undefined,
        cancelled: scalarResults?.[i * 4 + 3]?.result as boolean | undefined,
      })),
    [allMine, scalarResults],
  );

  const milestoneQueries = useMemo(
    () =>
      perVaultScalars.flatMap(({ entry, milestoneCount }) =>
        milestoneCount === undefined
          ? []
          : Array.from({ length: Number(milestoneCount) }, (_, i) => ({
              address: entry.vault,
              abi: escrowVaultAbi,
              functionName: "milestones" as const,
              args: [BigInt(i)] as const,
            })),
      ),
    [perVaultScalars],
  );

  const { data: milestoneResults, isLoading: milestonesLoading } = useReadContracts({
    contracts: milestoneQueries,
    query: { enabled: milestoneQueries.length > 0 },
  });

  const uniqueTokens = useMemo(() => [...new Set(allMine.map(({ entry }) => entry.token.toLowerCase()))] as Address[], [allMine]);

  const { data: tokenResults } = useReadContracts({
    contracts: uniqueTokens.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
    ]),
    query: { enabled: uniqueTokens.length > 0 },
  });

  const tokenInfo = useMemo(() => {
    const map = new Map<string, { decimals: number; symbol: string }>();
    uniqueTokens.forEach((token, i) => {
      const decimals = tokenResults?.[i * 2]?.result as number | undefined;
      const symbol = tokenResults?.[i * 2 + 1]?.result as string | undefined;
      if (decimals !== undefined && symbol !== undefined) map.set(token, { decimals, symbol });
    });
    return map;
  }, [uniqueTokens, tokenResults]);

  const descriptionByVault = useEscrowMetadataMap(useMemo(() => allMine.map(({ entry }) => entry.vault), [allMine]));
  const listingTitleByVault = useListingTitleByVault();

  const trades = useMemo(() => {
    const result: RecentTrade[] = [];
    let flatIndex = 0;
    for (const { entry, role, funded, bondDeposited, milestoneCount, cancelled } of perVaultScalars) {
      const statuses: number[] = [];
      for (let i = 0; i < Number(milestoneCount ?? 0n); i++) {
        const m = milestoneResults?.[flatIndex]?.result as readonly [bigint, number, `0x${string}`] | undefined;
        if (m) statuses.push(m[1]);
        flatIndex++;
      }
      if (funded === undefined || bondDeposited === undefined) continue;
      const info = tokenInfo.get(entry.token.toLowerCase());
      result.push({
        vault: entry.vault,
        index: entry.index,
        role,
        status: deriveTradeStatus({ bondAmount: entry.bondAmount, bondDeposited, funded, cancelled, milestoneStatuses: statuses }),
        progress: deriveTradeProgress({ bondAmount: entry.bondAmount, bondDeposited, funded, cancelled, milestoneStatuses: statuses }),
        totalAmount: entry.totalAmount,
        decimals: info?.decimals,
        symbol: info?.symbol,
        description: descriptionByVault.get(entry.vault.toLowerCase()),
        listingTitle: listingTitleByVault.get(entry.vault.toLowerCase()),
      });
    }
    return result;
  }, [perVaultScalars, milestoneResults, tokenInfo, descriptionByVault, listingTitleByVault]);

  return { trades, isLoading: vaultsLoading || scalarLoading || milestonesLoading };
}
