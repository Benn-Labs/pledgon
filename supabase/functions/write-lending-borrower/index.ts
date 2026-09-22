// Records that an address has deposited collateral into a LendingPool — pure
// discovery data for the Liquidate page's candidate list, never authoritative
// (LendingPool.positions()/LiquidationConsumer.isEligible() are always
// re-checked live on-chain before anything acts on a row here).
//
// Verified entirely from chain state, not a client-signed message: given a
// transaction hash, confirms it's a mined, successful transaction that
// emitted a CollateralDeposited event on the named LendingPool, and takes the
// borrower address from *that event* — never from client input, so there's
// no way to register an address that didn't actually deposit. Deliberately
// not signature-gated: a depositCollateral() call is already public,
// permanent on-chain data the instant it's mined, so asking the depositor to
// additionally sign a message proving it was them adds a second wallet
// prompt without protecting anything — there's nothing private left to
// protect (see lending_borrowers' table comment in supabase/schema.sql).
//
// Expects POST JSON:
//   { txHash, chainId, lendingPoolAddress }

import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, decodeEventLog, http } from "npm:viem@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/auth.ts";

const COLLATERAL_DEPOSITED_EVENT = {
  type: "event",
  name: "CollateralDeposited",
  inputs: [
    { name: "borrower", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
} as const;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  try {
    const body = await req.json();
    const { txHash, chainId, lendingPoolAddress } = body ?? {};

    if (!txHash || !chainId || !lendingPoolAddress) {
      return jsonResponse({ error: "txHash, chainId, lendingPoolAddress are required" }, 400);
    }

    const rpcUrl = Deno.env.get("RPC_URL");
    if (!rpcUrl) return jsonResponse({ error: "server misconfigured: RPC_URL not set" }, 500);

    const client = createPublicClient({ transport: http(rpcUrl) });

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch {
      return jsonResponse({ error: "transaction not found (not yet mined, or wrong network)" }, 404);
    }

    if (receipt.status !== "success") {
      return jsonResponse({ error: "transaction did not succeed" }, 400);
    }

    const poolAddress = String(lendingPoolAddress).toLowerCase();
    let borrower: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== poolAddress) continue;
      try {
        const decoded = decodeEventLog({ abi: [COLLATERAL_DEPOSITED_EVENT], data: log.data, topics: log.topics });
        borrower = (decoded.args as { borrower: string }).borrower;
        break;
      } catch {
        // not a CollateralDeposited log — keep scanning the rest
      }
    }

    if (!borrower) {
      return jsonResponse({ error: "transaction did not emit CollateralDeposited on this LendingPool" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from("lending_borrowers").upsert(
      {
        chain_id: chainId,
        lending_pool_address: poolAddress,
        borrower_address: borrower.toLowerCase(),
      },
      { onConflict: "chain_id,lending_pool_address,borrower_address", ignoreDuplicates: true },
    );
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true, borrower });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
