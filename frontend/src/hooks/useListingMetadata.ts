import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { ListingTerms } from "@/lib/listingTerms";

export interface ListingMetadata {
  title: string;
  description: string;
  thumbnailUrl: string;
  terms: ListingTerms;
}

const EMPTY: ListingMetadata = { title: "", description: "", thumbnailUrl: "", terms: {} };

/**
 * A Marketplace listing's discovery-layer metadata (thumbnail, description,
 * structured terms) from Supabase — separate from the on-chain `metadataURI`
 * raw-text field, which stays as a plain fallback title when nothing richer
 * has been saved (e.g. Supabase isn't configured for this deployment, or
 * the seller hasn't filled in the richer form yet).
 */
export function useListingMetadata(marketplaceAddress: Address | undefined, listingId: number | undefined) {
  const chainId = useChainId();
  const [metadata, setMetadata] = useState<ListingMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !marketplaceAddress || listingId === undefined) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    supabase
      .from("marketplace_listings")
      .select("title, description, thumbnail_url, terms")
      .eq("chain_id", chainId)
      .eq("marketplace_address", marketplaceAddress.toLowerCase())
      .eq("listing_id", listingId)
      .maybeSingle()
      .then(({ data: row }) => {
        if (cancelled) return;
        setMetadata(
          row
            ? {
                title: (row.title as string | null) ?? "",
                description: (row.description as string | null) ?? "",
                thumbnailUrl: (row.thumbnail_url as string | null) ?? "",
                terms: (row.terms as ListingTerms | null) ?? {},
              }
            : EMPTY,
        );
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketplaceAddress, listingId, chainId]);

  return { metadata: metadata ?? EMPTY, isLoading };
}
