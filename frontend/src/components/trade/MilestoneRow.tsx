"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { keccak256, toHex, zeroHash } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { formatToken } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useDisputeReason } from "@/hooks/useDisputeReason";
import { StatusBadge, MILESTONE_STATUS } from "@/components/ui/badges";

export function MilestoneRow({
  vault,
  index,
  amount,
  status,
  docHash,
  buyer,
  seller,
  funded,
  decimals,
  symbol,
  onSuccess,
}: {
  vault: Address;
  index: number;
  amount: bigint;
  status: number;
  docHash: `0x${string}`;
  buyer: Address;
  seller: Address;
  funded: boolean;
  decimals: number;
  symbol: string;
  onSuccess: () => void;
}) {
  const { address: account } = useAccount();
  const [docText, setDocText] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);

  const { data: dispute, isLoading: disputeLoading } = useDisputeReason(vault, index, status === 3);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  const isBuyer = account?.toLowerCase() === buyer.toLowerCase();
  const isSeller = account?.toLowerCase() === seller.toLowerCase();

  useEffect(() => {
    if (isSuccess) {
      onSuccess();
      setShowDispute(false);
    }
  }, [isSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  const statusLabel = MILESTONE_STATUS[status];
  const isDisputed = status === 3;
  const isReleased = status === 2;

  return (
    <div className={`border rounded-xl p-5 ${isDisputed ? "bg-danger-500/5 border-danger-500/30" : "border-ink-700 bg-ink-800/30"}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              isReleased ? "bg-success-500/20" : isDisputed ? "bg-danger-500/20" : "bg-ink-700"
            }`}
          >
            {isReleased ? (
              <svg className="w-5 h-5 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <span className={`font-mono text-sm ${isDisputed ? "text-danger-400" : "text-ink-300"}`}>{index + 1}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">Milestone #{index + 1}</span>
              <StatusBadge status={statusLabel} size="sm" />
            </div>
            <div className="text-sm text-ink-400 mt-1 font-mono">{formatToken(amount, decimals, symbol)}</div>
          </div>
        </div>
        {docHash !== zeroHash && (
          <div className="text-right">
            <div className="text-xs text-ink-500 mb-1">Documentation</div>
            <div className="addr text-trust-400 font-mono text-xs">
              {docHash.slice(0, 10)}…{docHash.slice(-6)}
            </div>
          </div>
        )}
      </div>

      {isDisputed && (
        <div className="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 mb-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-danger-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              {dispute ? (
                <>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-semibold text-danger-400">
                      Disputed by {dispute.raisedBy.toLowerCase() === buyer.toLowerCase() ? "buyer" : "seller"} (
                      {dispute.raisedBy.slice(0, 6)}…{dispute.raisedBy.slice(-4)})
                    </span>
                  </div>
                  <p className="text-sm text-ink-300">{dispute.reason}</p>
                </>
              ) : disputeLoading ? (
                <p className="text-sm text-ink-400">Loading dispute details…</p>
              ) : (
                <p className="text-sm text-ink-400">
                  Dispute reason unavailable on this RPC (log history beyond its free-tier range) — still a real,
                  resolvable dispute.
                </p>
              )}
              <p className="text-xs text-ink-500 mt-2">Waiting on the arbiter to resolve this — see Arbiter Panel below.</p>
            </div>
          </div>
        </div>
      )}

      {funded && isSeller && status === 0 && (
        <div className="flex gap-2 items-center flex-wrap">
          <input
            className="flex-1 min-w-[180px] bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            placeholder="Delivery doc description or hash"
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
          />
          <button
            onClick={() =>
              writeContract({
                address: vault,
                abi: escrowVaultAbi,
                functionName: "submitMilestoneDocs",
                args: [BigInt(index), keccak256(toHex(docText))],
              })
            }
            disabled={!docText || isPending || isConfirming}
            className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white text-sm font-semibold"
          >
            Submit Documentation
          </button>
        </div>
      )}

      {funded && isBuyer && status === 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              writeContract({ address: vault, abi: escrowVaultAbi, functionName: "confirmMilestone", args: [BigInt(index)] })
            }
            disabled={isPending || isConfirming}
            className="btn-press px-4 py-2 rounded-lg bg-success-600 hover:bg-success-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white text-sm font-semibold"
          >
            Confirm Delivery
          </button>
          <button
            onClick={() =>
              writeContract({ address: vault, abi: escrowVaultAbi, functionName: "releaseMilestoneViaDon", args: [BigInt(index)] })
            }
            disabled={isPending || isConfirming}
            className="btn-press px-4 py-2 rounded-lg bg-ink-700 hover:bg-ink-600 disabled:opacity-40 text-ink-300 text-sm font-medium"
          >
            Check DON Confirmation
          </button>
        </div>
      )}

      {funded && (isBuyer || isSeller) && (status === 0 || status === 1) && (
        <div className="pt-3">
          {!showDispute ? (
            <button onClick={() => setShowDispute(true)} className="text-xs text-ink-500 hover:text-danger-400 underline">
              Something wrong? Dispute this milestone
            </button>
          ) : (
            <div className="flex gap-2 items-center flex-wrap">
              <input
                className="flex-1 min-w-[180px] bg-ink-800 border border-danger-500/40 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-danger-500"
                placeholder="Dispute reason"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                autoFocus
              />
              <button
                onClick={() =>
                  writeContract({
                    address: vault,
                    abi: escrowVaultAbi,
                    functionName: "disputeMilestone",
                    args: [BigInt(index), disputeReason],
                  })
                }
                disabled={!disputeReason || isPending || isConfirming}
                className="btn-press px-4 py-2 rounded-lg border border-danger-500/30 text-danger-400 hover:bg-danger-500/10 disabled:opacity-40 text-sm font-medium"
              >
                Raise Dispute
              </button>
              <button onClick={() => setShowDispute(false)} className="text-xs text-ink-500 hover:text-ink-300">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
