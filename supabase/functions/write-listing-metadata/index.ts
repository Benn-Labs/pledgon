// Writes discovery-layer metadata (thumbnail, description, structured terms)
// for one Marketplace listing — only if the caller proves, by EVM signature,
// that they control the address the chain actually records as that
// listing's seller. Never touches funds or any on-chain state; this is
// purely the presentation layer described in supabase/schema.sql.
//
// Expects POST JSON:
//   { address, signature, message, chainId, marketplaceAddress, listingId,
//     title?, description?, thumbnailUrl?, terms? }
//
// `message` must be the exact string the client had the wallet sign, and
// must contain a line `Resource: marketplace:<chainId>:<marketplaceAddress
// lowercased>:<listingId>` and a line `Issued At: <ISO timestamp>` — see
// frontend/src/lib/signedMetadata.ts for how the client builds it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyMessage } from "npm:viem@2";
import { checkResourceAndFreshness, handleCorsPreflight, jsonResponse } from "../_shared/auth.ts";

const MARKETPLACE_ABI = [
  {
    type: "function",
    name: "listings",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "arbiter", type: "address" },
      { name: "token", type: "address" },
      { name: "bondAmount", type: "uint256" },
      { name: "metadataURI", type: "string" },
      { name: "status", type: "uint8" },
      { name: "vault", type: "address" },
    ],
  },
] as const;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  try {
    const body = await req.json();
    const { address, signature, message, chainId, marketplaceAddress, listingId, title, description, thumbnailUrl, terms } =
      body ?? {};

    if (!address || !signature || !message || !chainId || !marketplaceAddress || listingId === undefined) {
      return jsonResponse({ error: "address, signature, message, chainId, marketplaceAddress, listingId are required" }, 400);
    }

    const valid = await verifyMessage({ address, message, signature });
    if (!valid) return jsonResponse({ error: "signature does not match address" }, 401);

    const expectedResource = `marketplace:${chainId}:${String(marketplaceAddress).toLowerCase()}:${listingId}`;
    const freshnessError = checkResourceAndFreshness(message, expectedResource);
    if (freshnessError) return jsonResponse({ error: freshnessError }, 401);

    const rpcUrl = Deno.env.get("RPC_URL");
    if (!rpcUrl) return jsonResponse({ error: "server misconfigured: RPC_URL not set" }, 500);

    const { createPublicClient, http } = await import("npm:viem@2");
    const client = createPublicClient({ transport: http(rpcUrl) });
    const listing = (await client.readContract({
      address: marketplaceAddress,
      abi: MARKETPLACE_ABI,
      functionName: "listings",
      args: [BigInt(listingId)],
    })) as readonly [string, string, string, bigint, string, number, string];

    const onChainSeller = listing[0];
    if (onChainSeller.toLowerCase() !== String(address).toLowerCase()) {
      return jsonResponse({ error: "signer is not this listing's seller on-chain" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from("marketplace_listings").upsert(
      {
        chain_id: chainId,
        marketplace_address: String(marketplaceAddress).toLowerCase(),
        listing_id: listingId,
        seller_address: onChainSeller.toLowerCase(),
        title: title ?? null,
        description: description ?? null,
        thumbnail_url: thumbnailUrl ?? null,
        terms: terms ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chain_id,marketplace_address,listing_id" },
    );
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
