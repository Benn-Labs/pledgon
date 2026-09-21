/**
 * The shape of a Marketplace listing's `terms` — stored as-is in the
 * `marketplace_listings.terms` jsonb column (see supabase/schema.sql), so
 * adding a field here needs no migration. Shared between the write side
 * (useSignedMetadataWrite.ts) and the read side (useListingMetadata.ts /
 * useListingMetadataMap.ts) so they can't drift apart on field names.
 *
 * Quantity/pricing themselves are NOT here — they're real on-chain fields
 * (Marketplace.sol's `totalQuantity`/`unitPrice`/`bondRatePerUnit`, read via
 * `listingPricing`), since the contract enforces them (decrementing
 * remaining supply, computing each purchase's amounts). Duplicating them
 * into this off-chain blob would just be a second, driftable copy. `unit`
 * stays here because it's purely a display label (kg, m², ...) — the
 * contract only ever deals in the numeric quantity scale, never what it
 * means.
 */
export interface ListingTerms {
  category?: string;
  location?: string;
  conditionNotes?: string;
  /** One of UNIT_OPTIONS' values (frontend/src/lib/units.ts) — display only. */
  unit?: string;
  /** Index-aligned with the on-chain milestoneBps array. */
  milestoneLabels?: string[];
}
