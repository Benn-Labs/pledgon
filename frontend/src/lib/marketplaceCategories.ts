import type { UnitValue } from "./units";

export interface MilestoneTemplateItem {
  label: string;
  /** Percentage of every purchase's total this milestone gets on-chain (Marketplace.milestoneBps, ×100). Sums to 100 across a template. */
  weightPercent: number;
}

export interface MarketplaceCategory {
  id: string;
  label: string;
  defaultUnit: UnitValue;
  /**
   * The milestone breakdown this category prefills on selection — both the
   * labels and percentage split (the actual amount only exists once a buyer
   * picks a purchase quantity, computed on-chain). Empty for Custom: sellers
   * who don't fit a template build their own from scratch, same as before
   * this feature existed.
   */
  milestones: MilestoneTemplateItem[];
}

/**
 * Real-world milestone structures, not development placeholders — each one
 * mirrors how that kind of deal actually gets paid out in practice (a
 * deposit/kickoff portion, a delivery-triggered portion, a final-acceptance
 * portion), not an arbitrary even split.
 */
export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  {
    id: "freelance",
    label: "Freelance / Service",
    defaultUnit: "unit",
    milestones: [
      { label: "Deposit / Kickoff", weightPercent: 30 },
      { label: "Milestone Delivery", weightPercent: 40 },
      { label: "Final Delivery & Acceptance", weightPercent: 30 },
    ],
  },
  {
    id: "realestate",
    label: "Real Estate / Property",
    defaultUnit: "m2",
    milestones: [
      { label: "Earnest Deposit", weightPercent: 10 },
      { label: "Title Transfer Verified", weightPercent: 30 },
      { label: "Closing & Possession", weightPercent: 60 },
    ],
  },
  {
    id: "goods",
    label: "Goods / Physical Item",
    defaultUnit: "kg",
    milestones: [
      { label: "Order Confirmed", weightPercent: 25 },
      { label: "Shipped", weightPercent: 35 },
      { label: "Delivered & Confirmed", weightPercent: 40 },
    ],
  },
  {
    id: "custom",
    label: "Custom",
    defaultUnit: "unit",
    milestones: [],
  },
];

/** Matches Marketplace.sol's BPS_DENOMINATOR. */
export const BPS_DENOMINATOR = 10_000;

/** Sum of a set of percentage inputs — used to validate they total exactly 100 before submitting. */
export function sumPercent(values: number[]): number {
  return values.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
}

/**
 * Converts percentage inputs (summing to ~100) to on-chain basis points that
 * sum to EXACTLY `BPS_DENOMINATOR` — Marketplace.createListing reverts
 * otherwise. Each value rounds independently, then the last absorbs
 * whatever rounding left over, mirroring the same "last slice takes the
 * remainder" convention Marketplace.sol itself uses when splitting a
 * purchase's total by these bps.
 */
export function toMilestoneBps(percents: number[]): number[] {
  const bps = percents.map((p) => Math.round((Number.isFinite(p) ? p : 0) * 100));
  if (bps.length === 0) return bps;
  const allocated = bps.slice(0, -1).reduce((sum, v) => sum + v, 0);
  bps[bps.length - 1] = BPS_DENOMINATOR - allocated;
  return bps;
}
