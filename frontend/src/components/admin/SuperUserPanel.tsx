"use client";

import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { toast, toastTxError } from "@/lib/toast";

/**
 * Owner-only: exempt a wallet from the volume/tier caps (EscrowFactory
 * .setSuperUser). A verified (admin) wallet ("super user" in the contract) is treated as top-tier (uncapped) when funding
 * a vault — meant for testing and operations, not as a compliance tier. It is
 * checked at fund() time, so a grant or revocation applies to trades that
 * already exist but aren't funded yet. Revoke every entry (or never grant
 * one) where the caps must bind everyone.
 */
export function SuperUserPanel() {
  const { address: account } = useAccount();
  const [input, setInput] = useState("");
  const target = isAddress(input) ? (input as Address) : undefined;

  const { data: isSuper, refetch } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "isSuperUser",
    args: target ? [target] : undefined,
    query: { enabled: Boolean(addresses.escrowFactory && target), retry: false },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  const busy = isPending || isConfirming;

  useEffect(() => {
    if (!isSuccess) return;
    toast("Verified (admin) list updated", "success");
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is stable; fire once per confirmed tx
  }, [isSuccess]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  function set(enabled: boolean) {
    if (!addresses.escrowFactory || !target) return;
    writeContract({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "setSuperUser",
      args: [target, enabled],
    });
  }

  return (
    <div className="bg-ink-900 border border-warning-500/30 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-ink-50 mb-1">Verified (admin) Wallets</h3>
      <p className="text-xs text-ink-500 mb-4">
        A wallet marked verified (admin) is treated as top-tier (uncapped) when funding a trade. This is an admin decision, not a KYC
        result — it does not change the wallet&apos;s on-chain KYC tier. Their volume is not recorded. Applies at
        funding time, so it covers trades created but not yet funded. Anyone not listed keeps the normal caps.
      </p>
      <input
        className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono mb-2 focus:outline-none focus:border-warning-500"
        placeholder="0x… wallet address"
        value={input}
        onChange={(e) => setInput(e.target.value.trim())}
      />
      <div className="flex items-center justify-between mb-3 min-h-5">
        {account && (
          <button type="button" onClick={() => setInput(account)} className="text-xs text-trust-400 hover:text-trust-300">
            Use my wallet
          </button>
        )}
        {target && isSuper !== undefined && (
          <span className={`text-xs font-medium ${isSuper ? "text-success-400" : "text-ink-500"}`}>
            {isSuper ? "Currently verified (admin)" : "Not verified (admin)"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => set(true)}
          disabled={!target || busy || isSuper === true}
          className="btn-press py-2.5 rounded-lg bg-warning-600 hover:bg-warning-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
        >
          {busy ? "Submitting…" : "Grant"}
        </button>
        <button
          onClick={() => set(false)}
          disabled={!target || busy || isSuper === false}
          className="btn-press py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 disabled:opacity-50 disabled:cursor-not-allowed text-ink-50 font-semibold"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}
