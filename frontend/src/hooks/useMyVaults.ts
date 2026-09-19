import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { escrowFactoryAbi } from "@/generated/contracts";
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
 * EscrowFactory tracks vaultsByBuyer/vaultsBySeller mappings but has no
 * vaultsByArbiter — the arbiter role isn't indexed on-chain at all. Rather
 * than mix a mapping-based lookup for buyer/seller with a different
 * mechanism for arbiter, this reads every VaultCreated event once (arbiter
 * is a plain, non-indexed event field, so it's readable from the log) and
 * filters all three roles client-side from the same data.
 */
export function useMyVaults() {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["myVaults", addresses.escrowFactory, account],
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: addresses.escrowFactory!,
        abi: escrowFactoryAbi,
        eventName: "VaultCreated",
        fromBlock: 0n,
        toBlock: "latest",
      });
      const all = logs.map((l) => l.args as VaultCreatedEvent).filter((v) => v.vault);

      if (!account) return { all, asBuyer: [], asSeller: [], asArbiter: [] };
      const lower = account.toLowerCase();
      return {
        all,
        asBuyer: all.filter((v) => v.buyer.toLowerCase() === lower),
        asSeller: all.filter((v) => v.seller.toLowerCase() === lower),
        asArbiter: all.filter((v) => v.arbiter.toLowerCase() === lower),
      };
    },
    enabled: Boolean(addresses.escrowFactory && publicClient),
  });
}
