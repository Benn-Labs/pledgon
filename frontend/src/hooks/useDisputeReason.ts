import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { escrowVaultAbi } from "@/generated/contracts";

// Alchemy's free tier caps eth_getLogs at a 10-block range, full stop,
// regardless of address/topic filters — confirmed directly against the
// actual RPC. There's no on-chain state fallback for the dispute reason
// (disputeMilestone doesn't persist it to storage, only emits it), so this
// pages backward from the latest block in 10-block windows instead of one
// all-or-nothing wide-range query. Bounded to a few hundred blocks (~1-2
// hours on Sepolia) — enough for "just disputed it, come check" testing,
// not a promise to find an arbitrarily old dispute on this RPC tier.
const CHUNK_SIZE = 9n;
const MAX_CHUNKS = 50;

export function useDisputeReason(vault: Address, index: number, enabled: boolean) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["disputeReason", vault, index],
    queryFn: async () => {
      const client = publicClient!;
      let to = await client.getBlockNumber();

      for (let i = 0; i < MAX_CHUNKS; i++) {
        const from = to > CHUNK_SIZE ? to - CHUNK_SIZE : 0n;
        try {
          const logs = await client.getContractEvents({
            address: vault,
            abi: escrowVaultAbi,
            eventName: "Disputed",
            args: { milestoneIndex: BigInt(index) },
            fromBlock: from,
            toBlock: to,
          });
          const last = logs.at(-1);
          if (last?.args.raisedBy && last.args.reason !== undefined) {
            return { raisedBy: last.args.raisedBy, reason: last.args.reason };
          }
        } catch {
          // This RPC can't serve eth_getLogs at all for this range (e.g. the
          // free-tier cap) — every further chunk would fail the same way.
          break;
        }
        if (from === 0n) break;
        to = from - 1n;
      }
      return null;
    },
    enabled: enabled && Boolean(publicClient),
  });
}
