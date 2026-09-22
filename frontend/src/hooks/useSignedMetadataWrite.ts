import { useCallback, useState } from "react";
import type { Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type { ListingTerms } from "@/lib/listingTerms";

/**
 * Builds the exact string the wallet signs. The Edge Function re-derives
 * `Resource: ...` from the request body and rejects any signature whose
 * message doesn't contain a matching line — so this format must stay in
 * sync with supabase/functions/_shared/auth.ts's checkResourceAndFreshness.
 */
function buildMessage(action: string, resource: string): string {
  return `PLEDGON wants you to ${action}.\n\nResource: ${resource}\nIssued At: ${new Date().toISOString()}`;
}

/**
 * Signs a message proving control of the connected address, then invokes a
 * write-*-metadata Edge Function with that signature. The function itself
 * re-checks on-chain that the signer is actually authorized (the listing's
 * seller, or a party to the vault) before writing — this hook only handles
 * the client-side signing + invocation, not authorization.
 *
 * `write` is memoized with useCallback: callers put it in a useEffect's
 * dependency array (to fire once after a receipt arrives), and an
 * unmemoized function here would get a new identity every render — as soon
 * as `write` touched isPending/error state, that new identity would
 * re-trigger the very effect that called it, signing the same message in a
 * runaway loop instead of once. (This was a real bug — see the Escrow
 * create page's effect for the fix.)
 */
function useSignedMetadataWrite<TPayload extends Record<string, unknown>>(functionName: string) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returns the outcome directly rather than making callers re-read `error`
  // state afterward: `error` only updates once React processes the setError
  // call and re-renders, but an async function that awaits `write()` keeps
  // whatever `error` its own closure captured at the START of that render —
  // stale, not the value `write` just set. Returning it inline sidesteps
  // that entirely.
  const write = useCallback(
    async (resource: string, action: string, payload: TPayload): Promise<{ ok: boolean; error?: string }> => {
      if (!address) {
        const message = "Connect a wallet first";
        setError(message);
        return { ok: false, error: message };
      }
      if (!isSupabaseConfigured || !supabase) {
        const message = "Metadata storage isn't configured";
        setError(message);
        return { ok: false, error: message };
      }
      setIsPending(true);
      setError(null);
      try {
        const message = buildMessage(action, resource);
        const signature = await signMessageAsync({ message });
        const { data, error: fnError } = await supabase.functions.invoke(functionName, {
          body: { address, signature, message, ...payload },
        });
        if (fnError) {
          // supabase-js's FunctionsHttpError.message is just "Edge Function
          // returned a non-2xx status code" — the actual reason (signature
          // mismatch, not authorized, etc.) is in the JSON body of the raw
          // Response it stashes on `.context`. Dig it out so the real cause
          // reaches the UI instead of that generic wrapper text.
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
        const errorMessage = e instanceof Error ? e.message : "Failed to save";
        setError(errorMessage);
        return { ok: false, error: errorMessage };
      } finally {
        setIsPending(false);
      }
    },
    [address, signMessageAsync, functionName],
  );

  return { write, isPending, error };
}

export interface ListingTermsPayload extends Record<string, unknown> {
  chainId: number;
  marketplaceAddress: Address;
  listingId: number;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  terms?: ListingTerms;
}

export function useSignedListingMetadataWrite() {
  const { write: rawWrite, isPending, error } = useSignedMetadataWrite<ListingTermsPayload>("write-listing-metadata");
  const write = useCallback(
    (payload: ListingTermsPayload) =>
      rawWrite(
        `marketplace:${payload.chainId}:${payload.marketplaceAddress.toLowerCase()}:${payload.listingId}`,
        "update this listing's public description",
        payload,
      ),
    [rawWrite],
  );
  return { write, isPending, error };
}

export interface EscrowMetadataPayload extends Record<string, unknown> {
  chainId: number;
  vaultAddress: Address;
  description?: string;
  milestoneLabels?: string[];
}

export function useSignedEscrowMetadataWrite() {
  const { write: rawWrite, isPending, error } = useSignedMetadataWrite<EscrowMetadataPayload>("write-escrow-metadata");
  const write = useCallback(
    (payload: EscrowMetadataPayload) =>
      rawWrite(`escrow:${payload.chainId}:${payload.vaultAddress.toLowerCase()}`, "update this trade's shared description", payload),
    [rawWrite],
  );
  return { write, isPending, error };
}

// Lending-borrower registration deliberately does NOT go through
// useSignedMetadataWrite — see useRegisterBorrowerFromDeposit in
// useLendingBorrowers.ts. A depositCollateral() transaction is already
// public, permanent on-chain data the instant it's mined, so verifying it by
// transaction hash needs no wallet signature at all, unlike the
// listing/escrow metadata writes above (which write content that has no
// on-chain equivalent to verify against).
