import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { ListingMetadata } from "@/hooks/useListingMetadata";

/**
 * Listing metadata (thumbnail, description, terms) for many listings in one
 * query, keyed by `listingId` — for the Marketplace browse grid, where a
 * per-card useListingMetadata() would fire one Supabase query per card.
 */
export function useListingMetadataMap(marketplaceAddress: Address | undefined, listingIds: number[]) {
  const chainId = useChainId();
  const [map, setMap] = useState<Map<number, ListingMetadata>>(new Map());
  const key = listingIds.slice().sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !marketplaceAddress || listingIds.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    supabase
      .from("marketplace_listings")
      .select("listing_id, title, description, thumbnail_url, terms")
      .eq("chain_id", chainId)
      .eq("marketplace_address", marketplaceAddress.toLowerCase())
      .in("listing_id", listingIds)
      .then(({ data: rows }) => {
        if (cancelled || !rows) return;
        const next = new Map<number, ListingMetadata>();
        for (const row of rows) {
          next.set(row.listing_id as number, {
            title: (row.title as string | null) ?? "",
            description: (row.description as string | null) ?? "",
            thumbnailUrl: (row.thumbnail_url as string | null) ?? "",
            terms: (row.terms as ListingMetadata["terms"] | null) ?? {},
          });
        }
        setMap(next);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity for `listingIds`
  }, [marketplaceAddress, key, chainId]);

  return map;
}
