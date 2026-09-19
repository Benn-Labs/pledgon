import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { escrowVaultAbi } from "@/generated/contracts";

/**
 * The dispute reason and who raised it aren't stored on-chain past the
 * `Disputed` event itself (`disputeMilestone` doesn't persist them to
 * storage) — so reading them back means fetching that event's log, not a
 * contract read.
 */
export function useDisputeReason(vault: Address, index: number, enabled: boolean) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["disputeReason", vault, index],
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: vault,
        abi: escrowVaultAbi,
        eventName: "Disputed",
        args: { milestoneIndex: BigInt(index) },
        fromBlock: 0n,
        toBlock: "latest",
      });
      const last = logs.at(-1);
      if (!last?.args.raisedBy || last.args.reason === undefined) return null;
      return { raisedBy: last.args.raisedBy, reason: last.args.reason };
    },
    enabled: enabled && Boolean(publicClient),
  });
}
