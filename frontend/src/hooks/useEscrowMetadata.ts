import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { getMilestoneLabels, saveMilestoneLabels } from "@/lib/milestoneLabels";
import { getTradeDescription, saveTradeDescription } from "@/lib/tradeDescriptions";

/**
 * A trade's shared description + milestone labels. Seeds instantly from
 * this browser's localStorage cache (whichever party last wrote here sees
 * their own words immediately, no network wait), then reconciles with
 * Supabase — the actual shared source now that both buyer and seller are
 * meant to see the same labels, not just whoever created the trade.
 */
export function useEscrowMetadata(vault: Address) {
  const chainId = useChainId();
  const [description, setDescription] = useState(() => getTradeDescription(vault) ?? "");
  const [milestoneLabels, setMilestoneLabels] = useState<string[]>(() => getMilestoneLabels(vault) ?? []);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("escrow_trade_metadata")
      .select("description, milestone_labels")
      .eq("chain_id", chainId)
      .eq("vault_address", vault.toLowerCase())
      .maybeSingle()
      .then(({ data: row }) => {
        if (cancelled) return;
        if (row) {
          const desc = (row.description as string | null) ?? "";
          const labels = (row.milestone_labels as string[] | null) ?? [];
          setDescription(desc);
          setMilestoneLabels(labels);
          saveTradeDescription(vault, desc);
          saveMilestoneLabels(vault, labels);
        }
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vault, chainId]);

  return { description, milestoneLabels, isLoading };
}
