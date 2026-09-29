import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useListingMetadataMap } from "@/hooks/useListingMetadataMap";

// listings(listingId) returns (seller, arbiter, token, metadataURI, status) —
// only the metadataURI is needed here, as the fallback title when a Supabase
// discovery-layer row exists but has no title set.
type ListingTuple = readonly [Address, Address, Address, string, number];

/**
 * A trade opened via Marketplace.purchase() has no escrow-level description
 * of its own (useEscrowMetadata's local/Supabase description is empty for
 * it) — its identifying text is the listing's Title instead: the Supabase
 * discovery-layer title if the seller set one, else the raw on-chain
 * metadataURI. Maps vault address -> that title for any vault that
 * originated from a listing; vaults created directly via Create Escrow
 * simply won't appear in the returned map.
 *
 * A listing can be purchased many times before its quantity is exhausted,
 * so there is no single "the" vault per listing — the vault source of truth
 * is Marketplace's listingVaults(listingId, index) array, walked via
 * listingVaultCount(listingId). Every status is included (no Sold-only
 * gate): partially-purchased listings stay Active and their trades deserve
 * titles too.
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

  const metadataUriByListingId = useMemo(() => {
    const map = new Map<number, string>();
    listingIds.forEach((id, i) => {
      const result = listingResults?.[i]?.result as ListingTuple | undefined;
      if (result) map.set(id, result[3]);
    });
    return map;
  }, [listingIds, listingResults]);

  const { data: vaultCountResults } = useReadContracts({
    contracts: listingIds.map((id) => ({
      address: addresses.marketplace,
      abi: marketplaceAbi,
      functionName: "listingVaultCount" as const,
      args: [BigInt(id)],
    })),
    query: { enabled: listingIds.length > 0 },
  });

  const vaultQueries = useMemo(
    () =>
      listingIds.flatMap((id, i) => {
        const count = vaultCountResults?.[i]?.result as bigint | undefined;
        return count === undefined
          ? []
          : Array.from({ length: Number(count) }, (_, vaultIndex) => ({ listingId: id, vaultIndex }));
      }),
    [listingIds, vaultCountResults],
  );

  const { data: vaultResults } = useReadContracts({
    contracts: vaultQueries.map(({ listingId, vaultIndex }) => ({
      address: addresses.marketplace,
      abi: marketplaceAbi,
      functionName: "listingVaults" as const,
      args: [BigInt(listingId), BigInt(vaultIndex)],
    })),
    query: { enabled: vaultQueries.length > 0 },
  });

  const { vaultToListingId, vaultToOnChainTitle } = useMemo(() => {
    const idMap = new Map<string, number>();
    const titleMap = new Map<string, string>();
    vaultQueries.forEach(({ listingId }, i) => {
      const vault = vaultResults?.[i]?.result as Address | undefined;
      if (!vault) return;
      const key = vault.toLowerCase();
      idMap.set(key, listingId);
      const metadataURI = metadataUriByListingId.get(listingId);
      if (metadataURI) titleMap.set(key, metadataURI);
    });
    return { vaultToListingId: idMap, vaultToOnChainTitle: titleMap };
  }, [vaultQueries, vaultResults, metadataUriByListingId]);

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
