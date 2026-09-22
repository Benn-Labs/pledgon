import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useChainId, useReadContracts } from "wagmi";
import { lendingPoolAbi, liquidationConsumerAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { useSignedLendingBorrowerWrite } from "@/hooks/useSignedMetadataWrite";

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
 */
export function useLendingBorrowers() {
  const chainId = useChainId();
  const [candidates, setCandidates] = useState<Address[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !addresses.lendingPool) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setCandidatesLoading(true);
    supabase
      .from("lending_borrowers")
      .select("borrower_address")
      .eq("chain_id", chainId)
      .eq("lending_pool_address", addresses.lendingPool.toLowerCase())
      .then(({ data: rows }) => {
        if (cancelled) return;
        setCandidates((rows ?? []).map((r) => r.borrower_address as Address));
        setCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  const { data: results, isLoading: onChainLoading } = useReadContracts({
    contracts: candidates.flatMap((addr) => [
      { address: addresses.lendingPool, abi: lendingPoolAbi, functionName: "positions" as const, args: [addr] },
      { address: addresses.liquidationConsumer, abi: liquidationConsumerAbi, functionName: "isEligible" as const, args: [addr] },
    ]),
    query: { enabled: candidates.length > 0 && Boolean(addresses.lendingPool && addresses.liquidationConsumer) },
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
 * Returns a function that registers the connected wallet in
 * `lending_borrowers` — but only if it isn't already there. Without this
 * check, calling the signed write directly on every "you have an open
 * position" render (e.g. every page load) would prompt a wallet signature
 * every single time, forever, for the same address — the read here is free
 * and silent (public RLS select, no wallet interaction), so it's always
 * worth doing before ever asking for a signature. Guarded per-account so it
 * only checks once per connect, not on every re-render.
 */
export function useEnsureLendingBorrowerRegistered() {
  const { address: account } = useAccount();
  const chainId = useChainId();
  const { write: registerBorrower } = useSignedLendingBorrowerWrite();
  const attemptedRef = useRef<Address | null>(null);

  return useCallback(() => {
    const pool = addresses.lendingPool;
    if (!account || !pool || !isSupabaseConfigured || !supabase) return;
    if (attemptedRef.current === account) return;
    attemptedRef.current = account;

    supabase
      .from("lending_borrowers")
      .select("id")
      .eq("chain_id", chainId)
      .eq("lending_pool_address", pool.toLowerCase())
      .eq("borrower_address", account.toLowerCase())
      .maybeSingle()
      .then(({ data }) => {
        if (data) return; // already registered — never prompt again
        registerBorrower({ chainId, lendingPoolAddress: pool });
      });
  }, [account, chainId, registerBorrower]);
}
