"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, parseUnits, type Address } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { toast } from "@/lib/toast";

export default function CreateListingPage() {
  const router = useRouter();
  const { address: account, isConnected } = useAccount();

  const [tokenInput, setTokenInput] = useState("");
  const [bondInput, setBondInput] = useState("0");
  const [milestoneInputs, setMilestoneInputs] = useState<string[]>([""]);
  const [arbiterInput, setArbiterInput] = useState("");
  const [metadataURI, setMetadataURI] = useState("");

  const token = isAddress(tokenInput) ? (tokenInput as Address) : undefined;
  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  const arbiterIsSeller =
    isAddress(arbiterInput) && account && arbiterInput.toLowerCase() === account.toLowerCase();

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  if (isSuccess) {
    toast("Listing created successfully", "success");
    router.push("/");
  }
  if (error) {
    toast(error.message, "error");
  }

  function updateMilestone(index: number, value: string) {
    setMilestoneInputs((prev) => prev.map((m, i) => (i === index ? value : m)));
  }

  function addMilestone() {
    setMilestoneInputs((prev) => [...prev, ""]);
  }

  function removeMilestone(index: number) {
    setMilestoneInputs((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    if (!addresses.marketplace || !token || decimals === undefined || !isAddress(arbiterInput)) return;

    const bondAmount = parseUnits(bondInput || "0", decimals);
    const milestoneAmounts = milestoneInputs
      .filter((m) => m.trim() !== "")
      .map((m) => parseUnits(m, decimals));

    writeContract({
      address: addresses.marketplace,
      abi: marketplaceAbi,
      functionName: "createListing",
      args: [token, bondAmount, milestoneAmounts, arbiterInput as Address, metadataURI],
    });
  }

  const milestoneTotal = milestoneInputs.reduce((sum, m) => sum + (parseFloat(m) || 0), 0);

  const canSubmit =
    isConnected &&
    Boolean(token) &&
    tokenReady &&
    isAddress(arbiterInput) &&
    !arbiterIsSeller &&
    milestoneInputs.some((m) => m.trim() !== "") &&
    !isPending &&
    !isConfirming;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Create Listing</h1>
        <p className="text-ink-400 mt-1">List your service or asset with milestone-based escrow protection</p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Payment Token Address</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            {token && tokenReady
              ? `${symbol}, ${decimals} decimals — tier caps assume ~1:1 USD peg for stablecoins`
              : token && !tokenReady
                ? "Reading token…"
                : "Tier caps assume ~1:1 USD peg for stablecoins"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Seller Bond Amount</label>
          <div className="relative">
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="0.00"
              value={bondInput}
              onChange={(e) => setBondInput(e.target.value)}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">{symbol ?? "token"}</span>
          </div>
          <p className="text-xs text-ink-500 mt-1">
            This bond is locked during the trade and returned upon completion. It can be slashed if you fail to
            deliver.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Arbiter Address</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={arbiterInput}
            onChange={(e) => setArbiterInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            Must be a different address from your wallet. The arbiter resolves disputes and can slash your bond.
          </p>
          {arbiterIsSeller && (
            <div className="mt-2 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-sm text-danger-400">
              Arbiter cannot be the same as seller address
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description (metadata URI or plain text)</label>
          <textarea
            rows={3}
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500 resize-none"
            placeholder="Describe what you're offering, or an ipfs:// URI…"
            value={metadataURI}
            onChange={(e) => setMetadataURI(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium">Milestones</label>
            <button type="button" onClick={addMilestone} className="text-sm text-trust-400 hover:text-trust-300 font-medium">
              + Add Milestone
            </button>
          </div>
          <div className="space-y-3">
            {milestoneInputs.map((value, i) => (
              <div key={i} className="flex gap-3 items-center">
                <div className="flex-1">
                  <input
                    type="number"
                    placeholder={`Milestone ${i + 1} amount`}
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                    value={value}
                    onChange={(e) => updateMilestone(i, e.target.value)}
                  />
                </div>
                {milestoneInputs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMilestone(i)}
                    className="p-3 text-ink-500 hover:text-danger-400"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 rounded-lg bg-ink-800/50 border border-ink-700 flex justify-between items-center">
            <span className="text-sm text-ink-400">Total Amount</span>
            <span className="font-mono font-semibold text-ink-100">
              {milestoneTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
              {symbol ?? "token"}
            </span>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="btn-press w-full py-4 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold text-lg glow-trust disabled:shadow-none"
        >
          {isPending || isConfirming ? "Submitting…" : "Create Listing"}
        </button>
      </div>
    </div>
  );
}
