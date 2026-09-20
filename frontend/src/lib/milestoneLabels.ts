import type { Address } from "viem";

/**
 * EscrowFactory.createTrade() only accepts a bare uint256[] of amounts —
 * there's no field for a milestone title/description anywhere on-chain,
 * and no metadataURI param like Marketplace.createListing has. So a
 * per-milestone label can only ever be a local convenience: saved in this
 * browser's localStorage keyed by vault address, readable back on this
 * same device, but invisible to the counterparty and lost if cleared.
 * Never treat a missing entry as an error — it just means either no
 * labels were set, or you're not the browser that created this trade.
 */
const PREFIX = "pledgon:milestoneLabels:";

export function saveMilestoneLabels(vault: Address, labels: string[]) {
  try {
    localStorage.setItem(PREFIX + vault.toLowerCase(), JSON.stringify(labels));
  } catch {
    // localStorage can throw (private browsing, quota, disabled) — losing
    // this local-only convenience isn't worth failing the trade creation.
  }
}

export function getMilestoneLabels(vault: Address): string[] | null {
  try {
    const raw = localStorage.getItem(PREFIX + vault.toLowerCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
