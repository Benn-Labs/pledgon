"use client";

import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { complianceConsumerAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { VerificationBadge } from "@/components/ui/badges";

/** Shows the connected wallet's real on-chain compliance tier at all times,
 * not just reactively when a purchase happens to hit the cap — so a buyer
 * knows their standing before they ever try to fund anything. Links to the
 * full compliance page for the tier caps, volume, and why-it's-stubbed
 * explanation. */
export function HeaderComplianceStatus() {
  const { address: account, isConnected } = useAccount();

  const { data: tier } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "tierOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.complianceConsumer && account) },
  });

  if (!isConnected || tier === undefined) return null;

  return (
    <Link href="/compliance" className="hover:opacity-80">
      <VerificationBadge tier={tier} />
    </Link>
  );
}
