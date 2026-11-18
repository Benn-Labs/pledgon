"use client";

import { encodeFunctionData, formatEther, type Abi, type Address } from "viem";
import { useAccount, useEstimateGas, useGasPrice } from "wagmi";

/**
 * A last-look confirmation before a wallet prompt: trade amounts, the ETH
 * value being sent (if any), and an estimated gas cost — so the user isn't
 * seeing this breakdown for the first time inside a wallet popup that's
 * already asking them to sign. Gas is estimated live (useEstimateGas +
 * useGasPrice) against the exact call that will be sent, so it tracks the
 * real contract/args/value rather than a guess.
 */
export function TransactionReviewModal({
  open,
  onCancel,
  onConfirm,
  isSubmitting,
  title,
  lineItems,
  ethValue,
  ethValueLabel = "Fee",
  contract,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  title: string;
  lineItems: { label: string; value: string }[];
  ethValue: bigint;
  ethValueLabel?: string;
  contract?: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };
}) {
  const { address: account } = useAccount();

  let data: `0x${string}` | undefined;
  try {
    data = contract
      ? encodeFunctionData({ abi: contract.abi, functionName: contract.functionName, args: contract.args })
      : undefined;
  } catch {
    data = undefined;
  }

  const { data: gasEstimate } = useEstimateGas({
    to: contract?.address,
    data,
    value: ethValue,
    account,
    query: { enabled: open && Boolean(contract && account && data) },
  });

  const { data: gasPrice } = useGasPrice({ query: { enabled: open } });

  const estimatedFee = gasEstimate !== undefined && gasPrice !== undefined ? gasEstimate * gasPrice : undefined;
  const totalFromWallet = estimatedFee !== undefined ? ethValue + estimatedFee : undefined;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={isSubmitting ? undefined : onCancel}
    >
      <div className="w-full max-w-md bg-ink-900 border border-ink-800 rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-ink-50 text-lg mb-4">{title}</h3>

        <div className="space-y-2 mb-4">
          {lineItems.map((item, i) => (
            <div key={`${item.label}-${i}`} className="flex justify-between items-baseline gap-4 text-sm">
              <span className="text-ink-400">{item.label}</span>
              <span className="font-mono text-ink-100 text-right">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-ink-800 pt-3 space-y-2 mb-5">
          {ethValue > 0n && (
            <div className="flex justify-between items-baseline text-sm">
              <span className="text-ink-400">{ethValueLabel}</span>
              <span className="font-mono text-ink-100">{formatEther(ethValue)} ETH</span>
            </div>
          )}
          <div className="flex justify-between items-baseline text-sm">
            <span className="text-ink-400">Estimated gas</span>
            <span className="font-mono text-ink-100">{estimatedFee !== undefined ? `~${formatEther(estimatedFee)} ETH` : "Estimating…"}</span>
          </div>
          <div className="flex justify-between items-baseline text-sm pt-1 border-t border-ink-800/60">
            <span className="text-ink-300 font-medium">Total from wallet</span>
            <span className="font-mono text-ink-50 font-semibold">{totalFromWallet !== undefined ? `~${formatEther(totalFromWallet)} ETH` : "…"}</span>
          </div>
        </div>

        <p className="text-xs text-ink-500 mb-4">Gas is an estimate — your wallet shows the final amount before you sign.</p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="btn-press flex-1 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-ink-50 font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className="btn-press flex-1 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {isSubmitting ? "Confirm in wallet…" : "Confirm & Sign"}
          </button>
        </div>
      </div>
    </div>
  );
}
