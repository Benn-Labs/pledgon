import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { escrowFactoryAbi, arbitratorRegistryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";

/**
 * Every arbiter a trade creator may currently pick: EscrowFactory's own
 * default (always first, and what an empty selection resolves to on-chain
 * anyway), plus every address ArbitratorRegistry.allAccredited() has ever
 * listed that `isAccredited` still reports true for.
 *
 * Enumerates via plain contract reads (accreditedCount()/allAccredited(i)),
 * not event logs — see ArbitratorRegistry.sol's doc comment on why: log
 * scanning breaks on RPC providers that cap eth_getLogs to a short block
 * range, which already bit this codebase once (see useMyVaults.ts).
 */
export function useAccreditedArbitrators() {
  const { data: registryAddress } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "arbitratorRegistry",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: defaultArbiter } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "defaultArbiter",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: accreditedCount } = useReadContract({
    address: registryAddress,
    abi: arbitratorRegistryAbi,
    functionName: "accreditedCount",
    query: { enabled: Boolean(registryAddress) },
  });

  const candidateIndices = useMemo(
    () => (accreditedCount === undefined ? [] : Array.from({ length: Number(accreditedCount) }, (_, i) => i)),
    [accreditedCount],
  );

  const { data: candidateResults, isLoading: candidatesLoading } = useReadContracts({
    contracts: candidateIndices.map((i) => ({
      address: registryAddress,
      abi: arbitratorRegistryAbi,
      functionName: "allAccredited" as const,
      args: [BigInt(i)],
    })),
    query: { enabled: Boolean(registryAddress) && candidateIndices.length > 0 },
  });

  const candidates = useMemo(
    () => candidateResults?.map((r) => r.result as Address | undefined).filter((a): a is Address => Boolean(a)) ?? [],
    [candidateResults],
  );

  const { data: currentlyAccreditedResults, isLoading: statusLoading } = useReadContracts({
    contracts: candidates.map((a) => ({
      address: registryAddress,
      abi: arbitratorRegistryAbi,
      functionName: "isAccredited" as const,
      args: [a],
    })),
    query: { enabled: Boolean(registryAddress) && candidates.length > 0 },
  });

  const accredited = useMemo(
    () => candidates.filter((_, i) => currentlyAccreditedResults?.[i]?.result === true),
    [candidates, currentlyAccreditedResults],
  );

  return {
    defaultArbiter: defaultArbiter as Address | undefined,
    accredited,
    isLoading: candidatesLoading || statusLoading,
  };
}
