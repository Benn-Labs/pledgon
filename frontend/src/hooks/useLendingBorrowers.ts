import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useChainId, useReadContracts } from "wagmi";
import { lendingPoolAbi, liquidationConsumerAbi } from "@/generated/contracts";
import { lendingMarkets, type LendingMarket } from "@/lib/addresses";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export type BorrowerRisk = {
  address: Address;
  collateralAmount: bigint;
  debtAmount: bigint;
  eligible: boolean;
};

/**
 * Candidate borrower addresses for the Liquidate page's discovery table.
 * `lending_borrowers` (see supabase/schema.sql) is a pure discovery index —
 * every address ever registered via a successful depositCollateral() — never
 * authoritative on its own. This hook always re-reads each candidate's real
 * positions()/isEligible() live on-chain in one batched multicall before
 * returning anything, so a stale or wrong row there can at worst waste one
 * read, never mislead a liquidator into acting on bad data.
 *
 * @param market The lending market to read. Defaults to the first configured
 * market for backward compatibility.
 */
export function useLendingBorrowers(market?: LendingMarket) {
  const selectedMarket = market ?? lendingMarkets[0];
  const chainId = useChainId();
  const [candidates, setCandidates] = useState<Address[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !selectedMarket?.lendingPool) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setCandidatesLoading(true);
    supabase
      .from("lending_borrowers")
      .select("borrower_address")
      .eq("chain_id", chainId)
      .eq("lending_pool_address", selectedMarket.lendingPool.toLowerCase())
      .then(({ data: rows }) => {
        if (cancelled) return;
        setCandidates((rows ?? []).map((r) => r.borrower_address as Address));
        setCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, selectedMarket?.lendingPool]);

  const { data: results, isLoading: onChainLoading } = useReadContracts({
    contracts: candidates.flatMap((addr) => [
      { address: selectedMarket?.lendingPool, abi: lendingPoolAbi, functionName: "positions" as const, args: [addr] },
      {
        address: selectedMarket?.liquidationConsumer,
        abi: liquidationConsumerAbi,
        functionName: "isEligible" as const,
        args: [addr],
      },
    ]),
    query: {
      enabled:
        candidates.length > 0 &&
        Boolean(selectedMarket?.lendingPool && selectedMarket?.liquidationConsumer),
    },
  });

  const borrowers: BorrowerRisk[] = candidates
    .map((address, i) => {
      const position = results?.[i * 2]?.result as readonly [bigint, bigint] | undefined;
      const eligible = results?.[i * 2 + 1]?.result as boolean | undefined;
      if (!position) return null;
      const [collateralAmount, debtAmount] = position;
      return { address, collateralAmount, debtAmount, eligible: eligible ?? false };
    })
    .filter((b): b is BorrowerRisk => b !== null && b.debtAmount > 0n);

  return { borrowers, isLoading: candidatesLoading || (candidates.length > 0 && onChainLoading) };
}

/**
 * Returns a function that registers a depositCollateral() transaction's
 * borrower in `lending_borrowers` — no wallet signature, no extra prompt.
 * write-lending-borrower verifies the transaction itself on-chain (a real,
 * mined, successful CollateralDeposited event on this pool) and takes the
 * borrower address from that event, not from client input, so passing any
 * other transaction's hash here just fails harmlessly server-side — safe to
 * call after every successful lending-page transaction without first
 * checking which action it was.
 *
 * This only catches deposits made *after* this mechanism shipped — a
 * position opened earlier has no transaction hash sitting in this session to
 * offer. Backfilling those is cmd/discover-borrowers' job (see its own
 * comment): it reads the same CollateralDeposited history directly, with the
 * operator's elevated trust, no per-address verification needed.
 *
 * @param market The lending market to register deposits for. Defaults to the
 * first configured market for backward compatibility.
 */
export function useRegisterBorrowerFromDeposit(market?: LendingMarket) {
  const selectedMarket = market ?? lendingMarkets[0];
  const chainId = useChainId();

  return useCallback(
    (txHash: `0x${string}`) => {
      const pool = selectedMarket?.lendingPool;
      if (!pool || !isSupabaseConfigured || !supabase) return;
      supabase.functions.invoke("write-lending-borrower", {
        body: { txHash, chainId, lendingPoolAddress: pool },
      });
    },
    [chainId, selectedMarket?.lendingPool],
  );
}
