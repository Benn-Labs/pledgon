"use client";

import { useAccount, useReadContract } from "wagmi";
import { complianceConsumerAbi, escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useEffectiveTier } from "@/hooks/useEffectiveTier";
import { VerificationBadge } from "@/components/ui/badges";
import { ShieldAlertIcon } from "@/components/ui/icons";

function formatTimestamp(seconds: bigint): string {
  if (seconds === 0n) return "never";
  return new Date(Number(seconds) * 1000).toLocaleString();
}

export default function CompliancePage() {
  const { address: account, isConnected } = useAccount();

  const { tier, onChainTier, isSuperUser } = useEffectiveTier(account);

  const { data: verifiedAt } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "verifiedAt",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.complianceConsumer && account) },
  });

  const { data: maxValidity } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "maxValidity",
    query: { enabled: Boolean(addresses.complianceConsumer) },
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

  const { data: periodVolume } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "currentPeriodVolume",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.escrowFactory && account) },
  });

  if (!isConnected) {
    return (
      <div className="fade-in max-w-2xl mx-auto text-center py-16">
        <p className="text-ink-400">Connect a wallet to see your compliance standing.</p>
      </div>
    );
  }

  const expiresAt = verifiedAt !== undefined && maxValidity !== undefined && verifiedAt > 0n ? verifiedAt + maxValidity : undefined;
  const expired = expiresAt !== undefined && BigInt(Math.floor(Date.now() / 1000)) > expiresAt;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display text-white">Compliance Status</h1>
        <p className="text-ink-400 mt-1">Your on-chain KYC tier, as reported by the compliance-check CRE workflow.</p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-trust-500/20 flex items-center justify-center shrink-0">
              <ShieldAlertIcon className="w-5 h-5 text-trust-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Current Tier</h2>
              <p className="text-sm text-ink-400 font-mono">
                {account?.slice(0, 6)}…{account?.slice(-4)}
              </p>
            </div>
          </div>
          {tier !== undefined && <VerificationBadge tier={tier} superUser={isSuperUser} />}
        </div>

        {tier0CapUsd !== undefined && tier1CapUsd !== undefined && (
          <div className="grid grid-cols-3 gap-3 text-center mb-4">
            <div className={`p-3 rounded-lg border ${tier === 0 ? "border-trust-500/40 bg-trust-500/10" : "border-ink-800 bg-ink-950/60"}`}>
              <div className="text-xs text-ink-400 mb-1">Tier 0 · Unverified</div>
              <div className="font-mono text-sm text-ink-100">${tier0CapUsd.toString()} / 30d</div>
            </div>
            <div className={`p-3 rounded-lg border ${tier === 1 ? "border-trust-500/40 bg-trust-500/10" : "border-ink-800 bg-ink-950/60"}`}>
              <div className="text-xs text-ink-400 mb-1">Tier 1 · Basic KYC</div>
              <div className="font-mono text-sm text-ink-100">${tier1CapUsd.toString()} / 30d</div>
            </div>
            <div className={`p-3 rounded-lg border ${tier === 2 ? "border-trust-500/40 bg-trust-500/10" : "border-ink-800 bg-ink-950/60"}`}>
              <div className="text-xs text-ink-400 mb-1">Tier 2 · Enhanced</div>
              <div className="font-mono text-sm text-ink-100">Uncapped</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Verified At</div>
            <div className="font-mono text-sm text-ink-100">{verifiedAt !== undefined ? formatTimestamp(verifiedAt) : "…"}</div>
          </div>
          <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
            <div className="text-xs text-ink-400 mb-1">Verdict Expires</div>
            <div className={`font-mono text-sm ${expired ? "text-warning-400" : "text-ink-100"}`}>
              {expiresAt !== undefined ? formatTimestamp(expiresAt) : "never verified"}
            </div>
          </div>
        </div>

        {isSuperUser && (
          <p className="mb-3 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-xs text-warning-400">
            This wallet is a <strong>super user</strong>: the platform admin has exempted it from the volume caps, so it
            is treated as top tier (uncapped) when funding. Its on-chain KYC tier is {onChainTier ?? "…"}, unchanged.
          </p>
        )}

        <p className="text-xs text-ink-500 mt-3">
          Caps are USD-equivalent, assuming a ~1:1 stablecoin peg — a trade in a non-stablecoin token would need its
          own USD-conversion step for these numbers to mean anything. A verdict older than the validity window
          reads back as tier 0, same as never having been verified at all.
        </p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-white mb-2">Your Rolling Volume</h2>
        <p className="text-sm text-ink-400 mb-3">
          What EscrowFactory has recorded against you in the current 30-day bucket — checked against your tier's cap
          every time you call <code className="text-trust-400">fund()</code>.
        </p>
        <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
          <div className="text-2xl font-bold font-mono text-white">{periodVolume?.toString() ?? "…"}</div>
          <div className="text-xs text-ink-500 mt-1">
            Raw token units, summed across every escrow token you&apos;ve funded with this period — not USD, and not
            comparable across different tokens or decimals. Meaningful only if you consistently trade one stablecoin.
          </div>
        </div>
      </div>

      <div className="bg-ink-900 border border-warning-500/30 rounded-xl p-6">
        <h2 className="font-semibold text-white mb-2">Why this is (usually) Tier 0</h2>
        <p className="text-sm text-ink-400">
          Tier is set exclusively by <code className="text-trust-400">ComplianceConsumer.onReport()</code>, which
          only accepts calls from the real Chainlink KeystoneForwarder relaying a live compliance-check CRE
          workflow&apos;s verdict — this frontend has no KYC provider wired up and cannot raise your tier itself.
          Unless a real workflow run has reported a verdict for this exact wallet, you&apos;ll stay at tier 0
          indefinitely, which is a real (if low) cap rather than a broken feature.
        </p>
      </div>
    </div>
  );
}
