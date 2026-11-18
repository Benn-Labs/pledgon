"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useListingMetadataMap } from "@/hooks/useListingMetadataMap";
import { toast, toastTxError } from "@/lib/toast";
import { LISTING_STATUS } from "@/components/ui/badges";

type ListingTuple = readonly [Address, Address, Address, string, number];

const MIN_REASON = 5;
const MAX_REASON = 200;

/**
 * Admin-only moderation of the marketplace: lists the currently Active
 * listings and lets the Marketplace admin (the EscrowFactory owner, so a
 * multisig when ownership has been transferred to one) take one down with a
 * stated reason. Rendered inside the owner-gated Admin page; the contract
 * enforces the same right (Marketplace.takeDownListing) regardless of this UI.
 *
 * A takedown only stops NEW purchases — escrow vaults already opened from the
 * listing are independent contracts and are not touched.
 */
export function ListingModeration() {
  const marketplace = addresses.marketplace;

  const { data: count, refetch: refetchCount } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listingCount",
    query: { enabled: Boolean(marketplace) },
  });
  const ids = useMemo(() => (count === undefined ? [] : Array.from({ length: Number(count) }, (_, i) => BigInt(i))), [count]);

  const {
    data: listingResults,
    isLoading,
    refetch: refetchListings,
  } = useReadContracts({
    contracts: ids.map((id) => ({ address: marketplace, abi: marketplaceAbi, functionName: "listings" as const, args: [id] as const })),
    query: { enabled: Boolean(marketplace) && ids.length > 0 },
  });
  const titles = useListingMetadataMap(
    marketplace,
    useMemo(() => ids.map((id) => Number(id)), [ids]),
  );

  const active = useMemo(() => {
    const rows: { id: bigint; listing: ListingTuple }[] = [];
    ids.forEach((id, i) => {
      const listing = listingResults?.[i]?.result as ListingTuple | undefined;
      if (listing && LISTING_STATUS[listing[4]] === "Active") rows.push({ id, listing });
    });
    return rows;
  }, [ids, listingResults]);

  const [target, setTarget] = useState<{ id: bigint; title: string } | null>(null);
  const [reason, setReason] = useState("");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  const busy = isPending || isConfirming;

  // A confirmed takedown hides the dialog (derived below from `isSuccess`, so no
  // setState-in-effect); the next "Take down…" click reset()s the write state.
  useEffect(() => {
    if (!isSuccess) return;
    toast("Listing taken down", "success");
    refetchCount();
    refetchListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch fns are stable; fire once per confirmed tx
  }, [isSuccess]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  if (!marketplace) return null;

  const reasonTrimmed = reason.trim();
  const reasonValid = reasonTrimmed.length >= MIN_REASON && reasonTrimmed.length <= MAX_REASON;

  return (
    <div className="bg-ink-900 border border-danger-500/30 rounded-xl p-6 mb-6">
      <h2 className="font-semibold text-ink-50 mb-1">Marketplace Moderation</h2>
      <p className="text-xs text-ink-500 mb-4">
        Take down a listing that breaches the platform&apos;s terms (malicious, fraudulent, inappropriate). This only stops
        new purchases — escrow trades already opened from the listing are separate contracts and are not touched. The
        reason you enter is published on-chain.
      </p>

      {isLoading ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-ink-400">No active listings.</p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800">
          {active.map(({ id, listing }) => {
            const title = titles.get(Number(id))?.title || listing[3] || `Listing #${id}`;
            return (
              <li key={id.toString()} className="flex items-center gap-3 p-3">
                <span className="font-mono text-xs text-ink-500 shrink-0">#{id.toString()}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/marketplace/${id}`} className="block truncate text-sm text-ink-50 hover:text-trust-400">
                    {title}
                  </Link>
                  <span className="font-mono text-xs text-ink-500">
                    {listing[0].slice(0, 6)}…{listing[0].slice(-4)}
                  </span>
                </div>
                <button
                  onClick={() => {
                    reset();
                    setTarget({ id, title });
                    setReason("");
                  }}
                  disabled={busy}
                  className="btn-press shrink-0 rounded-lg border border-danger-500/40 px-3 py-1.5 text-xs font-semibold text-danger-400 hover:bg-danger-500/10 disabled:opacity-50"
                >
                  Take down…
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {target && !isSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
            <h3 className="font-semibold text-ink-50">Take down listing #{target.id.toString()}?</h3>
            <p className="mt-1 truncate text-sm text-ink-400">{target.title}</p>
            <label className="mt-4 block text-xs font-medium text-ink-300" htmlFor="takedown-reason">
              Reason (published on-chain)
            </label>
            <textarea
              id="takedown-reason"
              rows={3}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Counterfeit goods — breach of terms §4"
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-200 focus:border-danger-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-ink-500">
              {reasonTrimmed.length}/{MAX_REASON} — at least {MIN_REASON} characters. Irreversible: the seller must create
              a new listing.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setTarget(null)}
                disabled={busy}
                className="btn-press flex-1 rounded-lg border border-ink-700 bg-ink-800 py-2.5 text-sm font-semibold text-ink-50 hover:bg-ink-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  writeContract({
                    address: marketplace,
                    abi: marketplaceAbi,
                    functionName: "takeDownListing",
                    args: [target.id, reasonTrimmed],
                  })
                }
                disabled={!reasonValid || busy}
                className="btn-press flex-1 rounded-lg bg-danger-600 py-2.5 text-sm font-semibold text-white hover:bg-danger-500 disabled:cursor-not-allowed disabled:bg-ink-700"
              >
                {busy ? "Submitting…" : "Take down"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
