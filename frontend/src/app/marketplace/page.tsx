"use client";

import Link from "next/link";
import { useMemo } from "react";
import { erc20Abi, zeroAddress, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { formatToken, sumBigints } from "@/lib/format";
import { StatusBadge, LISTING_STATUS } from "@/components/ui/badges";
import { useListingMetadataMap } from "@/hooks/useListingMetadataMap";

type ListingTuple = readonly [Address, Address, Address, bigint, string, number, Address];

const SOLD = 2;

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

  const { data: milestoneResults } = useReadContracts({
    contracts: ids.map((id) => ({
      address: marketplace,
      abi: marketplaceAbi,
      functionName: "listingMilestones" as const,
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

  if (!marketplace) {
    return <p className="text-sm text-ink-400">Marketplace address not configured.</p>;
  }

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Marketplace</h1>
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

      {isLoading && <p className="text-sm text-ink-400">Loading…</p>}
      {ids.length === 0 && !isLoading && <p className="text-sm text-ink-400">No listings yet.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ids.map((id, i) => {
          const result = listingResults?.[i]?.result as ListingTuple | undefined;
          if (!result) return null;
          const [seller, , , bondAmount, metadataURI, status, vault] = result;
          const milestones = milestoneResults?.[i]?.result as readonly bigint[] | undefined;
          const decimals = tokenResults?.[i * 2]?.result as number | undefined;
          const symbol = tokenResults?.[i * 2 + 1]?.result as string | undefined;
          const total = milestones ? sumBigints(milestones) : 0n;
          const href = status === SOLD && vault !== zeroAddress ? `/escrow/${vault}` : `/marketplace/${id}`;
          const meta = listingMetadata.get(Number(id));

          return (
            <Link
              key={id.toString()}
              href={href}
              className="deal-card bg-ink-900 border border-ink-800 rounded-xl overflow-hidden block"
            >
              {meta?.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-provided URL
                <img src={meta.thumbnailUrl} alt="" className="w-full h-36 object-cover bg-ink-800" />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <StatusBadge status={LISTING_STATUS[status]} />
                  <span className="text-xs text-ink-500 font-mono">#{id.toString()}</span>
                </div>
                <h3 className="font-semibold text-lg mb-2 line-clamp-2 text-white">
                  {meta?.title || metadataURI || `Listing #${id}`}
                </h3>
                {meta?.description && <p className="text-sm text-ink-400 mb-4 line-clamp-2">{meta.description}</p>}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {seller.slice(2, 4).toUpperCase()}
                  </div>
                  <span className="addr text-ink-400 font-mono text-xs">
                    {seller.slice(0, 6)}…{seller.slice(-4)}
                  </span>
                </div>
                {decimals !== undefined && (
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Total Value</span>
                      <span className="font-semibold font-mono text-ink-100">{formatToken(total, decimals, symbol)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Seller Bond</span>
                      <span className="font-mono text-warning-400">{formatToken(bondAmount, decimals, symbol)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-400">Milestones</span>
                      <span className="font-mono text-ink-100">{milestones?.length ?? 0}</span>
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
