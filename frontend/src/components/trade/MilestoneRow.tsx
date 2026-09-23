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
import { formatTimeLeft, useNow } from "@/lib/countdown";

export function MilestoneRow({
  vault,
  index,
  amount,
  status,
  docHash,
  buyer,
  seller,
  funded,
  hasArbiter,
  decimals,
  symbol,
  settlementProposal,
  label,
  milestoneDeadline,
  deliveryDeadline,
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
  hasArbiter: boolean;
  decimals: number;
  symbol: string;
  settlementProposal?: { sellerBps: number; proposedBy: Address; active: boolean };
  label?: string;
  milestoneDeadline?: bigint;
  deliveryDeadline?: bigint;
  onSuccess: () => void;
}) {
  const { address: account } = useAccount();
  const now = useNow();
  const [docText, setDocText] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [settlePercent, setSettlePercent] = useState(50);

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
      setShowSettle(false);
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
              <span className="font-semibold text-white">{label ? label : `Milestone #${index + 1}`}</span>
              <StatusBadge status={statusLabel} size="sm" />
            </div>
            <div className="text-sm text-ink-400 mt-1 font-mono">
              {label && <span className="text-ink-500">#{index + 1} · </span>}
              {formatToken(amount, decimals, symbol)}
            </div>
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
              <p className="text-xs text-ink-500 mt-2">
                {hasArbiter
                  ? "Waiting on the arbiter to resolve this — see Arbiter Panel below."
                  : "This trade has no arbiter — propose a mutual settlement below to resolve it."}
              </p>
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

      {status === 0 &&
        deliveryDeadline !== undefined &&
        deliveryDeadline > 0n &&
        (() => {
          const timeLeft = formatTimeLeft(deliveryDeadline, now);
          if (!timeLeft) return null;
          return (
            <div
              className={`flex items-center justify-between gap-3 flex-wrap p-3 rounded-lg mb-3 ${
                timeLeft.expired ? "bg-danger-500/10 border border-danger-500/30" : "bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]"
              }`}
            >
              <p className={`text-xs ${timeLeft.expired ? "text-danger-400" : "text-ink-400"}`}>
                {timeLeft.expired
                  ? "Delivery window passed — anyone can refund the buyer for this milestone now."
                  : `Seller must submit docs within ${timeLeft.label}, or it can be refunded to the buyer.`}
              </p>
              {timeLeft.expired && (
                <button
                  onClick={() =>
                    writeContract({ address: vault, abi: escrowVaultAbi, functionName: "expireDelivery", args: [BigInt(index)] })
                  }
                  disabled={isPending || isConfirming}
                  className="btn-press px-3 py-1.5 rounded-lg bg-danger-600 hover:bg-danger-500 disabled:opacity-40 text-white text-xs font-semibold shrink-0"
                >
                  Refund Buyer
                </button>
              )}
            </div>
          );
        })()}

      {status === 1 &&
        milestoneDeadline !== undefined &&
        milestoneDeadline > 0n &&
        (() => {
          const timeLeft = formatTimeLeft(milestoneDeadline, now);
          if (!timeLeft) return null;
          return (
            <div
              className={`flex items-center justify-between gap-3 flex-wrap p-3 rounded-lg mb-3 ${
                timeLeft.expired ? "bg-warning-500/10 border border-warning-500/30" : "bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]"
              }`}
            >
              <p className={`text-xs ${timeLeft.expired ? "text-warning-400" : "text-ink-400"}`}>
                {timeLeft.expired
                  ? "Confirmation window passed — silence counts as accepted delivery, so anyone can release this to the seller now."
                  : `Buyer must confirm within ${timeLeft.label}, or it releases to the seller.`}
              </p>
              {timeLeft.expired && (
                <button
                  onClick={() =>
                    writeContract({ address: vault, abi: escrowVaultAbi, functionName: "expireMilestone", args: [BigInt(index)] })
                  }
                  disabled={isPending || isConfirming}
                  className="btn-press px-3 py-1.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:opacity-40 text-white text-xs font-semibold shrink-0"
                >
                  Release to Seller
                </button>
              )}
            </div>
          );
        })()}

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

      {funded && (isBuyer || isSeller) && (status === 0 || status === 1 || status === 3) && (
        <div className="pt-3 mt-1 border-t border-ink-800/60 space-y-3">
          {settlementProposal?.active &&
            (() => {
              const isProposer = settlementProposal.proposedBy.toLowerCase() === account?.toLowerCase();
              return (
                <div className="p-3 rounded-lg bg-trust-500/10 border border-trust-500/30">
                  <p className="text-sm text-trust-300">
                    {isProposer ? "You proposed" : settlementProposal.proposedBy.toLowerCase() === buyer.toLowerCase() ? "Buyer proposed" : "Seller proposed"}{" "}
                    a mutual settlement:{" "}
                    <span className="font-semibold">
                      {settlementProposal.sellerBps / 100}% to seller / {(10_000 - settlementProposal.sellerBps) / 100}% to buyer
                    </span>
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {isProposer ? (
                      <button
                        onClick={() =>
                          writeContract({
                            address: vault,
                            abi: escrowVaultAbi,
                            functionName: "cancelSettlementProposal",
                            args: [BigInt(index)],
                          })
                        }
                        disabled={isPending || isConfirming}
                        className="btn-press px-3 py-1.5 rounded-lg border border-ink-700 text-ink-400 hover:text-white text-xs font-medium"
                      >
                        Withdraw Proposal
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() =>
                            writeContract({
                              address: vault,
                              abi: escrowVaultAbi,
                              functionName: "acceptSettlement",
                              args: [BigInt(index)],
                            })
                          }
                          disabled={isPending || isConfirming}
                          className="btn-press px-3 py-1.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:opacity-40 text-white text-xs font-semibold"
                        >
                          Accept Settlement
                        </button>
                        {!showSettle && (
                          <button
                            onClick={() => {
                              setSettlePercent(100 - settlementProposal.sellerBps / 100);
                              setShowSettle(true);
                            }}
                            className="btn-press px-3 py-1.5 rounded-lg border border-trust-600/40 text-trust-400 hover:bg-trust-500/10 text-xs font-medium"
                          >
                            Counter-Propose
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

          <div className="flex flex-wrap gap-2">
            {!showDispute && !showSettle && (
              <>
                {!settlementProposal?.active && (
                  <button
                    onClick={() => {
                      setSettlePercent(50);
                      setShowSettle(true);
                    }}
                    className="btn-press px-3 py-1.5 rounded-lg border border-trust-600/40 text-trust-400 hover:bg-trust-500/10 text-xs font-medium"
                  >
                    Propose Mutual Settlement
                  </button>
                )}
                {status !== 3 && hasArbiter && (
                  <button
                    onClick={() => setShowDispute(true)}
                    className="btn-press px-3 py-1.5 rounded-lg border border-ink-700 text-ink-400 hover:border-danger-500/40 hover:text-danger-400 text-xs font-medium"
                  >
                    Raise a Dispute
                  </button>
                )}
              </>
            )}

            {showSettle && (
              <div className="flex gap-3 items-center flex-wrap w-full">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={settlePercent}
                  onChange={(e) => setSettlePercent(Number(e.target.value))}
                  className="flex-1 min-w-[140px] accent-trust-500"
                />
                <span className="text-xs text-ink-300 font-mono w-36 shrink-0">
                  {settlePercent}% seller / {100 - settlePercent}% buyer
                </span>
                <button
                  onClick={() =>
                    writeContract({
                      address: vault,
                      abi: escrowVaultAbi,
                      functionName: "proposeSettlement",
                      args: [BigInt(index), settlePercent * 100],
                    })
                  }
                  disabled={isPending || isConfirming}
                  className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:opacity-40 text-white text-sm font-semibold"
                >
                  {settlementProposal?.active ? "Send Counter-Offer" : "Propose Split"}
                </button>
                <button onClick={() => setShowSettle(false)} className="text-xs text-ink-500 hover:text-ink-300">
                  Cancel
                </button>
              </div>
            )}

            {showDispute && (
              <div className="flex gap-2 items-center flex-wrap w-full">
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

          {settlementProposal?.active && status !== 3 && hasArbiter && (
            <p className="text-xs text-ink-500">Can&apos;t agree? Raising a dispute hands this milestone to the arbiter instead.</p>
          )}
          {!hasArbiter && status !== 3 && (
            <p className="text-xs text-ink-500">No arbiter on this trade — mutual settlement is the only way to resolve a disagreement.</p>
          )}
        </div>
      )}
    </div>
  );
}
