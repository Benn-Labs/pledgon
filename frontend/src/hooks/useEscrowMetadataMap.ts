import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { getTradeDescription } from "@/lib/tradeDescriptions";

/**
 * Trade descriptions for many vaults in one query — for a list of cards,
 * where a per-card useEscrowMetadata() would fire one Supabase query per
 * card instead of one for the whole page. Falls back to each vault's
 * localStorage cache when Supabase isn't configured or has no row yet.
 */
export function useEscrowMetadataMap(vaults: Address[]) {
  const chainId = useChainId();
  const [map, setMap] = useState<Map<string, string>>(new Map());
  const key = vaults.map((v) => v.toLowerCase()).sort().join(",");

  useEffect(() => {
    const local = new Map<string, string>();
    for (const v of vaults) {
      const desc = getTradeDescription(v);
      if (desc) local.set(v.toLowerCase(), desc);
    }
    setMap(local);

    if (!isSupabaseConfigured || !supabase || vaults.length === 0) return;
    let cancelled = false;
    supabase
      .from("escrow_trade_metadata")
      .select("vault_address, description")
      .eq("chain_id", chainId)
      .in(
        "vault_address",
        vaults.map((v) => v.toLowerCase()),
      )
      .then(({ data: rows }) => {
        if (cancelled || !rows) return;
        setMap((prev) => {
          const next = new Map(prev);
          for (const row of rows) {
            if (row.description) next.set(row.vault_address as string, row.description as string);
          }
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity for `vaults`
  }, [key, chainId]);

  return map;
}
