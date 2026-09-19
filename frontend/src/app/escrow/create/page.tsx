"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, isAddress, parseUnits, type Address } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { toast } from "@/lib/toast";

/**
 * Purely a UX starting point for filling in milestone amounts — none of
 * this (category, per-milestone labels) is stored on-chain.
 * EscrowFactory.createTrade() only takes a bare uint256[] of amounts, so
 * only the amounts you actually enter ever leave this form.
 */
const CATEGORIES = [
  { id: "freelance", label: "Freelance / Service", milestones: ["Kickoff", "Midpoint delivery", "Final delivery"] },
  { id: "realestate", label: "Real Estate / Property", milestones: ["Inspection passed", "Title transfer", "Closing"] },
  { id: "goods", label: "Goods / Physical Item", milestones: ["Shipped", "Delivered & confirmed"] },
  { id: "custom", label: "Custom", milestones: [""] },
] as const;

export default function CreateEscrowPage() {
  const router = useRouter();
  const { address: account, isConnected } = useAccount();

  const [categoryId, setCategoryId] = useState<(typeof CATEGORIES)[number]["id"]>("freelance");
  const category = CATEGORIES.find((c) => c.id === categoryId)!;

  const [tokenInput, setTokenInput] = useState("");
  const [sellerInput, setSellerInput] = useState("");
  const [arbiterInput, setArbiterInput] = useState("");
  const [bondInput, setBondInput] = useState("0");
  const [milestoneInputs, setMilestoneInputs] = useState<string[]>([...category.milestones].map(() => ""));

  const token = isAddress(tokenInput) ? (tokenInput as Address) : undefined;
  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  const arbiterConflict =
    isAddress(arbiterInput) &&
    ((account && arbiterInput.toLowerCase() === account.toLowerCase()) ||
      (isAddress(sellerInput) && arbiterInput.toLowerCase() === sellerInput.toLowerCase()));

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  useEffect(() => {
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: escrowFactoryAbi, ...log });
        if (decoded.eventName === "VaultCreated") {
          toast("Escrow vault created", "success");
          router.push(`/escrow/${decoded.args.vault}`);
          return;
        }
      } catch {
        // not an EscrowFactory event, skip
      }
    }
  }, [receipt, router]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  function selectCategory(id: (typeof CATEGORIES)[number]["id"]) {
    setCategoryId(id);
    const next = CATEGORIES.find((c) => c.id === id)!;
    setMilestoneInputs(next.milestones.map(() => ""));
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
    if (!addresses.escrowFactory || !token || decimals === undefined || !isAddress(sellerInput) || !isAddress(arbiterInput)) return;

    const bondAmount = parseUnits(bondInput || "0", decimals);
    const milestoneAmounts = milestoneInputs.filter((m) => m.trim() !== "").map((m) => parseUnits(m, decimals));

    writeContract({
      address: addresses.escrowFactory,
      abi: escrowFactoryAbi,
      functionName: "createTrade",
      args: [sellerInput as Address, arbiterInput as Address, token, bondAmount, milestoneAmounts],
    });
  }

  const milestoneTotal = milestoneInputs.reduce((sum, m) => sum + (parseFloat(m) || 0), 0);

  const canSubmit =
    isConnected &&
    Boolean(token) &&
    tokenReady &&
    isAddress(sellerInput) &&
    isAddress(arbiterInput) &&
    !arbiterConflict &&
    milestoneInputs.some((m) => m.trim() !== "") &&
    !isPending &&
    !isConfirming;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">Create Escrow</h1>
        <p className="text-ink-400 mt-1">
          Set up a direct milestone escrow with a counterparty you already know — no marketplace listing needed.
        </p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-3">Category</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCategory(c.id)}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium border ${
                  categoryId === c.id
                    ? "bg-trust-600 border-trust-500 text-white"
                    : "bg-ink-800 border-ink-700 text-ink-300 hover:text-white hover:border-ink-600"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500 mt-2">
            Prefills a suggested milestone structure — nothing here is saved on-chain except the amounts you enter.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Seller Address</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={sellerInput}
            onChange={(e) => setSellerInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">The counterparty delivering the milestones. You (the connected wallet) become the buyer.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Payment Token Address</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            {token && tokenReady ? `${symbol}, ${decimals} decimals` : token ? "Reading token…" : "Tier caps assume ~1:1 USD peg for stablecoins"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Seller Performance Bond</label>
          <div className="relative">
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="0.00"
              value={bondInput}
              onChange={(e) => setBondInput(e.target.value)}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">{symbol ?? "token"}</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Arbiter Address</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={arbiterInput}
            onChange={(e) => setArbiterInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">Must be distinct from both you and the seller — enforced on-chain.</p>
          {arbiterConflict && (
            <div className="mt-2 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-sm text-danger-400">
              Arbiter cannot be you (the buyer) or the seller.
            </div>
          )}
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
                <input
                  type="number"
                  placeholder={category.milestones[i] ? `${category.milestones[i]} amount` : `Milestone ${i + 1} amount`}
                  className="flex-1 bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                  value={value}
                  onChange={(e) => updateMilestone(i, e.target.value)}
                />
                {milestoneInputs.length > 1 && (
                  <button type="button" onClick={() => removeMilestone(i)} className="p-3 text-ink-500 hover:text-danger-400">
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
              {milestoneTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {symbol ?? "token"}
            </span>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="btn-press w-full py-4 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold text-lg glow-trust disabled:shadow-none"
        >
          {isPending || isConfirming ? "Creating…" : "Create Escrow"}
        </button>
      </div>
    </div>
  );
}
