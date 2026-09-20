import type { Address } from "viem";

/**
 * A whole-trade description for direct (non-marketplace) escrows — same
 * local-only tradeoff as milestoneLabels.ts, and for the same reason:
 * EscrowFactory.createTrade()/createTradeFor() take no metadata field at
 * all. Saved in this browser's localStorage keyed by vault address, so it's
 * a personal reference for whoever created the trade, not something the
 * counterparty automatically sees. Marketplace listings are different —
 * Marketplace.createListing() has a real on-chain `metadataURI` seller and
 * buyer both read, so that flow doesn't need this.
 */
const PREFIX = "pledgon:tradeDescription:";

export function saveTradeDescription(vault: Address, description: string) {
  try {
    if (description.trim() === "") {
      localStorage.removeItem(PREFIX + vault.toLowerCase());
      return;
    }
    localStorage.setItem(PREFIX + vault.toLowerCase(), description);
  } catch {
    // localStorage can throw (private browsing, quota, disabled) — losing
    // this local-only convenience isn't worth failing the trade creation.
  }
}

export function getTradeDescription(vault: Address): string | null {
  try {
    return localStorage.getItem(PREFIX + vault.toLowerCase());
  } catch {
    return null;
  }
}
