import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export interface MilestoneDocument {
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * The uploaded file backing this milestone's on-chain docHash, if any — see
 * write-milestone-document. `enabled` should gate on docHash !== zeroHash:
 * no point querying for a milestone that has no documentation at all yet.
 */
export function useMilestoneDocument(vaultAddress: Address | undefined, milestoneIndex: number, enabled: boolean) {
  const chainId = useChainId();
  const [fetched, setFetched] = useState<MilestoneDocument | null>(null);

  useEffect(() => {
    // No setState here for the disabled case — `enabled`/`vaultAddress` are
    // masked back to null at the return statement below instead, entirely
    // at render time, so this effect only ever sets state from the async
    // query's own completion callback.
    if (!isSupabaseConfigured || !supabase || !vaultAddress || !enabled) return;
    let cancelled = false;
    supabase
      .from("escrow_milestone_documents")
      .select("storage_path, original_filename, content_type, size_bytes")
      .eq("chain_id", chainId)
      .eq("vault_address", vaultAddress.toLowerCase())
      .eq("milestone_index", milestoneIndex)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data || !supabase) return;
        const { data: urlData } = supabase.storage.from("milestone-documents").getPublicUrl(data.storage_path as string);
        setFetched({
          url: urlData.publicUrl,
          filename: data.original_filename as string,
          contentType: data.content_type as string,
          sizeBytes: data.size_bytes as number,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [vaultAddress, milestoneIndex, chainId, enabled]);

  return enabled && vaultAddress ? fetched : null;
}
