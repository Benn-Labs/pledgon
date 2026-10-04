import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { complianceConsumerAbi, escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";

/**
 * A wallet's compliance tier as it actually applies when funding: the
 * on-chain KYC tier (ComplianceConsumer.tierOf), except that a "super user"
 * the EscrowFactory owner has exempted from the volume caps is top tier
 * (2, uncapped). `onChainTier` is the raw KYC tier, kept so the UI can still
 * show it.
 *
 * `isSuperUser` reads as false (not an error) against a factory deployed
 * before the exemption existed — the call just reverts and the data is
 * undefined — so this is safe to use everywhere regardless of which factory
 * the app points at.
 */
export function useEffectiveTier(account: Address | undefined) {
  const { data: onChainTier } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "tierOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.complianceConsumer && account) },
  });

  const { data: superUser } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "isSuperUser",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.escrowFactory && account), retry: false },
  });

  const isSuperUser = superUser === true;
  return {
    tier: isSuperUser ? 2 : onChainTier,
    onChainTier,
    isSuperUser,
  };
}
