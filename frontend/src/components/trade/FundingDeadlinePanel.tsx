"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { toast } from "@/lib/toast";
import { formatTimeLeft, useNow } from "@/lib/countdown";

/**
 * Shown whenever a funding deadline is configured and the trade isn't funded
 * yet — visible to anyone, not just the buyer, since `expireFunding` is
 * permissionless: whoever notices the deadline passed (buyer, seller, or the
 * trade-expiry cron) can trigger the seller's bond refund. Renders nothing
 * once funded/cancelled or when this trade has no funding deadline at all.
 */
export function FundingDeadlinePanel({
  vault,
  fundingDeadline,
  funded,
  cancelled,
  onSuccess,
}: {
  vault: Address;
  fundingDeadline: bigint;
  funded: boolean;
  cancelled: boolean;
  onSuccess: () => void;
}) {
  const now = useNow();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  useEffect(() => {
    if (isSuccess) {
      toast("Funding deadline expired — bond returned to seller, trade cancelled", "success");
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  if (cancelled || funded) return null;
  const timeLeft = formatTimeLeft(fundingDeadline, now);
  if (!timeLeft) return null;

  return (
    <div className={`bg-ink-900 border rounded-xl p-6 mb-6 ${timeLeft.expired ? "border-danger-500/30" : "border-ink-800"}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-white mb-1">Funding Deadline</h2>
          <p className={`text-sm ${timeLeft.expired ? "text-danger-400" : "text-ink-400"}`}>
            {timeLeft.expired
              ? "Deadline passed — the seller's bond can now be reclaimed and the trade cancelled."
              : `The buyer must fund within ${timeLeft.label}, or the trade cancels and the bond returns to the seller.`}
          </p>
        </div>
        {timeLeft.expired && (
          <button
            onClick={() => writeContract({ address: vault, abi: escrowVaultAbi, functionName: "expireFunding" })}
            disabled={isPending || isConfirming}
            className="btn-press px-4 py-2 rounded-lg bg-danger-600 hover:bg-danger-500 disabled:opacity-40 text-white text-sm font-semibold shrink-0"
          >
            {isPending || isConfirming ? "Reclaiming…" : "Reclaim Bond"}
          </button>
        )}
      </div>
    </div>
  );
}
