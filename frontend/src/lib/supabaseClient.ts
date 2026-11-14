import { createClient } from "@supabase/supabase-js";

/**
 * The discovery-layer DB (see supabase/schema.sql) — thumbnails,
 * descriptions, structured terms for Marketplace listings and Escrow
 * trades. Never a source of truth for funds or trade terms; those stay
 * on-chain. Uses the anon key only: reads are public via RLS, and writes go
 * through signature-verified Edge Functions (see signedMetadata.ts), never
 * a direct table write from the client.
 */
export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured ? createClient(url!, anonKey!) : undefined;
