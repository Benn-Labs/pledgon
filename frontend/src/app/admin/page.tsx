"use client";

import { useEffect, useState } from "react";
import { formatEther, isAddress, type Address } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { tryParseUnits } from "@/lib/units";
import { toast, toastTxError } from "@/lib/toast";
import { AdminIcon } from "@/components/ui/icons";
import { ListingModeration } from "@/components/marketplace/ListingModeration";
import { SuperUserPanel } from "@/components/admin/SuperUserPanel";
import { LenderRewardsPanel } from "@/components/admin/LenderRewardsPanel";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg bg-ink-800/50 border border-ink-700">
      <div className="text-xs text-ink-400 mb-1">{label}</div>
      <div className="font-mono text-lg text-ink-100 break-all">{value}</div>
    </div>
  );
}

export default function AdminPage() {
  const { address: account, isConnected } = useAccount();

  const { data: owner, refetch: refetchOwner } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "owner",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: feeRecipient, refetch: refetchFeeRecipient } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "feeRecipient",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: vaultCreationFee, refetch: refetchFee } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "vaultCreationFee",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { data: factoryBalance, refetch: refetchBalance } = useBalance({
    address: addresses.escrowFactory,
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  const [feeInput, setFeeInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [newOwnerInput, setNewOwnerInput] = useState("");

  useEffect(() => {
    if (isSuccess) {
      toast("Transaction confirmed", "success");
      refetchOwner();
      refetchFeeRecipient();
      refetchFee();
      refetchBalance();
    }
  }, [isSuccess, refetchOwner, refetchFeeRecipient, refetchFee, refetchBalance]);

  useEffect(() => {
    if (error) toastTxError(error);
  }, [error]);

  const isOwner = Boolean(account && owner && account.toLowerCase() === owner.toLowerCase());
  const busy = isPending || isConfirming;

  function setFee() {
    if (!addresses.escrowFactory || !feeInput) return;
    // The fee field is free text ("1e3" etc. passes no validation), so parse
    // defensively and explain instead of letting parseEther throw.
    const fee = tryParseUnits(feeInput, 18);
    if (fee === undefined) {
      toast("Enter a valid fee amount in ETH", "warning");
      return;
    }
    writeContract({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "setVaultCreationFee",
      args: [fee],
    });
  }

  function setRecipient() {
    if (!addresses.escrowFactory || !isAddress(recipientInput)) return;
    writeContract({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "setFeeRecipient",
      args: [recipientInput as Address],
    });
  }

  function withdraw() {
    if (!addresses.escrowFactory) return;
    writeContract({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "withdrawFees",
    });
  }

  function transferOwner() {
    if (!addresses.escrowFactory || !isAddress(newOwnerInput)) return;
    writeContract({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "transferOwnership",
      args: [newOwnerInput as Address],
    });
  }

  if (!addresses.escrowFactory) {
    return (
      <div className="fade-in max-w-lg mx-auto text-center py-16">
        <AdminIcon className="w-10 h-10 text-ink-600 mx-auto mb-4" />
        <h1 className="text-xl font-display text-ink-50 mb-2">EscrowFactory isn&apos;t configured</h1>
        <p className="text-sm text-ink-400">Set NEXT_PUBLIC_ESCROW_FACTORY_ADDRESS to use this page.</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="fade-in max-w-lg mx-auto text-center py-16">
        <AdminIcon className="w-10 h-10 text-ink-600 mx-auto mb-4" />
        <h1 className="text-xl font-display text-ink-50 mb-2">Connect the owner wallet</h1>
        <p className="text-sm text-ink-400">This page manages EscrowFactory&apos;s vault-creation fee — connect the wallet that owns it.</p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="fade-in max-w-lg mx-auto text-center py-16">
        <AdminIcon className="w-10 h-10 text-ink-600 mx-auto mb-4" />
        <h1 className="text-xl font-display text-ink-50 mb-2">Not authorized</h1>
        <p className="text-sm text-ink-400">
          Connected as <span className="font-mono text-ink-300">{account}</span>. EscrowFactory is owned by{" "}
          <span className="font-mono text-ink-300">{owner ?? "…"}</span> — connect that wallet to manage fees.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display text-ink-50 flex items-center gap-2">
          <AdminIcon className="w-7 h-7 text-trust-400" />
          Admin
        </h1>
        <p className="text-ink-400 mt-1">Fees and marketplace moderation — owner-gated, connected as the owner wallet (a multisig works via WalletConnect).</p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <h2 className="font-semibold text-ink-50 mb-4">Fee Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard label="Current Vault-Creation Fee" value={vaultCreationFee !== undefined ? `${formatEther(vaultCreationFee)} ETH` : "…"} />
          <StatCard
            label="Accumulated (withdrawable)"
            value={factoryBalance !== undefined ? `${formatEther(factoryBalance.value)} ETH` : "…"}
          />
          <StatCard label="Fee Recipient" value={feeRecipient ?? "…"} />
          <StatCard label="Owner" value={owner ?? "…"} />
        </div>
      </div>

      <ListingModeration />

      <SuperUserPanel />

      <LenderRewardsPanel />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
          <h3 className="font-semibold text-ink-50 mb-3">Set Vault-Creation Fee</h3>
          <p className="text-xs text-ink-500 mb-4">Applies immediately to every new createTrade/createTradeFor call. 0 turns fees off.</p>
          <div className="relative mb-3">
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="0.001"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">ETH</span>
          </div>
          <button
            onClick={setFee}
            disabled={!feeInput || busy}
            className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {busy ? "Submitting…" : "Update Fee"}
          </button>
        </div>

        <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
          <h3 className="font-semibold text-ink-50 mb-3">Withdraw Accumulated Fees</h3>
          <p className="text-xs text-ink-500 mb-4">
            Sends the contract&apos;s full ETH balance to the fee recipient above. Pull-based — nothing is pushed automatically.
          </p>
          <button
            onClick={withdraw}
            disabled={!factoryBalance || factoryBalance.value === 0n || busy}
            className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {busy ? "Submitting…" : "Withdraw Fees"}
          </button>
        </div>

        <div className="bg-ink-900 border border-ink-800 rounded-xl p-6">
          <h3 className="font-semibold text-ink-50 mb-3">Set Fee Recipient</h3>
          <p className="text-xs text-ink-500 mb-4">Where withdrawFees() sends the balance. Doesn&apos;t move existing owner rights.</p>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono mb-3 focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
          />
          <button
            onClick={setRecipient}
            disabled={!isAddress(recipientInput) || busy}
            className="btn-press w-full py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {busy ? "Submitting…" : "Update Recipient"}
          </button>
        </div>

        <div className="bg-ink-900 border border-danger-500/30 rounded-xl p-6">
          <h3 className="font-semibold text-ink-50 mb-3">Transfer Ownership</h3>
          <p className="text-xs text-danger-400 mb-4">
            Irreversible from here — the new owner controls the fee, recipient, and this page. Double-check the address.
          </p>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono mb-3 focus:outline-none focus:border-danger-500"
            placeholder="0x…"
            value={newOwnerInput}
            onChange={(e) => setNewOwnerInput(e.target.value)}
          />
          <button
            onClick={transferOwner}
            disabled={!isAddress(newOwnerInput) || busy}
            className="btn-press w-full py-2.5 rounded-lg bg-danger-600 hover:bg-danger-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold"
          >
            {busy ? "Submitting…" : "Transfer Ownership"}
          </button>
        </div>
      </div>
    </div>
  );
}
