"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { decodeEventLog, formatEther, formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { marketplaceAbi, escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { TransactionReviewModal } from "@/components/ui/TransactionReviewModal";
import { useToken } from "@/hooks/useToken";
import { formatToken } from "@/lib/format";
import { toast, toastTxError } from "@/lib/toast";
import { StatusBadge, LISTING_STATUS } from "@/components/ui/badges";
import { useListingMetadata } from "@/hooks/useListingMetadata";
import { EditListingMetadata } from "@/components/marketplace/EditListingMetadata";
import { SellerListingControls } from "@/components/marketplace/SellerListingControls";
import { ListingThumbnail } from "@/components/marketplace/ListingThumbnail";
import { DownloadListingTermsButton } from "@/components/marketplace/DownloadListingTermsButton";
import { formatPerUnit, unitShortLabel } from "@/lib/units";

const QUANTITY_DECIMALS = 18; // matches Marketplace.QUANTITY_SCALE

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  // Route params are raw user input — BigInt("abc") throws during render and
  // takes down the whole page, so only plain digits count as a listing ID.
  const listingId = /^\d+$/.test(id) ? BigInt(id) : undefined;
  const router = useRouter();
  const { address: account, isConnected } = useAccount();
  const marketplace = addresses.marketplace;

  const { data: listing, refetch: refetchListing } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listings",
    args: listingId !== undefined ? [listingId] : undefined,
    query: { enabled: Boolean(marketplace) && listingId !== undefined },
  });

  const { data: pricing, refetch: refetchPricing } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listingPricing",
    args: listingId !== undefined ? [listingId] : undefined,
    query: { enabled: Boolean(marketplace) && listingId !== undefined },
  });

  const { data: milestoneBps } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listingMilestoneBps",
    args: listingId !== undefined ? [listingId] : undefined,
    query: { enabled: Boolean(marketplace) && listingId !== undefined },
  });

  const { data: vaultCount, refetch: refetchVaultCount } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listingVaultCount",
    args: listingId !== undefined ? [listingId] : undefined,
    query: { enabled: Boolean(marketplace) && listingId !== undefined },
  });

  const vaultIndices = useMemo(
    () => (vaultCount === undefined ? [] : Array.from({ length: Number(vaultCount) }, (_, i) => i)),
    [vaultCount],
  );

  const { data: vaultResults, refetch: refetchVaults } = useReadContracts({
    contracts: vaultIndices.map((i) => ({
      address: marketplace,
      abi: marketplaceAbi,
      functionName: "listingVaults" as const,
      args: [listingId, BigInt(i)] as const,
    })),
    query: { enabled: Boolean(marketplace) && vaultIndices.length > 0 },
  });
  const vaults = useMemo(
    () => vaultResults?.map((r) => r.result as Address | undefined).filter((v): v is Address => Boolean(v)) ?? [],
    [vaultResults],
  );

  const [seller, arbiter, token, metadataURI, status] = listing ?? [];
  const [totalQuantity, remainingQuantity, unitPrice, bondRatePerUnit] = pricing ?? [];
  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  const { metadata: fetchedMetadata } = useListingMetadata(marketplace, listingId !== undefined ? Number(id) : undefined);
  const [metadata, setMetadata] = useState(fetchedMetadata);
  useEffect(() => {
    setMetadata(fetchedMetadata);
  }, [fetchedMetadata]);

  const [quantityInput, setQuantityInput] = useState("");
  useEffect(() => {
    // Default the buyer's purchase quantity to the full remaining amount
    // once it's known — a buyer who wants less can just edit it down.
    if (remainingQuantity !== undefined && quantityInput === "") {
      setQuantityInput(formatUnits(remainingQuantity, QUANTITY_DECIMALS));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed once, when remainingQuantity first arrives
  }, [remainingQuantity]);

  let purchaseQuantity: bigint | undefined;
  try {
    purchaseQuantity = quantityInput.trim() ? parseUnits(quantityInput, QUANTITY_DECIMALS) : undefined;
  } catch {
    purchaseQuantity = undefined;
  }
  const quantityValid =
    purchaseQuantity !== undefined &&
    purchaseQuantity > 0n &&
    remainingQuantity !== undefined &&
    purchaseQuantity <= remainingQuantity;

  const { data: preview } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "previewPurchase",
    args: listingId !== undefined && purchaseQuantity !== undefined ? [listingId, purchaseQuantity] : undefined,
    query: { enabled: Boolean(marketplace) && listingId !== undefined && quantityValid && status === 0 },
  });
  const [previewAmounts, previewBond, previewTotal] = preview ?? [];

  const { data: vaultCreationFee } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "vaultCreationFee",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const [showReview, setShowReview] = useState(false);
  const [showDelist, setShowDelist] = useState(false);
  // Which action owns the in-flight transaction, so only its button shows a busy label.
  const [action, setAction] = useState<"purchase" | "delist" | null>(null);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: marketplaceAbi, ...log });
        if (decoded.eventName === "ListingCancelled") {
          toast("Listing delisted — it no longer accepts purchases", "success");
          refetchListing();
          return;
        }
        if (decoded.eventName === "ListingPurchased") {
          toast("Escrow vault opened", "success");
          refetchPricing();
          refetchVaultCount();
          refetchVaults();
          router.push(`/escrow/${decoded.args.vault}`);
          return;
        }
      } catch {
        // not a Marketplace event, skip
      }
    }
  }, [receipt, router, refetchListing, refetchPricing, refetchVaultCount, refetchVaults]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  if (!marketplace) return <p className="text-sm text-ink-400">Marketplace address not configured.</p>;
  if (listingId === undefined) {
    return (
      <div className="fade-in max-w-lg mx-auto text-center py-16">
        <h1 className="text-xl font-display text-ink-50 mb-2">Listing not found</h1>
        <p className="text-sm text-ink-400 mb-6">
          <code className="font-mono text-xs">{id}</code> isn&apos;t a valid listing ID — listings are numbered, so the
          URL should look like <code className="font-mono text-xs">/marketplace/1</code>.
        </p>
        <Link
          href="/marketplace"
          className="btn-press inline-block px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-ink-50 text-sm font-semibold"
        >
          Back to Marketplace
        </Link>
      </div>
    );
  }
  if (!listing || !pricing) return <p className="text-sm text-ink-400">Loading…</p>;

  const isSeller = account && seller && account.toLowerCase() === seller.toLowerCase();
  const isArbiter = account && arbiter && account.toLowerCase() === arbiter.toLowerCase();
  const isActive = status === 0;
  const remainingFraction =
    totalQuantity !== undefined && totalQuantity > 0n ? Number(remainingQuantity ?? 0n) / Number(totalQuantity) : 0;

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <Link href="/marketplace" className="flex items-center gap-2 text-ink-400 hover:text-ink-50 mb-6 w-fit">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-ink-900 border border-ink-800 rounded-xl overflow-hidden">
            {metadata.thumbnailUrl && <ListingThumbnail key={metadata.thumbnailUrl} url={metadata.thumbnailUrl} className="w-full h-56" />}
            <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <StatusBadge status={LISTING_STATUS[status ?? 0]} />
              <span className="text-sm text-ink-500 font-mono">Listing #{id}</span>
            </div>
            <h1 className="text-3xl font-display mb-2 text-ink-50">{metadata.title || metadataURI || `Listing #${id}`}</h1>
            {metadata.description && <p className="text-sm text-ink-300 mb-4">{metadata.description}</p>}
            {(metadata.terms.category || metadata.terms.location || metadata.terms.conditionNotes) && (
              <div className="flex flex-wrap gap-2 mb-4">
                {metadata.terms.category && (
                  <span className="px-2.5 py-1 rounded-full bg-ink-800 border border-ink-700 text-xs text-ink-300">
                    {metadata.terms.category}
                  </span>
                )}
                {metadata.terms.location && (
                  <span className="px-2.5 py-1 rounded-full bg-ink-800 border border-ink-700 text-xs text-ink-300">
                    📍 {metadata.terms.location}
                  </span>
                )}
                {metadata.terms.conditionNotes && (
                  <span className="px-2.5 py-1 rounded-full bg-ink-800 border border-ink-700 text-xs text-ink-300">
                    {metadata.terms.conditionNotes}
                  </span>
                )}
              </div>
            )}

            {tokenReady && decimals !== undefined && totalQuantity !== undefined && (
              <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-ink-400">Unit Price</span>
                  <span className="font-mono text-ink-100">
                    {formatPerUnit(formatToken(unitPrice ?? 0n, decimals, symbol), metadata.terms.unit)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-ink-400">Available</span>
                  <span className="font-mono text-ink-100">
                    {formatUnits(remainingQuantity ?? 0n, QUANTITY_DECIMALS)} / {formatUnits(totalQuantity, QUANTITY_DECIMALS)}{" "}
                    {unitShortLabel(metadata.terms.unit)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
                  <div
                    className="h-full bg-trust-500"
                    style={{ width: `${Math.min(100, Math.max(0, remainingFraction * 100))}%` }}
                  />
                </div>
              </div>
            )}

            {marketplace && token && seller && arbiter && symbol && decimals !== undefined && pricing && milestoneBps && status !== undefined && (
              <div className="mb-4">
                <DownloadListingTermsButton
                  marketplace={marketplace}
                  listingId={Number(id)}
                  seller={seller}
                  arbiter={arbiter}
                  token={token}
                  symbol={symbol}
                  decimals={decimals}
                  status={status}
                  metadataURI={metadataURI ?? ""}
                  metadata={metadata}
                  pricing={pricing}
                  milestoneBps={milestoneBps}
                />
              </div>
            )}

            {isSeller && marketplace && (
              <div className="mb-4">
                <EditListingMetadata
                  marketplaceAddress={marketplace}
                  listingId={Number(id)}
                  metadata={metadata}
                  onSaved={setMetadata}
                  milestoneCount={milestoneBps?.length ?? 0}
                />
              </div>
            )}
            {isSeller && marketplace && listingId !== undefined && isActive && tokenReady && decimals !== undefined && (
              <div className="mb-4">
                <SellerListingControls
                  marketplaceAddress={marketplace}
                  listingId={listingId}
                  unitPrice={unitPrice ?? 0n}
                  decimals={decimals}
                  symbol={symbol ?? ""}
                  onChanged={() => {
                    refetchListing();
                    refetchPricing();
                  }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                <div className="text-xs text-ink-400 mb-1">Seller</div>
                <span className="addr text-ink-200 font-mono text-xs">
                  {seller?.slice(0, 6)}…{seller?.slice(-4)}
                </span>
              </div>
              <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                <div className="text-xs text-ink-400 mb-1">Arbiter</div>
                <span className="addr text-ink-200 font-mono text-xs">
                  {arbiter?.slice(0, 6)}…{arbiter?.slice(-4)}
                </span>
              </div>
            </div>

            {milestoneBps && milestoneBps.length > 0 && (
              <>
                <h3 className="font-semibold mb-4 text-ink-50">Milestone Payout Split</h3>
                <p className="text-xs text-ink-500 -mt-2 mb-4">
                  Percentages of whatever your purchase totals — pick a quantity in the panel to see the actual
                  amounts.
                </p>
                <div className="space-y-3">
                  {milestoneBps.map((bps, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-ink-800/30 border border-ink-700/50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-ink-700 flex items-center justify-center text-sm font-mono text-ink-300 shrink-0">
                          {i + 1}
                        </div>
                        <div className="text-sm text-ink-400">
                          {metadata.terms.milestoneLabels?.[i] || `Milestone ${i + 1} of ${milestoneBps.length}`}
                        </div>
                      </div>
                      <div className="text-right">
                        {tokenReady && decimals !== undefined && previewAmounts?.[i] !== undefined ? (
                          <div className="font-mono font-semibold text-ink-100">
                            {formatToken(previewAmounts[i], decimals, symbol)}
                          </div>
                        ) : null}
                        <div className="text-xs text-ink-500">{(bps / 100).toFixed(2)}% of total</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {vaults.length > 0 && (
              <div className="mt-6 pt-6 border-t border-ink-800">
                <h3 className="font-semibold mb-3 text-ink-50">Trades From This Listing ({vaults.length})</h3>
                <div className="space-y-2">
                  {vaults.map((v) => (
                    <Link
                      key={v}
                      href={`/escrow/${v}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-ink-800/30 border border-ink-700/50 hover:border-trust-500/40 text-sm"
                    >
                      <span className="addr text-ink-300 font-mono text-xs">
                        {v.slice(0, 6)}…{v.slice(-4)}
                      </span>
                      <span className="text-trust-400">View trade →</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 lg:sticky lg:top-24">
            {isActive && tokenReady && decimals !== undefined && (
              <div className="mb-4">
                <label className="block text-xs text-ink-400 mb-2">
                  Quantity to purchase ({unitShortLabel(metadata.terms.unit)})
                </label>
                <input
                  type="number"
                  className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                />
                {!quantityValid && quantityInput.trim() !== "" && (
                  <p className="text-xs text-danger-400 mt-1">
                    Must be more than 0 and at most {formatUnits(remainingQuantity ?? 0n, QUANTITY_DECIMALS)} available.
                  </p>
                )}
              </div>
            )}

            {tokenReady && decimals !== undefined && (
              <>
                <div className="text-center mb-6">
                  <div className="text-3xl font-bold font-mono text-ink-50">
                    {previewTotal !== undefined ? formatToken(previewTotal, decimals) : "—"}
                  </div>
                  <div className="text-ink-400">{symbol}</div>
                </div>
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-400">Seller Bond (this purchase)</span>
                    <span className="font-mono text-warning-400">
                      {previewBond !== undefined ? formatToken(previewBond, decimals, symbol) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-3 border-t border-ink-800">
                    <span className="text-ink-400">You Pay</span>
                    <span className="font-mono font-semibold text-ink-100">
                      {previewTotal !== undefined ? formatToken(previewTotal, decimals, symbol) : "—"}
                    </span>
                  </div>
                </div>
              </>
            )}

            {!isConnected ? (
              <p className="p-4 rounded-lg bg-ink-800 text-center text-sm text-ink-400">Connect a wallet to purchase</p>
            ) : isSeller ? (
              <div className="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 text-center">
                <p className="text-sm text-warning-400">This is your listing</p>
                {isActive && (
                  <>
                    <button
                      onClick={() => setShowDelist(true)}
                      disabled={isPending || isConfirming}
                      className="btn-press mt-3 w-full py-2.5 rounded-lg bg-ink-800 hover:bg-danger-600 border border-ink-700 hover:border-danger-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                    >
                      {(isPending || isConfirming) && action === "delist" ? "Delisting…" : "Delist listing"}
                    </button>
                    <p className="mt-2 text-xs text-ink-400">
                      Stops new purchases. Trades already opened from it stay open and are unaffected.
                    </p>
                  </>
                )}
              </div>
            ) : isArbiter ? (
              <div className="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 text-center">
                <p className="text-sm text-danger-400">You are the arbiter for this listing</p>
                <p className="text-xs text-ink-400 mt-1">Arbiters cannot purchase listings they oversee</p>
              </div>
            ) : isActive ? (
              <>
                <button
                  onClick={() => purchaseQuantity !== undefined && setShowReview(true)}
                  disabled={!quantityValid || isPending || isConfirming}
                  className="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold glow-trust disabled:shadow-none"
                >
                  {(isPending || isConfirming) && action === "purchase" ? "Purchasing…" : "Review & Purchase"}
                </button>
                {vaultCreationFee !== undefined && vaultCreationFee > 0n && (
                  <p className="text-xs text-ink-500 text-center mt-2">
                    Plus a {formatEther(vaultCreationFee)} ETH vault-creation fee.
                  </p>
                )}
                <p className="text-xs text-ink-500 text-center mt-3">
                  This will open an escrow vault with milestone-based release
                </p>
              </>
            ) : status === 1 ? (
              <div className="p-4 rounded-lg bg-ink-800 text-center">
                <p className="text-sm text-ink-400">This listing was delisted by the seller</p>
              </div>
            ) : status === 3 ? (
              <div className="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 text-center">
                <p className="text-sm text-danger-400">Removed by the platform</p>
                <p className="text-xs text-ink-400 mt-1">
                  This listing was taken down for breaching the platform&apos;s terms of use. Trades already opened from
                  it are unaffected.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-ink-800 text-center">
                <p className="text-sm text-ink-400">This listing is sold out — see trades above</p>
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-ink-800 space-y-3">
              <div className="flex items-center gap-2 text-sm text-ink-400">
                <svg className="w-4 h-4 text-success-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                DON-verifiable milestone release
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-400">
                <svg className="w-4 h-4 text-success-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                Bond-protected seller
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-400">
                <svg className="w-4 h-4 text-success-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
                  />
                </svg>
                Independent arbiter (enforced on-chain)
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransactionReviewModal
        open={showReview}
        onCancel={() => setShowReview(false)}
        onConfirm={() => {
          if (purchaseQuantity === undefined) return;
          setAction("purchase");
          writeContract({
            address: marketplace,
            abi: marketplaceAbi,
            functionName: "purchase",
            args: [listingId, purchaseQuantity],
            value: vaultCreationFee ?? 0n,
          });
          setShowReview(false);
        }}
        isSubmitting={(isPending || isConfirming) && action === "purchase"}
        title="Review Purchase"
        lineItems={
          decimals !== undefined
            ? [
                { label: "Quantity", value: quantityInput },
                { label: "Seller bond", value: previewBond !== undefined ? formatToken(previewBond, decimals, symbol) : "—" },
                { label: "You pay", value: previewTotal !== undefined ? formatToken(previewTotal, decimals, symbol) : "—" },
              ]
            : []
        }
        ethValue={vaultCreationFee ?? 0n}
        ethValueLabel="Vault-creation fee"
        contract={
          purchaseQuantity !== undefined && marketplace
            ? { address: marketplace, abi: marketplaceAbi, functionName: "purchase", args: [listingId, purchaseQuantity] }
            : undefined
        }
      />

      <TransactionReviewModal
        open={showDelist}
        onCancel={() => setShowDelist(false)}
        onConfirm={() => {
          setAction("delist");
          writeContract({ address: marketplace, abi: marketplaceAbi, functionName: "cancelListing", args: [listingId] });
          setShowDelist(false);
        }}
        isSubmitting={(isPending || isConfirming) && action === "delist"}
        title="Delist this listing?"
        lineItems={[
          { label: "Listing", value: `#${id}` },
          { label: "Effect", value: "No new purchases; open trades unaffected" },
          { label: "Reversible", value: "No — create a new listing to sell again" },
        ]}
        ethValue={0n}
        contract={{ address: marketplace, abi: marketplaceAbi, functionName: "cancelListing", args: [listingId] }}
      />
    </div>
  );
}
