import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { useMyVaults, type VaultCreatedEvent } from "@/hooks/useMyVaults";
import { useNow } from "@/lib/countdown";

const PENDING = 0;
const DOCS_SUBMITTED = 1;
const RELEASED = 2;
const DISPUTED = 3;
const REFUNDED = 4;
const SPLIT = 5;
const SETTLED_STATUSES = [RELEASED, REFUNDED, SPLIT];

function isExpired(deadline: bigint | undefined, nowSeconds: number): boolean {
  return deadline !== undefined && deadline > 0n && nowSeconds >= Number(deadline);
}

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
      { address: v.vault, abi: escrowVaultAbi, functionName: "cancelled" as const },
      { address: v.vault, abi: escrowVaultAbi, functionName: "fundingDeadline" as const },
    ]),
    query: { enabled: allMine.length > 0 },
  });

  const perVaultScalars = allMine.map((v, i) => ({
    vault: v,
    funded: scalarResults?.[i * 5]?.result as boolean | undefined,
    bondDeposited: scalarResults?.[i * 5 + 1]?.result as boolean | undefined,
    milestoneCount: scalarResults?.[i * 5 + 2]?.result as bigint | undefined,
    cancelled: scalarResults?.[i * 5 + 3]?.result as boolean | undefined,
    fundingDeadline: scalarResults?.[i * 5 + 4]?.result as bigint | undefined,
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

  const deadlineQueries = perVaultScalars.flatMap(({ vault, milestoneCount }) =>
    milestoneCount === undefined
      ? []
      : Array.from({ length: Number(milestoneCount) }, (_, i) => [
          { address: vault.vault, abi: escrowVaultAbi, functionName: "milestoneDeadline" as const, args: [BigInt(i)] as const },
          { address: vault.vault, abi: escrowVaultAbi, functionName: "deliveryDeadline" as const, args: [BigInt(i)] as const },
        ]).flat(),
  );

  const { data: deadlineResults, isLoading: deadlinesLoading } = useReadContracts({
    contracts: deadlineQueries,
    query: { enabled: deadlineQueries.length > 0 },
  });

  // Ticks slowly — this only drives an aggregate count, not a live countdown,
  // so second-by-second precision would just cause needless re-renders.
  const now = useNow(30_000);

  const { activeCount, attentionCount } = useMemo(() => {
    if (!account) return { activeCount: 0, attentionCount: 0 };
    const lower = account.toLowerCase();
    const nowSeconds = Math.floor(now / 1000);
    let flatIndex = 0;
    let deadlineFlatIndex = 0;
    let attention = 0;
    let active = 0;

    for (const { vault, funded, bondDeposited, milestoneCount, cancelled, fundingDeadline } of perVaultScalars) {
      const isBuyer = vault.buyer.toLowerCase() === lower;
      const isSeller = vault.seller.toLowerCase() === lower;
      const isArbiter = vault.arbiter.toLowerCase() === lower;
      const statuses: number[] = [];
      const milestoneDeadlines: (bigint | undefined)[] = [];
      const deliveryDeadlines: (bigint | undefined)[] = [];
      for (let i = 0; i < Number(milestoneCount ?? 0n); i++) {
        const result = milestoneResults?.[flatIndex]?.result as readonly [bigint, number, `0x${string}`] | undefined;
        if (result) statuses.push(result[1]);
        milestoneDeadlines.push(deadlineResults?.[deadlineFlatIndex]?.result as bigint | undefined);
        deliveryDeadlines.push(deadlineResults?.[deadlineFlatIndex + 1]?.result as bigint | undefined);
        flatIndex++;
        deadlineFlatIndex += 2;
      }

      // "Active" means not fully wound down yet — a cancelled/exited vault,
      // or one where every milestone Released, Refunded, or Split, is a
      // settled trade with nothing left to do on it. Until we can positively
      // confirm every status, count it as active rather than risk
      // undercounting while data is still loading.
      const allStatusesKnown = statuses.length > 0 && statuses.length === Number(milestoneCount ?? 0n);
      const isSettled = cancelled === true || (allStatusesKnown && statuses.every((s) => SETTLED_STATUSES.includes(s)));
      if (!isSettled) active++;

      if (cancelled) continue;
      if (isBuyer && funded === false) attention++;
      if (isBuyer && statuses.includes(DOCS_SUBMITTED)) attention++;
      if (isSeller && bondDeposited === false) attention++;
      if (isSeller && funded === true && statuses.includes(PENDING)) attention++;
      if (isArbiter && statuses.includes(DISPUTED)) attention++;

      // Expired windows the beneficiary hasn't yet claimed — permissionless
      // on-chain, but silent until someone acts, so surface them directly to
      // whoever stands to gain: the seller reclaims a bond/forces a release,
      // the buyer forces a refund.
      if (isSeller && funded === false && isExpired(fundingDeadline, nowSeconds)) attention++;
      statuses.forEach((status, i) => {
        if (isSeller && status === DOCS_SUBMITTED && isExpired(milestoneDeadlines[i], nowSeconds)) attention++;
        if (isBuyer && status === PENDING && isExpired(deliveryDeadlines[i], nowSeconds)) attention++;
      });
    }

    return { activeCount: active, attentionCount: attention };
  }, [account, perVaultScalars, milestoneResults, deadlineResults, now]);

  return {
    activeCount,
    attentionCount,
    isLoading: vaultsLoading || scalarLoading || milestonesLoading || deadlinesLoading,
  };
}
