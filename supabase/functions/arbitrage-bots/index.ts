// Registers and queries user-owned FlashArbV3 arbitrage bots.
//
// POST /arbitrage-bots
//   Records a bot deployment. Requires an EVM signature proving the caller
//   controls the address that owns the bot on-chain.
//   Body: { address, signature, message, chainId, botAddress }
//   `message` must contain `Resource: arbitrage:<chainId>:<botAddress lowercased>`
//   and `Issued At: <ISO timestamp>`.
//
// GET /arbitrage-bots?owner=0x...&chainId=...
//   Lists bots owned by `owner` on `chainId`.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyMessage } from "npm:viem@2";
import { checkResourceAndFreshness, handleCorsPreflight, jsonResponse } from "../_shared/auth.ts";

const FLASH_ARB_BOT_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method === "GET") {
    return handleGet(req);
  }
  if (req.method === "POST") {
    return handlePost(req);
  }
  return jsonResponse({ error: "GET or POST only" }, 405);
});

async function handleGet(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner");
    const chainId = url.searchParams.get("chainId");

    if (!owner || !chainId) {
      return jsonResponse({ error: "owner and chainId query params are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("arbitrage_bots")
      .select("bot_address, owner_address, deployed_at, updated_at")
      .eq("chain_id", Number(chainId))
      .eq("owner_address", owner.toLowerCase())
      .order("deployed_at", { ascending: false });

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ bots: data ?? [] });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
}

async function handlePost(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { address, signature, message, chainId, botAddress } = body ?? {};

    if (!address || !signature || !message || !chainId || !botAddress) {
      return jsonResponse(
        { error: "address, signature, message, chainId, botAddress are required" },
        400,
      );
    }

    const valid = await verifyMessage({ address, message, signature });
    if (!valid) return jsonResponse({ error: "signature does not match address" }, 401);

    const expectedResource = `arbitrage:${chainId}:${String(botAddress).toLowerCase()}`;
    const freshnessError = checkResourceAndFreshness(message, expectedResource);
    if (freshnessError) return jsonResponse({ error: freshnessError }, 401);

    const rpcUrl = Deno.env.get("RPC_URL");
    if (!rpcUrl) return jsonResponse({ error: "server misconfigured: RPC_URL not set" }, 500);

    const { createPublicClient, http } = await import("npm:viem@2");
    const client = createPublicClient({ transport: http(rpcUrl) });
    const onChainOwner = (await client.readContract({
      address: botAddress,
      abi: FLASH_ARB_BOT_ABI,
      functionName: "owner",
    })) as string;

    if (onChainOwner.toLowerCase() !== String(address).toLowerCase()) {
      return jsonResponse({ error: "signer is not this bot's owner on-chain" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from("arbitrage_bots").upsert(
      {
        chain_id: Number(chainId),
        bot_address: String(botAddress).toLowerCase(),
        owner_address: String(address).toLowerCase(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chain_id,bot_address" },
    );
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
}
