import { useCallback, useState } from "react";
import type { Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

/** Matches write-milestone-document's own limit — checked client-side too, for a faster failure. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function buildMessage(action: string, resource: string): string {
  return `PLEDGON wants you to ${action}.\n\nResource: ${resource}\nIssued At: ${new Date().toISOString()}`;
}

/**
 * Uploads a milestone's delivery-document file to Supabase Storage via
 * write-milestone-document, proving control of the seller's address by
 * signature — same signed-resource pattern as useSignedMetadataWrite, but a
 * multipart FormData body (the raw file) instead of JSON, so this is its
 * own hook rather than another useSignedMetadataWrite<T> instantiation.
 */
export function useSignedMilestoneDocumentWrite() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (params: {
      chainId: number;
      vaultAddress: Address;
      milestoneIndex: number;
      docHash: `0x${string}`;
      file: File;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!address) {
        const message = "Connect a wallet first";
        setError(message);
        return { ok: false, error: message };
      }
      if (!isSupabaseConfigured || !supabase) {
        const message = "Document storage isn't configured";
        setError(message);
        return { ok: false, error: message };
      }
      setIsPending(true);
      setError(null);
      try {
        const resource = `escrow:${params.chainId}:${params.vaultAddress.toLowerCase()}:milestone:${params.milestoneIndex}`;
        const message = buildMessage("upload this milestone's delivery document", resource);
        const signature = await signMessageAsync({ message });

        const form = new FormData();
        form.set("address", address);
        form.set("signature", signature);
        // FormData's multipart serialization normalizes every bare \n or \r
        // in a string field to \r\n (the WHATWG "multipart/form-data
        // encoding algorithm" — this isn't optional or browser-specific).
        // `message` is multi-line, so the bytes verifyMessage() re-checks
        // server-side would silently differ from what the wallet actually
        // signed, failing every signature. encodeURIComponent leaves no raw
        // newline for that step to touch; the function decodes it back
        // before verifying.
        form.set("message", encodeURIComponent(message));
        form.set("chainId", String(params.chainId));
        form.set("vaultAddress", params.vaultAddress);
        form.set("milestoneIndex", String(params.milestoneIndex));
        form.set("docHash", params.docHash);
        form.set("file", params.file);

        const { data, error: fnError } = await supabase.functions.invoke("write-milestone-document", { body: form });
        if (fnError) {
          // Same unwrap as useSignedMetadataWrite.ts: FunctionsHttpError.message
          // is a generic wrapper — the real reason is JSON on `.context`.
          let errorMessage = fnError.message;
          const context = (fnError as { context?: Response }).context;
          if (context) {
            try {
              const body = await context.clone().json();
              if (body?.error) errorMessage = body.error as string;
            } catch {
              // context wasn't JSON (e.g. a network-level failure) — keep fnError.message
            }
          }
          setError(errorMessage);
          return { ok: false, error: errorMessage };
        }
        if (data?.error) {
          setError(data.error as string);
          return { ok: false, error: data.error as string };
        }
        return { ok: true };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : "Failed to upload document";
        setError(errorMessage);
        return { ok: false, error: errorMessage };
      } finally {
        setIsPending(false);
      }
    },
    [address, signMessageAsync],
  );

  return { upload, isPending, error };
}
