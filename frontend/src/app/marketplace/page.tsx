"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { formatToken } from "@/lib/format";
import { StatusBadge, LISTING_STATUS } from "@/components/ui/badges";
import { useListingMetadataMap } from "@/hooks/useListingMetadataMap";
import { formatPerUnit, unitShortLabel } from "@/lib/units";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplaceCategories";
import { CategoryTiles, ALL_CATEGORIES } from "@/components/marketplace/CategoryTiles";
import { StatCard } from "@/components/marketplace/StatCard";
import { ListingThumbnail } from "@/components/marketplace/ListingThumbnail";

type ListingTuple = readonly [Address, Address, Address, string, number];
type PricingTuple = readonly [bigint, bigint, bigint, bigint]; // totalQuantity, remainingQuantity, unitPrice, bondRatePerUnit

const QUANTITY_DECIMALS = 18; // matches Marketplace.QUANTITY_SCALE

export default function BrowsePage() {
  const marketplace = addresses.marketplace;

  const { data: count } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listingCount",
    query: { enabled: Boolean(marketplace) },
  });

  const ids = useMemo(() => (count === undefined ? [] : Array.from({ length: Number(count) }, (_, i) => BigInt(i))), [count]);
  const listingMetadata = useListingMetadataMap(
    marketplace,
    useMemo(() => ids.map((id) => Number(id)), [ids]),
  );

  const { data: listingResults, isLoading } = useReadContracts({
    contracts: ids.map((id) => ({
      address: marketplace,
      abi: marketplaceAbi,
      functionName: "listings" as const,
      args: [id],
    })),
    query: { enabled: ids.length > 0 },
  });

  const { data: pricingResults } = useReadContracts({
    contracts: ids.map((id) => ({
      address: marketplace,
      abi: marketplaceAbi,
      functionName: "listingPricing" as const,
      args: [id],
    })),
    query: { enabled: ids.length > 0 },
  });

  const { data: milestoneBpsResults } = useReadContracts({
    contracts: ids.map((id) => ({
      address: marketplace,
      abi: marketplaceAbi,
      functionName: "listingMilestoneBps" as const,
      args: [id],
    })),
    query: { enabled: ids.length > 0 },
  });

  const tokens = useMemo(
    () => (listingResults?.map((r) => (r.result as ListingTuple | undefined)?.[2]) ?? []),
    [listingResults],
  );

  const { data: tokenResults } = useReadContracts({
    contracts: tokens.flatMap((token) => [
      { address: token, abi: erc20Abi, functionName: "decimals" as const },
      { address: token, abi: erc20Abi, functionName: "symbol" as const },
    ]),
    query: { enabled: tokens.length > 0 && tokens.every(Boolean) },
  });

  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  // Listings whose metadata category maps to a known tile (matched by label,
  // which is what the create page stores in terms.category).
  const categoryIdOf = (id: bigint): string | undefined =>
    MARKETPLACE_CATEGORIES.find((c) => c.label === listingMetadata.get(Number(id))?.terms.category)?.id;

  const stats = useMemo(() => {
    let active = 0;
    let shown = 0;
    const sellers = new Set<string>();
    const categoryCounts: Record<string, number> = {};
    // Open inventory value per payment token (quantity is 18-dec scaled).
    const value = new Map<string, { amount: bigint; decimals: number; symbol?: string }>();
    ids.forEach((id, i) => {
      const listing = listingResults?.[i]?.result as ListingTuple | undefined;
      if (!listing) return;
      const [seller, , , , status] = listing;
      const catId = MARKETPLACE_CATEGORIES.find((c) => c.label === listingMetadata.get(Number(id))?.terms.category)?.id;
      // Delisted/removed listings are hidden from the grid, so they don't count toward the tiles either.
      if (LISTING_STATUS[status] === "Cancelled" || LISTING_STATUS[status] === "TakenDown") return;
      shown += 1;
      if (catId) categoryCounts[catId] = (categoryCounts[catId] ?? 0) + 1;
      if (LISTING_STATUS[status] !== "Active") return;
      active += 1;
      sellers.add(seller.toLowerCase());
      const pricing = pricingResults?.[i]?.result as PricingTuple | undefined;
      const decimals = tokenResults?.[i * 2]?.result as number | undefined;
      const symbol = tokenResults?.[i * 2 + 1]?.result as string | undefined;
      if (!pricing || decimals === undefined) return;
      const key = listing[2];
      const prev = value.get(key) ?? { amount: 0n, decimals, symbol };
      prev.amount += (pricing[1] * pricing[2]) / 10n ** BigInt(QUANTITY_DECIMALS);
      value.set(key, prev);
    });
    return { active, shown, sellers: sellers.size, categoryCounts, value: [...value.values()] };
  }, [ids, listingResults, pricingResults, tokenResults, listingMetadata]);

  // Delisted (by the seller) and removed (by the platform admin) listings
  // leave the browse grid; sold-out ones stay as visible history.
  const isHidden = (status: number) => LISTING_STATUS[status] === "Cancelled" || LISTING_STATUS[status] === "TakenDown";
  const isShown = (id: bigint, i: number) => {
    const result = listingResults?.[i]?.result as ListingTuple | undefined;
    return Boolean(result) && !isHidden(result![4]);
  };

  if (!marketplace) {
    return <p className="text-sm text-ink-400">Marketplace address not configured.</p>;
  }

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display text-ink-50">Marketplace</h1>
          <p className="text-ink-400 mt-1">Browse active escrow listings with milestone-based payments</p>
        </div>
        <Link
          href="/marketplace/create"
          className="btn-press px-4 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold glow-trust flex items-center gap-2 w-fit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Listing
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total listings" value={ids.length} loading={isLoading} />
        <StatCard label="Active listings" value={stats.active} hint={`${ids.length - stats.active} closed`} loading={isLoading} />
        <StatCard label="Sellers" value={stats.sellers} loading={isLoading} />
        <StatCard
          label="Open inventory"
          value={
            stats.value.length === 0
              ? "—"
              : formatToken(stats.value[0].amount, stats.value[0].decimals, stats.value[0].symbol, 2)
          }
          hint={stats.value.length > 1 ? `+ ${stats.value.length - 1} more token${stats.value.length > 2 ? "s" : ""}` : "Remaining qty × unit price"}
          loading={isLoading}
        />
      </div>

      <CategoryTiles selected={categoryFilter} onSelect={setCategoryFilter} counts={stats.categoryCounts} total={stats.shown} />

      {isLoading && <p className="text-sm text-ink-400">Loading…</p>}
      {!isLoading && !ids.some(isShown) && <p className="text-sm text-ink-400">No listings yet.</p>}
      {ids.some(isShown) && categoryFilter !== ALL_CATEGORIES && !ids.some((id, i) => isShown(id, i) && categoryIdOf(id) === categoryFilter) && (
        <p className="text-sm text-ink-400">No listings in this category yet.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ids.map((id, i) => {
          const result = listingResults?.[i]?.result as ListingTuple | undefined;
          if (!result || isHidden(result[4])) return null;
          if (categoryFilter !== ALL_CATEGORIES && categoryIdOf(id) !== categoryFilter) return null;
          const [seller, , , metadataURI, status] = result;
          const pricing = pricingResults?.[i]?.result as PricingTuple | undefined;
          const [totalQuantity, remainingQuantity, unitPrice, bondRatePerUnit] = pricing ?? [undefined, undefined, undefined, undefined];
          const milestoneBps = milestoneBpsResults?.[i]?.result as readonly number[] | undefined;
          const decimals = tokenResults?.[i * 2]?.result as number | undefined;
          const symbol = tokenResults?.[i * 2 + 1]?.result as string | undefined;
          const meta = listingMetadata.get(Number(id));

          return (
            <Link
              key={id.toString()}
              href={`/marketplace/${id}`}
              className="deal-card bg-ink-900 border border-ink-800 rounded-xl overflow-hidden block"
            >
              <ListingThumbnail key={meta?.thumbnailUrl ?? ""} url={meta?.thumbnailUrl} className="w-full h-36" />
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <StatusBadge status={LISTING_STATUS[status]} />
                  <span className="text-xs text-ink-500 font-mono">#{id.toString()}</span>
                </div>
                <h3 className="font-semibold text-lg mb-2 line-clamp-2 text-ink-50">
                  {meta?.title || metadataURI || `Listing #${id}`}
                </h3>
                {meta?.terms.category && (
                  <span className="inline-block px-2 py-0.5 mb-2 rounded-full bg-ink-800 border border-ink-700 text-[11px] text-ink-400">
                    {meta.terms.category}
                  </span>
                )}
                {meta?.description && <p className="text-sm text-ink-400 mb-4 line-clamp-2">{meta.description}</p>}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center text-xs font-bold text-ink-50 shrink-0">
                    {seller.slice(2, 4).toUpperCase()}
                  </div>
                  <span className="addr text-ink-400 font-mono text-xs">
                    {seller.slice(0, 6)}…{seller.slice(-4)}
                  </span>
                </div>
                {decimals !== undefined && unitPrice !== undefined && (
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Unit Price</span>
                      <span className="font-mono text-ink-100">
                        {formatPerUnit(formatToken(unitPrice, decimals, symbol), meta?.terms.unit)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Available</span>
                      <span className="font-semibold font-mono text-ink-100">
                        {formatUnits(remainingQuantity ?? 0n, QUANTITY_DECIMALS)} / {formatUnits(totalQuantity ?? 0n, QUANTITY_DECIMALS)}{" "}
                        {unitShortLabel(meta?.terms.unit)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Bond Rate</span>
                      <span className="font-mono text-warning-400">
                        {formatPerUnit(formatToken(bondRatePerUnit ?? 0n, decimals, symbol), meta?.terms.unit)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Milestones</span>
                      <span className="font-mono text-ink-100">{milestoneBps?.length ?? 0}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-4 border-t border-ink-800">
                  <span className="text-xs text-ink-500">Listing #{id.toString()}</span>
                  <span className="text-sm text-trust-400 font-medium">View Details →</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
