"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import { erc20Abi, maxUint256 } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowVaultAbi, complianceConsumerAbi, escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";
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

  const { data: tier } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "tierOf",
    args: [buyer],
    query: { enabled: Boolean(addresses.complianceConsumer) },
  });

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

  const { writeContract: approve, data: approveHash, isPending: approvePending } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
    query: { enabled: Boolean(approveHash) },
  });

  const { writeContract: fund, data: fundHash, isPending: fundPending, error } = useWriteContract();
  const { isLoading: fundConfirming, isSuccess: fundSuccess } = useWaitForTransactionReceipt({
    hash: fundHash,
    query: { enabled: Boolean(fundHash) },
  });

  useEffect(() => {
    if (approveSuccess) {
      refetchAllowance();
      toast(`Approved ${symbol}`, "success");
    }
  }, [approveSuccess, refetchAllowance, symbol]);

  useEffect(() => {
    if (fundSuccess) {
      toast("Trade funded", "success");
      onSuccess();
    }
  }, [fundSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  if (!isBuyer) return null;

  if (funded) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-white">Funding</h2>
        <p className="text-sm text-success-400">Funded ({formatToken(totalAmount, decimals, symbol)}).</p>
      </div>
    );
  }

  if (bondAmount > 0n && !bondDeposited) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-white">Funding Required</h2>
        <p className="text-sm text-ink-400">Waiting for the seller to deposit the performance bond.</p>
      </div>
    );
  }

  const cap = tier === 0 ? tier0Cap : tier === 1 ? tier1Cap : maxUint256;
  const projectedVolume = (currentVolume ?? 0n) + totalAmount;
  const overCap = currentVolume !== undefined && tier !== undefined && projectedVolume > cap;

  const needsApproval = (allowance ?? 0n) < totalAmount;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
      <h2 className="font-semibold mb-4 text-white">Funding Required</h2>
      <div className="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ink-300">Amount to fund</span>
          <span className="font-mono font-semibold text-ink-100">{formatToken(totalAmount, decimals, symbol)}</span>
        </div>
        {tier !== undefined && currentVolume !== undefined && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-400">Your 30-day volume</span>
            <span className="font-mono text-ink-200">
              {formatToken(currentVolume, decimals, symbol)} / {formatToken(cap, decimals, symbol)}
            </span>
          </div>
        )}
      </div>

      {overCap && <KycGate subject={buyer} />}

      {needsApproval ? (
        <button
          onClick={() => approve({ address: token, abi: erc20Abi, functionName: "approve", args: [vault, totalAmount] })}
          disabled={approvePending || approveConfirming}
          className="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold glow-trust disabled:shadow-none mt-4"
        >
          {approvePending || approveConfirming ? "Approving…" : `Approve ${symbol}`}
        </button>
      ) : (
        <button
          onClick={() => fund({ address: vault, abi: escrowVaultAbi, functionName: "fund" })}
          disabled={overCap || fundPending || fundConfirming}
          className="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold glow-trust disabled:shadow-none mt-4"
        >
          {overCap
            ? "Compliance Limit Exceeded"
            : fundPending || fundConfirming
              ? "Funding…"
              : `Fund ${formatToken(totalAmount, decimals, symbol)}`}
        </button>
      )}
    </div>
  );
}
