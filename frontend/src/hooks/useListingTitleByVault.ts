import { useMemo } from "react";
import { zeroAddress, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useListingMetadataMap } from "@/hooks/useListingMetadataMap";

const SOLD = 2;
type ListingTuple = readonly [Address, Address, Address, bigint, string, number, Address];

/**
 * A trade opened via Marketplace.purchase() has no escrow-level description
 * of its own (useEscrowMetadata's local/Supabase description is empty for
 * it) — its identifying text is the listing's Title instead: the Supabase
 * discovery-layer title if the seller set one, else the raw on-chain
 * metadataURI. Maps vault address -> that title for any vault that
 * originated from a listing; vaults created directly via Create Escrow
 * simply won't appear in the returned map.
 */
export function useListingTitleByVault() {
  const { data: listingCount } = useReadContract({
    address: addresses.marketplace,
    abi: marketplaceAbi,
    functionName: "listingCount",
    query: { enabled: Boolean(addresses.marketplace) },
  });

  const listingIds = useMemo(
    () => (listingCount === undefined ? [] : Array.from({ length: Number(listingCount) }, (_, i) => i)),
    [listingCount],
  );

  const { data: listingResults } = useReadContracts({
    contracts: listingIds.map((id) => ({
      address: addresses.marketplace,
      abi: marketplaceAbi,
      functionName: "listings" as const,
      args: [BigInt(id)],
    })),
    query: { enabled: listingIds.length > 0 },
  });

  const { vaultToListingId, vaultToOnChainTitle } = useMemo(() => {
    const idMap = new Map<string, number>();
    const titleMap = new Map<string, string>();
    listingIds.forEach((id, i) => {
      const result = listingResults?.[i]?.result as ListingTuple | undefined;
      if (!result) return;
      const [, , , , metadataURI, status, vault] = result;
      if (status === SOLD && vault !== zeroAddress) {
        idMap.set(vault.toLowerCase(), id);
        if (metadataURI) titleMap.set(vault.toLowerCase(), metadataURI);
      }
    });
    return { vaultToListingId: idMap, vaultToOnChainTitle: titleMap };
  }, [listingIds, listingResults]);

  const listingMetadata = useListingMetadataMap(
    addresses.marketplace,
    useMemo(() => [...vaultToListingId.values()], [vaultToListingId]),
  );

  return useMemo(() => {
    const result = new Map<string, string>();
    for (const [vault, listingId] of vaultToListingId) {
      const supabaseTitle = listingMetadata.get(listingId)?.title;
      const title = supabaseTitle || vaultToOnChainTitle.get(vault);
      if (title) result.set(vault, title);
    }
    return result;
  }, [vaultToListingId, vaultToOnChainTitle, listingMetadata]);
}
