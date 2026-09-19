"use client";

import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useDisputeReason } from "@/hooks/useDisputeReason";

type MilestoneInfo = { index: number; amount: bigint; status: number };

function DisputeResolutionCard({
  vault,
  milestone,
  decimals,
  symbol,
  onSuccess,
}: {
  vault: Address;
  milestone: MilestoneInfo;
  decimals: number;
  symbol: string;
  onSuccess: () => void;
}) {
  const { data: dispute, isLoading: disputeLoading } = useDisputeReason(vault, milestone.index, true);
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (isSuccess) onSuccess();
  }, [isSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  return (
    <div className="p-4 rounded-lg bg-danger-500/5 border border-danger-500/20">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-white">Milestone #{milestone.index + 1}</span>
        <span className="font-mono text-warning-400">{formatToken(milestone.amount, decimals, symbol)}</span>
      </div>
      <p className="text-sm text-ink-300 mb-4">
        {dispute?.reason ??
          (disputeLoading
            ? "Loading dispute reason…"
            : "Dispute reason unavailable on this RPC (log history beyond its free-tier range) — the dispute itself is still real and resolvable below.")}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() =>
            writeContract({
              address: vault,
              abi: escrowVaultAbi,
              functionName: "resolveDispute",
              args: [BigInt(milestone.index), true],
            })
          }
          disabled={isPending || isConfirming}
          className="btn-press flex-1 py-2 rounded-lg bg-success-600 hover:bg-success-500 disabled:opacity-40 text-white text-sm font-semibold"
        >
          Release to Seller
        </button>
        <button
          onClick={() =>
            writeContract({
              address: vault,
              abi: escrowVaultAbi,
              functionName: "resolveDispute",
              args: [BigInt(milestone.index), false],
            })
          }
          disabled={isPending || isConfirming}
          className="btn-press flex-1 py-2 rounded-lg bg-danger-600 hover:bg-danger-500 disabled:opacity-40 text-white text-sm font-semibold"
        >
          Refund Buyer
        </button>
      </div>
    </div>
  );
}

export function ArbiterPanel({
  vault,
  buyer,
  milestones,
  bondAmount,
  bondBalance,
  decimals,
  symbol,
  onSuccess,
}: {
  vault: Address;
  buyer: Address;
  milestones: MilestoneInfo[];
  bondAmount: bigint;
  bondBalance: bigint;
  decimals: number;
  symbol: string;
  onSuccess: () => void;
}) {
  const [slashRecipient, setSlashRecipient] = useState(buyer);
  const disputed = milestones.filter((m) => m.status === 3);
  const hasRefunded = milestones.some((m) => m.status === 4);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (isSuccess) {
      toast("Bond slashed", "success");
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  return (
    <div className="bg-ink-900 border border-warning-500/30 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-warning-500/20 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-warning-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
            />
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-white">Arbiter Panel</h2>
          <p className="text-sm text-ink-400">You have arbiter privileges on this trade</p>
        </div>
      </div>

      {disputed.length > 0 ? (
        <div className="space-y-4">
          {disputed.map((m) => (
            <DisputeResolutionCard
              key={m.index}
              vault={vault}
              milestone={m}
              decimals={decimals}
              symbol={symbol}
              onSuccess={onSuccess}
            />
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-ink-800 text-center">
          <p className="text-sm text-ink-400">No active disputes on this trade</p>
        </div>
      )}

      {bondBalance > 0n && hasRefunded && (
        <div className="mt-4 pt-4 border-t border-ink-800">
          <h3 className="text-sm font-semibold mb-3 text-warning-400">Bond Actions</h3>
          <label className="block text-xs text-ink-400 mb-1">Send slashed bond to</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono text-ink-200 focus:outline-none focus:border-warning-500 mb-3"
            value={slashRecipient}
            onChange={(e) => setSlashRecipient(e.target.value as Address)}
          />
          <button
            onClick={() =>
              writeContract({ address: vault, abi: escrowVaultAbi, functionName: "slashBond", args: [slashRecipient] })
            }
            disabled={!isAddress(slashRecipient) || isPending || isConfirming}
            className="btn-press w-full py-2 rounded-lg border border-warning-500/30 text-warning-400 hover:bg-warning-500/10 disabled:opacity-40 text-sm font-medium"
          >
            Slash Seller Bond ({formatToken(bondAmount, decimals, symbol)})
          </button>
          <p className="text-xs text-ink-500 mt-2">
            Bond slashing is separate from dispute resolution and independent of who it goes to. Use this if the
            seller failed to deliver and should forfeit their bond — defaults to the buyer, but you can send it
            anywhere.
          </p>
        </div>
      )}
    </div>
  );
}
