"use client";

import { useEffect, useState } from "react";
import { formatEther, formatUnits, parseUnits, type Address } from "viem";
import { useReadContract, useWaitForTransactionReceipt, useWriteContract, useBlock } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { toastTxError } from "@/lib/toast";

const QUANTITY_DECIMALS = 18; // matches Marketplace.QUANTITY_SCALE

/**
 * On-chain seller management for a listing: restock supply, re-price the
 * remaining quantity, and renew the monthly validity window (each renewal
 * costs the current listing fee, in native ETH). All three are gated to the
 * listing's seller on-chain — this UI just wires the calls. Only rendered
 * for Active listings: Sold/Cancelled/TakenDown are terminal on-chain, so
 * the contract would reject any of these calls there anyway.
 */
export function SellerListingControls({
  marketplaceAddress,
  listingId,
  unitPrice,
  decimals,
  symbol,
  onChanged,
}: {
  marketplaceAddress: Address;
  listingId: bigint;
  unitPrice: bigint;
  decimals: number;
  symbol: string;
  onChanged: () => void;
}) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const { data: listingFee } = useReadContract({
    address: marketplaceAddress,
    abi: marketplaceAbi,
    functionName: "listingFee",
  });
  const { data: expiresAt } = useReadContract({
    address: marketplaceAddress,
    abi: marketplaceAbi,
    functionName: "listingExpiry",
    args: [listingId],
  });

  const [restockInput, setRestockInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  // Expiry is an on-chain timestamp, so the chain's own clock decides — no
  // wall-clock reads in render (react-hooks/purity) and no setState effects.
  const { data: latestBlock } = useBlock({ query: { enabled: true } });

  const busy = isPending || isConfirming;
  const expired =
    latestBlock !== undefined && expiresAt !== undefined && latestBlock.timestamp > expiresAt;

  let restockQuantity: bigint | undefined;
  try {
    restockQuantity = restockInput.trim() ? parseUnits(restockInput, QUANTITY_DECIMALS) : undefined;
  } catch {
    restockQuantity = undefined;
  }

  let newUnitPrice: bigint | undefined;
  try {
    newUnitPrice = priceInput.trim() ? parseUnits(priceInput, decimals) : undefined;
  } catch {
    newUnitPrice = undefined;
  }
  const priceChanged = newUnitPrice !== undefined && newUnitPrice > 0n && newUnitPrice !== unitPrice;

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  useEffect(() => {
    if (!hash) return;
    // A confirmed management tx changed on-chain state — let the parent refetch.
    const t = setTimeout(onChanged, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per confirmed hash
  }, [hash]);

  return (
    <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Manage listing</h3>
        {expiresAt !== undefined && (
          <span className={`text-xs ${expired ? "text-danger-400" : "text-ink-500"}`}>
            {expired
              ? "Expired — renew to accept purchases again"
              : `Valid until ${new Date(Number(expiresAt) * 1000).toLocaleDateString()}`}
          </span>
        )}
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-ink-400 mb-1">Add supply ({symbol} units of quantity)</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            placeholder="0"
            value={restockInput}
            onChange={(e) => setRestockInput(e.target.value)}
          />
        </div>
        <button
          onClick={() => restockQuantity !== undefined && restockQuantity > 0n && writeContract({
            address: marketplaceAddress,
            abi: marketplaceAbi,
            functionName: "restockListing",
            args: [listingId, restockQuantity],
          })}
          disabled={busy || restockQuantity === undefined || restockQuantity === 0n}
          className="btn-press px-3 py-2 rounded-lg bg-ink-800 hover:bg-trust-600 border border-ink-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold"
        >
          {busy && isPending ? "Restocking…" : "Restock"}
        </button>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-ink-400 mb-1">
            New unit price ({formatUnits(unitPrice, decimals)} {symbol} today)
          </label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            placeholder={formatUnits(unitPrice, decimals)}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
          />
        </div>
        <button
          onClick={() => newUnitPrice !== undefined && writeContract({
            address: marketplaceAddress,
            abi: marketplaceAbi,
            functionName: "updatePrice",
            args: [listingId, newUnitPrice],
          })}
          disabled={busy || !priceChanged}
          className="btn-press px-3 py-2 rounded-lg bg-ink-800 hover:bg-trust-600 border border-ink-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold"
        >
          {busy && isPending ? "Updating…" : "Update price"}
        </button>
      </div>

      <button
        onClick={() =>
          writeContract({
            address: marketplaceAddress,
            abi: marketplaceAbi,
            functionName: "renewListing",
            args: [listingId],
            value: listingFee ?? 0n,
          })
        }
        disabled={busy}
        className="btn-press w-full py-2 rounded-lg bg-ink-800 hover:bg-trust-600 border border-ink-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold"
      >
        {busy && isPending
          ? "Renewing…"
          : listingFee !== undefined && listingFee > 0n
            ? `Renew for another month (${formatEther(listingFee)} ETH)`
            : "Renew for another month"}
      </button>

      <p className="text-xs text-ink-500">
        Restocking and re-pricing only affect future purchases — trades already opened keep their terms. Renewing early
        extends from the current expiry, not from today.
      </p>
    </div>
  );
}
