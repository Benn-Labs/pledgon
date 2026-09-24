# PLEDGON discovery-layer DB (Supabase)

Off-chain metadata only — thumbnails, descriptions, structured terms for
Marketplace listings and Escrow trades. Never a source of truth for funds or
trade terms; those stay on-chain in `EscrowVault`/`Marketplace`. If this DB
were wiped, no trade's obligations would change — buyers/sellers would just
lose thumbnails, descriptions, and labels.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Run `schema.sql` in the SQL Editor (Supabase dashboard → SQL Editor → paste
   and run). This creates the tables (RLS allowing public read only) and the
   public `milestone-documents` Storage bucket milestone documents upload into.
3. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you
   don't have it, then from this `supabase/` directory:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
4. Set the Edge Function secrets (never put these in frontend `.env` files —
   they're server-side only):
   ```bash
   supabase secrets set RPC_URL="<your Sepolia RPC URL>"
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
   by Supabase for every Edge Function — no need to set them yourself.
5. Deploy the functions:
   ```bash
   supabase functions deploy write-listing-metadata
   supabase functions deploy write-escrow-metadata
   supabase functions deploy write-milestone-document
   ```
6. Give the frontend the project URL and **anon** key (Project Settings → API)
   — set in `frontend/.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
   Never put the **service_role** key in a frontend env file — it bypasses
   RLS entirely and must only ever live in Supabase's own function secrets.

## How writes are authorized

There's no username/password auth here — a seller or trade party proves
control of their address by signing a plain-text message with their wallet
(`frontend/src/hooks/useSignedMetadataWrite.ts` builds it). The Edge Function:

1. Verifies the signature actually recovers to the claimed address.
2. Checks the signed message names this exact resource and was issued in the
   last 5 minutes (so one signature can't be replayed against a different
   listing/vault, or reused indefinitely).
3. Reads the chain directly to confirm that address is genuinely this
   listing's `seller` (or a `buyer`/`seller` party to this vault) —
   the actual authorization boundary, since RLS can't check an ECDSA
   signature.
4. Only then writes, using the service-role key from inside the function.

This mirrors Garantor's `tonProof`-gated marketplace metadata writes,
adapted to Ethereum's signature scheme instead of TON's.

## Local testing

```bash
supabase start        # local Postgres + Edge Functions runtime
supabase db reset      # applies schema.sql to the local instance
supabase functions serve --env-file .env.local  # RPC_URL etc. for local runs
```
