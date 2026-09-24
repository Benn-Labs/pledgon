// Uploads the delivery-document file backing one EscrowVault milestone's
// docHash — only if the caller proves, by EVM signature, that they control
// the vault's seller address (submitMilestoneDocs is seller-only on-chain,
// so only the seller's upload is ever meaningful here). Stores the raw file
// in the "milestone-documents" Storage bucket and records its path in
// escrow_milestone_documents, so a buyer deciding whether to confirm the
// milestone can actually open the document the on-chain docHash commits to,
// not just see an opaque hex string.
//
// Expects a multipart/form-data POST with fields:
//   address, signature, message, chainId, vaultAddress, milestoneIndex,
//   docHash, file
//
// `message` must be the exact string the client had the wallet sign, and
// must contain a line `Resource: escrow:<chainId>:<vaultAddress
// lowercased>:milestone:<milestoneIndex>` and a line
// `Issued At: <ISO timestamp>` — see
// frontend/src/hooks/useSignedMilestoneDocumentWrite.ts for how the client
// builds it.
//
// `docHash` must equal keccak256 of the uploaded file's exact bytes — this
// function recomputes it server-side and rejects a mismatch, so a row here
// is always a genuine preimage of the hash it's filed under, never an
// unrelated file someone attached to a hash they don't actually have.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyMessage, keccak256 } from "npm:viem@2";
import { checkResourceAndFreshness, handleCorsPreflight, jsonResponse } from "../_shared/auth.ts";

const VAULT_ABI = [{ type: "function", name: "seller", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

// Comfortably under Supabase Edge Functions' request-body limit — raise if
// that limit is confirmed higher on the deployed project's plan.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  try {
    const form = await req.formData();
    const address = form.get("address");
    const signature = form.get("signature");
    const rawMessage = form.get("message");
    const chainId = form.get("chainId");
    const vaultAddress = form.get("vaultAddress");
    const milestoneIndex = form.get("milestoneIndex");
    const docHash = form.get("docHash");
    const file = form.get("file");

    if (
      typeof address !== "string" ||
      typeof signature !== "string" ||
      typeof rawMessage !== "string" ||
      typeof chainId !== "string" ||
      typeof vaultAddress !== "string" ||
      typeof milestoneIndex !== "string" ||
      typeof docHash !== "string" ||
      !(file instanceof File)
    ) {
      return jsonResponse(
        { error: "address, signature, message, chainId, vaultAddress, milestoneIndex, docHash, file are required" },
        400,
      );
    }
    // Reverses the client's encodeURIComponent(message) — see
    // useSignedMilestoneDocumentWrite.ts for why the message can't travel as
    // a raw multipart field: FormData's own serialization normalizes every
    // bare \n/\r in a string field to \r\n, which would silently change the
    // bytes being verified here versus what the wallet actually signed.
    const message = decodeURIComponent(rawMessage);

    if (file.size > MAX_FILE_BYTES) {
      return jsonResponse({ error: `file too large — ${MAX_FILE_BYTES / (1024 * 1024)}MB max` }, 400);
    }

    const valid = await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
    if (!valid) return jsonResponse({ error: "signature does not match address" }, 401);

    const expectedResource = `escrow:${chainId}:${vaultAddress.toLowerCase()}:milestone:${milestoneIndex}`;
    const freshnessError = checkResourceAndFreshness(message, expectedResource);
    if (freshnessError) return jsonResponse({ error: freshnessError }, 401);

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const actualHash = keccak256(fileBytes);
    if (actualHash.toLowerCase() !== docHash.toLowerCase()) {
      return jsonResponse({ error: "docHash does not match the uploaded file's actual content" }, 400);
    }

    const rpcUrl = Deno.env.get("RPC_URL");
    if (!rpcUrl) return jsonResponse({ error: "server misconfigured: RPC_URL not set" }, 500);

    const { createPublicClient, http } = await import("npm:viem@2");
    const client = createPublicClient({ transport: http(rpcUrl) });
    const seller = (await client.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: "seller",
    })) as string;

    if (address.toLowerCase() !== seller.toLowerCase()) {
      return jsonResponse({ error: "signer is not this vault's seller on-chain" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server misconfigured: Supabase env vars not set" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const vaultLower = vaultAddress.toLowerCase();
    // Timestamp-prefixed so resubmitting a milestone's docs never collides
    // with (or overwrites) the previous file — only the DB row's pointer
    // moves; the old object is simply left orphaned in storage.
    const storagePath = `${chainId}/${vaultLower}/${milestoneIndex}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("milestone-documents")
      .upload(storagePath, fileBytes, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) return jsonResponse({ error: uploadError.message }, 500);

    const { error: dbError } = await supabase.from("escrow_milestone_documents").upsert(
      {
        chain_id: Number(chainId),
        vault_address: vaultLower,
        milestone_index: Number(milestoneIndex),
        storage_path: storagePath,
        original_filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        doc_hash: docHash.toLowerCase(),
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "chain_id,vault_address,milestone_index" },
    );
    if (dbError) return jsonResponse({ error: dbError.message }, 500);

    return jsonResponse({ ok: true, storagePath });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
