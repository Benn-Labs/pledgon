"use client";

import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { complianceConsumerAbi, escrowFactoryAbi } from "@/generated/contracts";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useMyVaults } from "@/hooks/useMyVaults";
import { VerificationBadge } from "@/components/ui/badges";
import { MarketplaceIcon, EscrowIcon, LendingIcon, ShieldAlertIcon } from "@/components/ui/icons";

export default function DashboardPage() {
  const { address: account, isConnected } = useAccount();
  const { data: vaults } = useMyVaults();

  const { data: tier } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "tierOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.complianceConsumer && account) },
  });

  const { data: tier0CapUsd } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "tier0CapUsd",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: tier1CapUsd } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "tier1CapUsd",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const buyerCount = vaults?.asBuyer.length ?? 0;
  const sellerCount = vaults?.asSeller.length ?? 0;
  const arbiterCount = vaults?.asArbiter.length ?? 0;

  if (!isConnected) {
    return (
      <div className="fade-in max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Welcome to DEEDS</h1>
        <p className="text-ink-400">
          Milestone escrow, independently verified — connect a wallet to browse the marketplace, view your active
          trades, and see your compliance standing.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="text-ink-400 mt-1">
          {account?.slice(0, 6)}…{account?.slice(-4)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Link href="/escrow" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="text-3xl font-bold font-mono text-white">{buyerCount}</div>
          <div className="text-sm text-ink-400 mt-1">Trades as Buyer</div>
        </Link>
        <Link href="/escrow" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="text-3xl font-bold font-mono text-white">{sellerCount}</div>
          <div className="text-sm text-ink-400 mt-1">Trades as Seller</div>
        </Link>
        <Link href="/escrow" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="text-3xl font-bold font-mono text-white">{arbiterCount}</div>
          <div className="text-sm text-ink-400 mt-1">Trades as Arbiter</div>
        </Link>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-trust-500/20 flex items-center justify-center shrink-0">
              <ShieldAlertIcon className="w-5 h-5 text-trust-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Compliance Status</h2>
              <p className="text-sm text-ink-400">Your on-chain KYC tier, verified by the compliance-check workflow</p>
            </div>
          </div>
          {tier !== undefined && <VerificationBadge tier={tier} />}
        </div>

        {tier0CapUsd !== undefined && tier1CapUsd !== undefined && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className={`p-3 rounded-lg border ${tier === 0 ? "border-trust-500/40 bg-trust-500/10" : "border-ink-700 bg-ink-800/50"}`}>
              <div className="text-xs text-ink-400 mb-1">Tier 0</div>
              <div className="font-mono text-sm text-ink-100">${tier0CapUsd.toString()} / 30d</div>
            </div>
            <div className={`p-3 rounded-lg border ${tier === 1 ? "border-trust-500/40 bg-trust-500/10" : "border-ink-700 bg-ink-800/50"}`}>
              <div className="text-xs text-ink-400 mb-1">Tier 1</div>
              <div className="font-mono text-sm text-ink-100">${tier1CapUsd.toString()} / 30d</div>
            </div>
            <div className={`p-3 rounded-lg border ${tier === 2 ? "border-trust-500/40 bg-trust-500/10" : "border-ink-700 bg-ink-800/50"}`}>
              <div className="text-xs text-ink-400 mb-1">Tier 2</div>
              <div className="font-mono text-sm text-ink-100">Uncapped</div>
            </div>
          </div>
        )}
        <p className="text-xs text-ink-500 mt-3">
          Caps are USD-equivalent, assuming a ~1:1 stablecoin peg. Your actual rolling volume is token-specific and
          shown when funding a trade, since it isn&apos;t meaningfully comparable across different payment tokens.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/marketplace" className="deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <MarketplaceIcon className="w-6 h-6 text-trust-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Marketplace</div>
            <div className="text-xs text-ink-400">Browse & create listings</div>
          </div>
        </Link>
        <Link href="/escrow" className="deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5">
          <EscrowIcon className="w-6 h-6 text-success-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Escrow</div>
            <div className="text-xs text-ink-400">Manage active trades</div>
          </div>
        </Link>
        <Link
          href="/lending"
          className={`deal-card flex items-center gap-3 bg-ink-900 border border-ink-800 rounded-xl p-5 ${!isLendingConfigured ? "opacity-50" : ""}`}
        >
          <LendingIcon className="w-6 h-6 text-warning-400 shrink-0" />
          <div>
            <div className="font-semibold text-white">Lending</div>
            <div className="text-xs text-ink-400">{isLendingConfigured ? "Collateral & positions" : "Not deployed yet"}</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
