"use client";

import type { ComponentType } from "react";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplaceCategories";
import { GridIcon, BriefcaseIcon, BuildingIcon, BoxIcon, SparklesIcon } from "@/components/ui/icons";

type TileIcon = ComponentType<{ className?: string }>;

const ICONS: Record<string, TileIcon> = {
  freelance: BriefcaseIcon,
  realestate: BuildingIcon,
  goods: BoxIcon,
  custom: SparklesIcon,
};

// Hue washes for the fallback artwork, drawn from the app's palette.
const TINTS: Record<string, string> = {
  all: "from-trust-700/70 via-ink-800 to-ink-900",
  freelance: "from-trust-600/50 via-ink-800 to-ink-900",
  realestate: "from-success-600/40 via-ink-800 to-ink-900",
  goods: "from-warning-600/40 via-ink-800 to-ink-900",
  custom: "from-ink-600 via-ink-800 to-ink-900",
};

export const ALL_CATEGORIES = "all";

/**
 * Filter picker for the marketplace grid. Each tile shows its category's
 * generated artwork (`MarketplaceCategory.thumbnail`) when one exists, else a
 * tinted gradient with the category icon — so dropping images into /public
 * and setting the path is the only step needed later.
 */
export function CategoryTiles({
  selected,
  onSelect,
  counts,
  total,
}: {
  selected: string;
  onSelect: (id: string) => void;
  counts: Record<string, number>;
  total: number;
}) {
  const tiles = [
    { id: ALL_CATEGORIES, label: "All listings", icon: GridIcon, thumbnail: undefined as string | undefined, count: total },
    ...MARKETPLACE_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      icon: ICONS[c.id] ?? SparklesIcon,
      thumbnail: c.thumbnail,
      count: counts[c.id] ?? 0,
    })),
  ];

  return (
    <div role="radiogroup" aria-label="Filter by category" className="mb-8 flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {tiles.map(({ id, label, icon: Icon, thumbnail, count }) => {
        const active = selected === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(id)}
            className={`category-tile group relative flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border text-left ${
              active ? "category-tile-active border-trust-500" : "border-ink-800 hover:border-ink-600"
            }`}
          >
            <div className="relative h-24 shrink-0 overflow-hidden bg-ink-900">
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- static local artwork, no optimisation needed
                <img src={thumbnail} alt="" className="category-tile-art h-full w-full object-cover" />
              ) : (
                <div className={`category-tile-art flex h-full w-full items-center justify-center bg-gradient-to-br ${TINTS[id] ?? TINTS.custom}`}>
                  <Icon className={`h-9 w-9 transition-colors ${active ? "text-trust-300" : "text-ink-300 group-hover:text-ink-50"}`} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 to-transparent" />
              <span className="absolute right-2 top-2 rounded-full border border-ink-700 bg-ink-950/70 px-2 py-0.5 font-mono text-[11px] text-ink-200 backdrop-blur">
                {count}
              </span>
            </div>
            <div className={`flex flex-1 items-center px-3 py-2.5 text-sm font-semibold leading-tight ${active ? "bg-ink-800 text-ink-50" : "bg-ink-900 text-ink-200"}`}>
              {label}
            </div>
          </button>
        );
      })}
    </div>
  );
}
