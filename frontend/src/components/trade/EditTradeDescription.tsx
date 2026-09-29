"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { useSignedEscrowMetadataWrite } from "@/hooks/useSignedMetadataWrite";
import { saveTradeDescription } from "@/lib/tradeDescriptions";
import { toast, toastTxError } from "@/lib/toast";

/**
 * Lets the buyer or seller set or update the trade's shared description.
 * Saving signs a message proving control of the connected address — the
 * write-escrow-metadata Edge Function checks on-chain that the signer is
 * actually a party to this vault before it takes effect.
 */
export function EditTradeDescription({ vault, description }: { vault: Address; description: string }) {
  const chainId = useChainId();
  const { write, isPending } = useSignedEscrowMetadataWrite();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description);

  async function save() {
    const { ok, error } = await write({ chainId, vaultAddress: vault, description: value });
    if (ok) {
      saveTradeDescription(vault, value);
      toast("Description saved", "success");
      setEditing(false);
    } else {
      toastTxError(error, "Couldn't save");
    }
  }

  if (!editing) {
    return (
      <div className="mt-2 flex items-start gap-2">
        {description ? (
          <p className="text-sm text-ink-300 max-w-lg">{description}</p>
        ) : (
          <p className="text-sm text-ink-500 italic">No description set</p>
        )}
        <button
          onClick={() => {
            setValue(description);
            setEditing(true);
          }}
          className="text-xs text-trust-400 hover:text-trust-300 font-medium shrink-0"
        >
          {description ? "Edit" : "Add description"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-lg">
      <textarea
        rows={2}
        autoFocus
        className="w-full bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500 resize-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={save}
          disabled={isPending}
          className="btn-press px-3 py-1.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:opacity-40 text-white text-xs font-semibold"
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
