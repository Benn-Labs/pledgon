// Writes discovery-layer metadata (trade description, per-milestone labels)
// for one EscrowVault — only if the caller proves, by EVM signature, that
// they control an address the chain actually records as that vault's buyer
// or seller. Never touches funds or any on-chain state; this is purely the
// presentation layer described in supabase/schema.sql.
//
// Expects POST JSON:
//   { address, signature, message, chainId, vaultAddress,
//     description?, milestoneLabels? }
//
// `message` must be the exact string the client had the wallet sign, and
// must contain a line `Resource: escrow:<chainId>:<vaultAddress
// lowercased>` and a line `Issued At: <ISO timestamp>` — see
// frontend/src/lib/signedMetadata.ts for how the client builds it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyMessage } from "npm:viem@2";
import { checkResourceAndFreshness, handleCorsPreflight, jsonResponse } from "../_shared/auth.ts";

const VAULT_ABI = [
  { type: "function", name: "buyer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "seller", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  try {
    const body = await req.json();
    const { address, signature, message, chainId, vaultAddress, description, milestoneLabels } = body ?? {};

    if (!address || !signature || !message || !chainId || !vaultAddress) {
      return jsonResponse({ error: "address, signature, message, chainId, vaultAddress are required" }, 400);
    }

    const valid = await verifyMessage({ address, message, signature });
    if (!valid) return jsonResponse({ error: "signature does not match address" }, 401);

    const expectedResource = `escrow:${chainId}:${String(vaultAddress).toLowerCase()}`;
    const freshnessError = checkResourceAndFreshness(message, expectedResource);
    if (freshnessError) return jsonResponse({ error: freshnessError }, 401);

    const rpcUrl = Deno.env.get("RPC_URL");
    if (!rpcUrl) return jsonResponse({ error: "server misconfigured: RPC_URL not set" }, 500);

    const { createPublicClient, http } = await import("npm:viem@2");
    const client = createPublicClient({ transport: http(rpcUrl) });
    const [buyer, seller] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "buyer" }) as Promise<string>,
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "seller" }) as Promise<string>,
    ]);

    const claimant = String(address).toLowerCase();
    if (claimant !== buyer.toLowerCase() && claimant !== seller.toLowerCase()) {
      return jsonResponse({ error: "signer is neither buyer nor seller of this vault on-chain" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from("escrow_trade_metadata").upsert(
      {
        chain_id: chainId,
        vault_address: String(vaultAddress).toLowerCase(),
        description: description ?? null,
        milestone_labels: milestoneLabels ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chain_id,vault_address" },
    );
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
