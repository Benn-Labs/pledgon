"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { useSignedListingMetadataWrite } from "@/hooks/useSignedMetadataWrite";
import { useListingMetadata, type ListingMetadata } from "@/hooks/useListingMetadata";
import { toast, toastTxError } from "@/lib/toast";
import { MARKETPLACE_CATEGORIES } from "@/lib/marketplaceCategories";
import { UNIT_OPTIONS } from "@/lib/units";

/**
 * Lets the seller set or update a listing's title/thumbnail/description/
 * terms in the Supabase discovery layer. This title is separate from the
 * on-chain `metadataURI`, which is immutable once the listing is created
 * (Marketplace.sol has no update function for it) — a listing made without
 * one, or one that just needs a better title later, can still get one here,
 * since display logic everywhere already prefers this Supabase title over
 * the on-chain fallback. Saving signs a message the write-listing-metadata
 * Edge Function checks against the listing's actual on-chain seller before
 * it takes effect.
 *
 * The `metadata` prop resolves asynchronously (Supabase) and arrives as
 * blanks first, so the field state below can't just be seeded once at
 * mount: a useEffect refills every field the user hasn't touched yet
 * whenever the prop lands, and Save stays disabled until it has.
 */
export function EditListingMetadata({
  marketplaceAddress,
  listingId,
  metadata,
  onSaved,
  milestoneCount = 0,
}: {
  marketplaceAddress: Address;
  listingId: number;
  metadata: ListingMetadata;
  onSaved: (next: ListingMetadata) => void;
  /** Number of on-chain milestones, so each can be given a name. */
  milestoneCount?: number;
}) {
  const chainId = useChainId();
  const { write, isPending } = useSignedListingMetadataWrite();
  const { isLoading: metadataLoading } = useListingMetadata(marketplaceAddress, listingId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(metadata.title);
  const [thumbnailUrl, setThumbnailUrl] = useState(metadata.thumbnailUrl);
  const [description, setDescription] = useState(metadata.description);
  const [location, setLocation] = useState(metadata.terms.location ?? "");
  const [conditionNotes, setConditionNotes] = useState(metadata.terms.conditionNotes ?? "");
  const [category, setCategory] = useState(metadata.terms.category ?? "");
  const [unit, setUnit] = useState(metadata.terms.unit ?? "");
  const labelsOf = (m: ListingMetadata) => Array.from({ length: milestoneCount }, (_, i) => m.terms.milestoneLabels?.[i] ?? "");
  const [milestoneLabels, setMilestoneLabels] = useState<string[]>(() => labelsOf(metadata));

  // Fields the user has edited are theirs — a later prop update (the
  // Supabase row landing, or onSaved feeding back through the parent) must
  // not clobber them; everything untouched follows the prop.
  const dirtyFields = useRef<Set<string>>(new Set());
  const lastListingId = useRef(listingId);

  useEffect(() => {
    if (lastListingId.current !== listingId) {
      lastListingId.current = listingId;
      dirtyFields.current.clear();
      setTitle(metadata.title);
      setThumbnailUrl(metadata.thumbnailUrl);
      setDescription(metadata.description);
      setLocation(metadata.terms.location ?? "");
      setConditionNotes(metadata.terms.conditionNotes ?? "");
      setCategory(metadata.terms.category ?? "");
      setUnit(metadata.terms.unit ?? "");
      setMilestoneLabels(labelsOf(metadata));
      return;
    }
    if (!dirtyFields.current.has("title")) setTitle(metadata.title);
    if (!dirtyFields.current.has("thumbnailUrl")) setThumbnailUrl(metadata.thumbnailUrl);
    if (!dirtyFields.current.has("description")) setDescription(metadata.description);
    if (!dirtyFields.current.has("location")) setLocation(metadata.terms.location ?? "");
    if (!dirtyFields.current.has("conditionNotes")) setConditionNotes(metadata.terms.conditionNotes ?? "");
    if (!dirtyFields.current.has("category")) setCategory(metadata.terms.category ?? "");
    if (!dirtyFields.current.has("unit")) setUnit(metadata.terms.unit ?? "");
    if (!dirtyFields.current.has("milestoneLabels")) setMilestoneLabels(labelsOf(metadata));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelsOf is a pure helper of (metadata, milestoneCount)
  }, [metadata, listingId, milestoneCount]);

  async function save() {
    const terms = {
      ...metadata.terms,
      location,
      conditionNotes,
      ...(category ? { category } : {}),
      ...(unit ? { unit } : {}),
      // Index-aligned with the on-chain milestoneBps; only stored once at least one is named.
      ...(milestoneLabels.some((l) => l.trim()) ? { milestoneLabels: milestoneLabels.map((l) => l.trim()) } : {}),
    };
    const { ok, error } = await write({ chainId, marketplaceAddress, listingId, title, thumbnailUrl, description, terms });
    if (ok) {
      toast("Listing details saved", "success");
      onSaved({ ...metadata, title, thumbnailUrl, description, terms });
      setEditing(false);
    } else {
      toastTxError(error, "Couldn't save");
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="btn-press px-3 py-1.5 rounded-lg border border-trust-600/40 text-trust-400 hover:bg-trust-500/10 text-xs font-medium"
      >
        Edit listing details
      </button>
    );
  }

  return (
    <div className="p-4 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] space-y-3">
      <div>
        <label className="block text-xs text-ink-400 mb-1">Title</label>
        <input
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
          value={title}
          onChange={(e) => {
            dirtyFields.current.add("title");
            setTitle(e.target.value);
          }}
        />
      </div>
      <div>
        <label className="block text-xs text-ink-400 mb-1">Thumbnail Image URL</label>
        <input
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 font-mono focus:outline-none focus:border-trust-500"
          value={thumbnailUrl}
          onChange={(e) => {
            dirtyFields.current.add("thumbnailUrl");
            setThumbnailUrl(e.target.value);
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ink-400 mb-1">Category</label>
          <select
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            value={category}
            onChange={(e) => {
              dirtyFields.current.add("category");
              setCategory(e.target.value);
            }}
          >
            <option value="">Not set</option>
            {MARKETPLACE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.label}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-400 mb-1">Price unit</label>
          <select
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            value={unit}
            onChange={(e) => {
              dirtyFields.current.add("unit");
              setUnit(e.target.value);
            }}
          >
            <option value="">Not set</option>
            {UNIT_OPTIONS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ink-400 mb-1">Location</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            value={location}
            onChange={(e) => {
              dirtyFields.current.add("location");
              setLocation(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="block text-xs text-ink-400 mb-1">Condition / Delivery Notes</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            value={conditionNotes}
            onChange={(e) => {
              dirtyFields.current.add("conditionNotes");
              setConditionNotes(e.target.value);
            }}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-ink-400 mb-1">Description</label>
        <textarea
          rows={3}
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500 resize-none"
          value={description}
          onChange={(e) => {
            dirtyFields.current.add("description");
            setDescription(e.target.value);
          }}
        />
      </div>
      {milestoneCount > 0 && (
        <div>
          <label className="block text-xs text-ink-400 mb-1">Milestone names</label>
          <div className="space-y-2">
            {milestoneLabels.map((label, i) => (
              <input
                key={i}
                className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
                placeholder={`Milestone ${i + 1}`}
                value={label}
                onChange={(e) => {
                  dirtyFields.current.add("milestoneLabels");
                  setMilestoneLabels((prev) => prev.map((l, n) => (n === i ? e.target.value : l)));
                }}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={isPending || metadataLoading}
          className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:opacity-40 text-white text-sm font-semibold"
        >
          {metadataLoading ? "Loading…" : isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-ink-500 hover:text-ink-300">
          Cancel
        </button>
      </div>
    </div>
  );
}
