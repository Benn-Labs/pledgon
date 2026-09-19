import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { escrowFactoryAbi, escrowVaultAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";

export type VaultCreatedEvent = {
  vault: Address;
  buyer: Address;
  seller: Address;
  arbiter: Address;
  token: Address;
  bondAmount: bigint;
};

/**
 * Enumerates every vault via EscrowFactory.vaultCount()/allVaults(i) and
 * reads each one's buyer/seller/arbiter/token/bondAmount directly — plain
 * contract calls, not event logs. Originally this scanned VaultCreated
 * events instead (arbiter isn't in any on-chain mapping, only in the
 * event), but that broke on real RPC providers: Alchemy's free tier caps
 * eth_getLogs to a 10-block range, and this factory has spanned thousands
 * of blocks since deployment. Contract reads have no such range limit.
 */
export function useMyVaults() {
  const { address: account } = useAccount();

  const { data: vaultCount, isLoading: countLoading } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "vaultCount",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const vaultIndices = useMemo(
    () => (vaultCount === undefined ? [] : Array.from({ length: Number(vaultCount) }, (_, i) => i)),
    [vaultCount],
  );

  const { data: vaultAddressResults, isLoading: addressesLoading } = useReadContracts({
    contracts: vaultIndices.map((i) => ({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "allVaults" as const,
      args: [BigInt(i)],
    })),
    query: { enabled: vaultIndices.length > 0 },
  });

  const vaultAddresses = useMemo(
    () => vaultAddressResults?.map((r) => r.result as Address | undefined).filter((v): v is Address => Boolean(v)) ?? [],
    [vaultAddressResults],
  );

  const { data: detailResults, isLoading: detailsLoading } = useReadContracts({
    contracts: vaultAddresses.flatMap((v) => [
      { address: v, abi: escrowVaultAbi, functionName: "buyer" as const },
      { address: v, abi: escrowVaultAbi, functionName: "seller" as const },
      { address: v, abi: escrowVaultAbi, functionName: "arbiter" as const },
      { address: v, abi: escrowVaultAbi, functionName: "token" as const },
      { address: v, abi: escrowVaultAbi, functionName: "bondAmount" as const },
    ]),
    query: { enabled: vaultAddresses.length > 0 },
  });

  const all = useMemo(() => {
    return vaultAddresses
      .map((vault, i) => ({
        vault,
        buyer: detailResults?.[i * 5]?.result as Address | undefined,
        seller: detailResults?.[i * 5 + 1]?.result as Address | undefined,
        arbiter: detailResults?.[i * 5 + 2]?.result as Address | undefined,
        token: detailResults?.[i * 5 + 3]?.result as Address | undefined,
        bondAmount: detailResults?.[i * 5 + 4]?.result as bigint | undefined,
      }))
      .filter(
        (v): v is VaultCreatedEvent =>
          Boolean(v.buyer && v.seller && v.arbiter && v.token) && v.bondAmount !== undefined,
      );
  }, [vaultAddresses, detailResults]);

  const roles = useMemo(() => {
    if (!account) return { all, asBuyer: [], asSeller: [], asArbiter: [] };
    const lower = account.toLowerCase();
    return {
      all,
      asBuyer: all.filter((v) => v.buyer.toLowerCase() === lower),
      asSeller: all.filter((v) => v.seller.toLowerCase() === lower),
      asArbiter: all.filter((v) => v.arbiter.toLowerCase() === lower),
    };
  }, [all, account]);

  return { data: roles, isLoading: countLoading || addressesLoading || detailsLoading };
}
