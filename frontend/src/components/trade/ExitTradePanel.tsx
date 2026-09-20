"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowVaultAbi } from "@/generated/contracts";
import { toast } from "@/lib/toast";

/**
 * Pre-funding: either party can walk away unilaterally — nothing but the
 * seller's own bond is at stake yet. Once funded, real money from both
 * sides is locked, so the only escape is mutual: propose/accept a full
 * trade exit, refunding whatever's still open to the buyer and any bond
 * back to the seller. This is the fallback for "funded but stuck" when
 * there's no DON and the parties can't agree milestone-by-milestone — if
 * the other side won't cooperate at all, disputeMilestone + the arbiter
 * remains the unilateral path.
 */
export function ExitTradePanel({
  vault,
  buyer,
  seller,
  funded,
  cancelled,
  exitProposal,
  onSuccess,
}: {
  vault: Address;
  buyer: Address;
  seller: Address;
  funded: boolean;
  cancelled: boolean;
  exitProposal?: { proposedBy: Address; active: boolean };
  onSuccess: () => void;
}) {
  const { address: account } = useAccount();
  const isBuyer = account?.toLowerCase() === buyer.toLowerCase();
  const isSeller = account?.toLowerCase() === seller.toLowerCase();
  const [confirming, setConfirming] = useState(false);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (isSuccess) {
      onSuccess();
      setConfirming(false);
    }
  }, [isSuccess, onSuccess]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  if (cancelled || (!isBuyer && !isSeller)) return null;

  if (!funded) {
    return (
      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-2 text-white">Cancel Trade</h2>
        <p className="text-sm text-ink-400 mb-4">
          Either party can walk away before funding — the seller's bond (if deposited) refunds automatically.
        </p>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="btn-press px-4 py-2 rounded-lg border border-danger-500/40 text-danger-400 hover:bg-danger-500/10 text-sm font-medium"
          >
            Cancel This Trade
          </button>
        ) : (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-sm text-danger-400">This can&apos;t be undone.</span>
            <button
              onClick={() => writeContract({ address: vault, abi: escrowVaultAbi, functionName: "cancelTrade" })}
              disabled={isPending || isConfirming}
              className="btn-press px-4 py-2 rounded-lg bg-danger-600 hover:bg-danger-500 disabled:opacity-40 text-white text-sm font-semibold"
            >
              {isPending || isConfirming ? "Cancelling…" : "Yes, Cancel"}
            </button>
            <button onClick={() => setConfirming(false)} className="text-xs text-ink-500 hover:text-ink-300">
              Never mind
            </button>
          </div>
        )}
      </div>
    );
  }

  const hasActiveProposal = exitProposal?.active ?? false;
  const isProposer = hasActiveProposal && exitProposal!.proposedBy.toLowerCase() === account?.toLowerCase();

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
      <h2 className="font-semibold mb-2 text-white">Exit Trade</h2>
      <p className="text-sm text-ink-400 mb-4">
        If this trade is stuck — no DON, no agreement milestone-by-milestone — either party can propose winding it
        down entirely. Once the other side accepts, every still-open milestone refunds to the buyer and any
        remaining bond returns to the seller.
      </p>

      {hasActiveProposal ? (
        <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30">
          <p className="text-sm text-warning-300 mb-3">
            {isProposer
              ? "You proposed"
              : exitProposal!.proposedBy.toLowerCase() === buyer.toLowerCase()
                ? "Buyer proposed"
                : "Seller proposed"}{" "}
            exiting this trade.
          </p>
          <div className="flex gap-2">
            {!isProposer ? (
              <button
                onClick={() => writeContract({ address: vault, abi: escrowVaultAbi, functionName: "acceptTradeExit" })}
                disabled={isPending || isConfirming}
                className="btn-press px-4 py-2 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:opacity-40 text-white text-sm font-semibold"
              >
                Accept &amp; Exit
              </button>
            ) : (
              <button
                onClick={() => writeContract({ address: vault, abi: escrowVaultAbi, functionName: "cancelTradeExitProposal" })}
                disabled={isPending || isConfirming}
                className="btn-press px-4 py-2 rounded-lg border border-ink-700 text-ink-400 hover:text-white text-sm font-medium"
              >
                Withdraw Proposal
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => writeContract({ address: vault, abi: escrowVaultAbi, functionName: "proposeTradeExit" })}
          disabled={isPending || isConfirming}
          className="btn-press px-4 py-2 rounded-lg border border-warning-500/40 text-warning-400 hover:bg-warning-500/10 text-sm font-medium"
        >
          Propose Exiting This Trade
        </button>
      )}
    </div>
  );
}
