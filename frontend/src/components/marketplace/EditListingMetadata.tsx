"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { useSignedListingMetadataWrite } from "@/hooks/useSignedMetadataWrite";
import type { ListingMetadata } from "@/hooks/useListingMetadata";
import { toast } from "@/lib/toast";

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
 */
export function EditListingMetadata({
  marketplaceAddress,
  listingId,
  metadata,
  onSaved,
}: {
  marketplaceAddress: Address;
  listingId: number;
  metadata: ListingMetadata;
  onSaved: (next: ListingMetadata) => void;
}) {
  const chainId = useChainId();
  const { write, isPending } = useSignedListingMetadataWrite();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(metadata.title);
  const [thumbnailUrl, setThumbnailUrl] = useState(metadata.thumbnailUrl);
  const [description, setDescription] = useState(metadata.description);
  const [location, setLocation] = useState(metadata.terms.location ?? "");
  const [conditionNotes, setConditionNotes] = useState(metadata.terms.conditionNotes ?? "");

  async function save() {
    const terms = { ...metadata.terms, location, conditionNotes };
    const { ok, error } = await write({ chainId, marketplaceAddress, listingId, title, thumbnailUrl, description, terms });
    if (ok) {
      toast("Listing details saved", "success");
      onSaved({ ...metadata, title, thumbnailUrl, description, terms });
      setEditing(false);
    } else {
      toast(error ?? "Couldn't save", "error");
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="btn-press px-3 py-1.5 rounded-lg border border-trust-600/40 text-trust-400 hover:bg-trust-500/10 text-xs font-medium"
      >
        Edit title, thumbnail & description
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
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-ink-400 mb-1">Thumbnail Image URL</label>
        <input
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 font-mono focus:outline-none focus:border-trust-500"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ink-400 mb-1">Location</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-ink-400 mb-1">Condition / Delivery Notes</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
            value={conditionNotes}
            onChange={(e) => setConditionNotes(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-ink-400 mb-1">Description</label>
        <textarea
          rows={3}
          className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500 resize-none"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={isPending}
          className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:opacity-40 text-white text-sm font-semibold"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-ink-500 hover:text-ink-300">
          Cancel
        </button>
      </div>
    </div>
  );
}
