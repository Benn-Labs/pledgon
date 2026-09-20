// Shared signature-freshness/format checks used by both write-*-metadata
// functions. Verifying the signature itself (verifyMessage) stays inline in
// each function since it needs the specific viem import there.

export const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Confirms `message` names exactly `expectedResource` (so a signature made
 * for one listing/vault can't be replayed against another) and was issued
 * within FRESHNESS_WINDOW_MS of now (so a captured signature can't be
 * replayed indefinitely).
 */
export function checkResourceAndFreshness(message: string, expectedResource: string): string | null {
  if (!message.includes(`Resource: ${expectedResource}`)) {
    return "signature is for a different resource";
  }
  const issuedAtMatch = message.match(/Issued At: (.+)/);
  const issuedAt = issuedAtMatch ? Date.parse(issuedAtMatch[1].trim()) : NaN;
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > FRESHNESS_WINDOW_MS) {
    return "signature expired — sign again";
  }
  return null;
}

// Edge Functions don't get CORS headers for free — without these, the
// browser blocks the request before it ever reaches this function (the
// client sees a generic "Failed to send a request to the Edge Function",
// not any error this function returns, since it's the OPTIONS preflight
// that fails). `*` is fine here: these functions require a valid EVM
// signature to do anything, so restricting the origin adds no real security.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Returns the CORS preflight response if this is an OPTIONS request, else null. */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  return null;
}
