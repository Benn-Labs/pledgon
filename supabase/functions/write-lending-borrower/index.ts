// Records that an address has deposited collateral into a LendingPool — pure
// discovery data for the Liquidate page's candidate list, never authoritative
// (LendingPool.positions()/LiquidationConsumer.isEligible() are always
// re-checked live before anything acts on a row here). See the file-level
// comment on lending_borrowers in supabase/schema.sql for why this function's
// check is lighter than write-escrow-metadata's: proving the signer *is* the
// address being recorded is enough — there's no "party to this resource" to
// confirm on-chain, since being listed as a candidate borrower carries no
// security consequence.
//
// Expects POST JSON:
//   { address, signature, message, chainId, lendingPoolAddress }
//
// `message` must be the exact string the client had the wallet sign, and
// must contain a line `Resource: lending:<chainId>:<lendingPoolAddress
// lowercased>:<address lowercased>` and a line `Issued At: <ISO timestamp>`
// — see frontend/src/hooks/useSignedMetadataWrite.ts for how the client
// builds it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyMessage } from "npm:viem@2";
import { checkResourceAndFreshness, handleCorsPreflight, jsonResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  try {
    const body = await req.json();
    const { address, signature, message, chainId, lendingPoolAddress } = body ?? {};

    if (!address || !signature || !message || !chainId || !lendingPoolAddress) {
      return jsonResponse({ error: "address, signature, message, chainId, lendingPoolAddress are required" }, 400);
    }

    const valid = await verifyMessage({ address, message, signature });
    if (!valid) return jsonResponse({ error: "signature does not match address" }, 401);

    const expectedResource = `lending:${chainId}:${String(lendingPoolAddress).toLowerCase()}:${String(address).toLowerCase()}`;
    const freshnessError = checkResourceAndFreshness(message, expectedResource);
    if (freshnessError) return jsonResponse({ error: freshnessError }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from("lending_borrowers").upsert(
      {
        chain_id: chainId,
        lending_pool_address: String(lendingPoolAddress).toLowerCase(),
        borrower_address: String(address).toLowerCase(),
      },
      { onConflict: "chain_id,lending_pool_address,borrower_address", ignoreDuplicates: true },
    );
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
