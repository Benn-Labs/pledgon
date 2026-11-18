"use client";

import type { Address } from "viem";
import { erc20Abi, maxUint256 } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { escrowVaultAbi, escrowFactoryAbi } from "@/generated/contracts";
import { useEffectiveTier } from "@/hooks/useEffectiveTier";
import { addresses } from "@/lib/addresses";
import { formatToken } from "@/lib/format";
import { useTxSequence, type TxStep } from "@/hooks/useTxSequence";
import { TxProgressModal } from "@/components/ui/TxProgressModal";
import { KycGate } from "@/components/KycGate";

export function FundPanel({
  vault,
  buyer,
  token,
  totalAmount,
  bondAmount,
  bondDeposited,
  funded,
  tier0Cap,
  tier1Cap,
  decimals,
  symbol,
  onSuccess,
}: {
  vault: Address;
  buyer: Address;
  token: Address;
  totalAmount: bigint;
  bondAmount: bigint;
  bondDeposited: boolean;
  funded: boolean;
  tier0Cap: bigint;
  tier1Cap: bigint;
  decimals: number;
  symbol: string;
  onSuccess: () => void;
}) {
  const { address: account } = useAccount();
  const isBuyer = account?.toLowerCase() === buyer.toLowerCase();

  // Effective tier: a verified (admin) wallet (owner-exempted) is top tier / uncapped.
  const { tier } = useEffectiveTier(buyer);

  const { data: currentVolume } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "currentPeriodVolume",
    args: [buyer],
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: account ? [account, vault] : undefined,
    query: { enabled: Boolean(account) },
  });

  const sequence = useTxSequence({
    onStepConfirmed: () => refetchAllowance(),
    onDone: () => onSuccess(),
  });

  if (!isBuyer) return null;

  if (funded) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-ink-50">Funding</h2>
        <p className="text-sm text-success-400">Funded ({formatToken(totalAmount, decimals, symbol)}).</p>
      </div>
    );
  }

  if (bondAmount > 0n && !bondDeposited) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-ink-50">Funding Required</h2>
        <p className="text-sm text-ink-400">Waiting for the seller to deposit the performance bond.</p>
      </div>
    );
  }

  const cap = tier === 0 ? tier0Cap : tier === 1 ? tier1Cap : maxUint256;
  const projectedVolume = (currentVolume ?? 0n) + totalAmount;
  const overCap = currentVolume !== undefined && tier !== undefined && projectedVolume > cap;

  const label = formatToken(totalAmount, decimals, symbol);
  const needsApproval = (allowance ?? 0n) < totalAmount;

  // Approve (only when the current allowance doesn't cover the total) then
  // fund run as one sequence: the wallet prompts follow each other
  // automatically, and each step is explained in the progress modal.
  function fundTrade() {
    const fundStep: TxStep = {
      title: `Fund ${label}`,
      description: `Pay ${label} into the escrow vault. Delivery windows start and you confirm each milestone as the seller submits it.`,
      tx: { address: vault, abi: escrowVaultAbi, functionName: "fund" },
    };
    const steps: TxStep[] = needsApproval
      ? [
          {
            title: `Approve ${symbol}`,
            description: `Allow the escrow vault to pull ${label} from your wallet to fund this trade.`,
            tx: { address: token, abi: erc20Abi, functionName: "approve", args: [vault, totalAmount] },
          },
          fundStep,
        ]
      : [fundStep];
    sequence.start("Fund Trade", steps);
  }

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
      <h2 className="font-semibold mb-4 text-ink-50">Funding Required</h2>
      <div className="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ink-300">Amount to fund</span>
          <span className="font-mono font-semibold text-ink-100">{label}</span>
        </div>
        {tier !== undefined && currentVolume !== undefined && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-400">Your 30-day volume</span>
            <span className="font-mono text-ink-200">
              {formatToken(currentVolume, decimals, symbol)} / {cap === maxUint256 ? "Unlimited" : formatToken(cap, decimals, symbol)}
            </span>
          </div>
        )}
      </div>

      {overCap && <KycGate subject={buyer} />}

      <button
        onClick={fundTrade}
        disabled={overCap || sequence.busy}
        className="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold glow-trust disabled:shadow-none mt-4"
      >
        {overCap ? "Compliance Limit Exceeded" : sequence.busy ? "Submitting…" : needsApproval ? `Approve & Fund ${label}` : `Fund ${label}`}
      </button>
      <TxProgressModal
        title={sequence.title}
        steps={sequence.steps}
        index={sequence.index}
        phase={sequence.phase}
        errorMessage={sequence.errorMessage}
        onClose={sequence.close}
      />
    </div>
  );
}
