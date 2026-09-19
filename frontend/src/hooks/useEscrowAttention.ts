import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { useMyVaults, type VaultCreatedEvent } from "@/hooks/useMyVaults";

const PENDING = 0;
const DOCS_SUBMITTED = 1;
const DISPUTED = 3;

/**
 * "Active" and "needs attention" counts across every trade the connected
 * wallet is party to. Deliberately not just a per-role count (buyer/seller/
 * arbiter totals are shown on the Escrow list itself) — this is meant to
 * answer "is there anything I should actually go do right now."
 */
export function useEscrowAttention() {
  const { address: account } = useAccount();
  const { data: vaults, isLoading: vaultsLoading } = useMyVaults();

  const allMine = useMemo(() => {
    const map = new Map<string, VaultCreatedEvent>();
    for (const v of [...(vaults?.asBuyer ?? []), ...(vaults?.asSeller ?? []), ...(vaults?.asArbiter ?? [])]) {
      map.set(v.vault.toLowerCase(), v);
    }
    return [...map.values()];
  }, [vaults]);

  const { data: scalarResults, isLoading: scalarLoading } = useReadContracts({
    contracts: allMine.flatMap((v) => [
      { address: v.vault, abi: escrowVaultAbi, functionName: "funded" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "bondDeposited" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "milestoneCount" as const },
    ]),
    query: { enabled: allMine.length > 0 },
  });

  const perVaultScalars = allMine.map((v, i) => ({
    vault: v,
    funded: scalarResults?.[i * 3]?.result as boolean | undefined,
    bondDeposited: scalarResults?.[i * 3 + 1]?.result as boolean | undefined,
    milestoneCount: scalarResults?.[i * 3 + 2]?.result as bigint | undefined,
  }));

  const milestoneQueries = perVaultScalars.flatMap(({ vault, milestoneCount }) =>
    milestoneCount === undefined
      ? []
      : Array.from({ length: Number(milestoneCount) }, (_, i) => ({
          address: vault.vault,
          abi: escrowVaultAbi,
          functionName: "milestones" as const,
          args: [BigInt(i)] as const,
        })),
  );

  const { data: milestoneResults, isLoading: milestonesLoading } = useReadContracts({
    contracts: milestoneQueries,
    query: { enabled: milestoneQueries.length > 0 },
  });

  const attentionCount = useMemo(() => {
    if (!account) return 0;
    const lower = account.toLowerCase();
    let flatIndex = 0;
    let count = 0;

    for (const { vault, funded, bondDeposited, milestoneCount } of perVaultScalars) {
      const isBuyer = vault.buyer.toLowerCase() === lower;
      const isSeller = vault.seller.toLowerCase() === lower;
      const isArbiter = vault.arbiter.toLowerCase() === lower;
      const statuses: number[] = [];
      for (let i = 0; i < Number(milestoneCount ?? 0n); i++) {
        const result = milestoneResults?.[flatIndex]?.result as readonly [bigint, number, `0x${string}`] | undefined;
        if (result) statuses.push(result[1]);
        flatIndex++;
      }

      if (isBuyer && funded === false) count++;
      if (isBuyer && statuses.includes(DOCS_SUBMITTED)) count++;
      if (isSeller && bondDeposited === false) count++;
      if (isSeller && funded === true && statuses.includes(PENDING)) count++;
      if (isArbiter && statuses.includes(DISPUTED)) count++;
    }

    return count;
  }, [account, perVaultScalars, milestoneResults]);

  return {
    activeCount: allMine.length,
    attentionCount,
    isLoading: vaultsLoading || scalarLoading || milestonesLoading,
  };
}
