"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, formatEther, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { escrowFactoryAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { toast } from "@/lib/toast";
import { saveMilestoneLabels } from "@/lib/milestoneLabels";
import { saveTradeDescription } from "@/lib/tradeDescriptions";
import { useSignedEscrowMetadataWrite } from "@/hooks/useSignedMetadataWrite";
import { useAccreditedArbitrators } from "@/hooks/useAccreditedArbitrators";
import { DEADLINE_WINDOW_OPTIONS } from "@/lib/deadlineWindows";
import { TransactionReviewModal } from "@/components/ui/TransactionReviewModal";

/**
 * Purely a UX starting point for filling in milestone amounts — none of
 * this (category, per-milestone labels) is stored on-chain.
 * EscrowFactory.createTrade() only takes a bare uint256[] of amounts, so
 * only the amounts you actually enter ever leave this form. Descriptions
 * are saved locally (see saveMilestoneLabels) — visible again on this
 * device, not to your counterparty.
 */
const CATEGORIES = [
  { id: "freelance", label: "Freelance / Service", milestones: ["Kickoff", "Midpoint delivery", "Final delivery"] },
  { id: "realestate", label: "Real Estate / Property", milestones: ["Inspection passed", "Title transfer", "Closing"] },
  { id: "goods", label: "Goods / Physical Item", milestones: ["Shipped", "Delivered & confirmed"] },
  { id: "custom", label: "Custom", milestones: [""] },
] as const;

type Role = "buyer" | "seller";

export default function CreateEscrowPage() {
  const router = useRouter();
  const { address: account, isConnected } = useAccount();
  const chainId = useChainId();
  const { write: writeEscrowMetadata } = useSignedEscrowMetadataWrite();
  const { defaultArbiter, accredited, isLoading: arbitratorsLoading } = useAccreditedArbitrators();

  const [categoryId, setCategoryId] = useState<(typeof CATEGORIES)[number]["id"]>("freelance");
  const category = CATEGORIES.find((c) => c.id === categoryId)!;

  const [myRole, setMyRole] = useState<Role>("buyer");
  const [tradeDescription, setTradeDescription] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [counterpartyInput, setCounterpartyInput] = useState("");
  const [arbiterInput, setArbiterInput] = useState("");
  const [bondInput, setBondInput] = useState("0");
  const [fundingWindowInput, setFundingWindowInput] = useState<string>(DEADLINE_WINDOW_OPTIONS[0].seconds);
  const [milestoneWindowInput, setMilestoneWindowInput] = useState<string>(DEADLINE_WINDOW_OPTIONS[0].seconds);
  const [deliveryWindowInput, setDeliveryWindowInput] = useState<string>(DEADLINE_WINDOW_OPTIONS[0].seconds);
  const [milestoneInputs, setMilestoneInputs] = useState<string[]>([...category.milestones].map(() => ""));
  const [descriptionInputs, setDescriptionInputs] = useState<string[]>([...category.milestones]);
  const pendingLabels = useRef<string[]>([]);
  const handledHash = useRef<`0x${string}` | undefined>(undefined);

  const token = isAddress(tokenInput) ? (tokenInput as Address) : undefined;
  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  // Whichever address ends up buyer or seller, the arbiter can't be either
  // one — check against both you and the counterparty regardless of which
  // role you picked. Empty means "use the default" (resolved on-chain), so
  // only a concrete selection can conflict.
  const arbiterConflict =
    arbiterInput !== "" &&
    ((account && arbiterInput.toLowerCase() === account.toLowerCase()) ||
      (isAddress(counterpartyInput) && arbiterInput.toLowerCase() === counterpartyInput.toLowerCase()));

  const { data: vaultCreationFee } = useReadContract({
    address: addresses.escrowFactory,
    abi: escrowFactoryAbi,
    functionName: "vaultCreationFee",
    query: { enabled: Boolean(addresses.escrowFactory) },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  useEffect(() => {
    // Guard against firing more than once for the same receipt. `receipt`
    // itself is stable per hash, but this is cheap insurance against any
    // future dependency (e.g. a re-created callback) re-triggering the
    // signature prompt in a loop instead of once — see
    // useSignedMetadataWrite.ts for the bug this class of guard prevents.
    if (!receipt || handledHash.current === receipt.transactionHash) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: escrowFactoryAbi, ...log });
        if (decoded.eventName === "VaultCreated") {
          handledHash.current = receipt.transactionHash;
          const vault = decoded.args.vault;
          saveMilestoneLabels(vault, pendingLabels.current);
          saveTradeDescription(vault, tradeDescription);
          toast("Escrow vault created", "success");
          router.push(`/escrow/${vault}`);
          // Best-effort: publish the same labels to Supabase so the
          // counterparty sees them too, not just this browser. A second
          // wallet signature prompt, separate from the creation tx — if
          // declined or it fails, the trade itself is already created and
          // unaffected; the labels just stay local-only until saved again.
          if (tradeDescription.trim() || pendingLabels.current.some((l) => l.trim())) {
            writeEscrowMetadata({
              chainId,
              vaultAddress: vault,
              description: tradeDescription,
              milestoneLabels: pendingLabels.current,
            }).then(({ ok, error: saveError }) => {
              if (!ok) {
                toast(
                  `Trade created — shared description couldn't be saved (${saveError ?? "unknown error"}), only visible to you`,
                  "error",
                );
              }
            });
          }
          return;
        }
      } catch {
        // not an EscrowFactory event, skip
      }
    }
  }, [receipt, router, tradeDescription, chainId, writeEscrowMetadata]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  function selectCategory(id: (typeof CATEGORIES)[number]["id"]) {
    setCategoryId(id);
    const next = CATEGORIES.find((c) => c.id === id)!;
    setMilestoneInputs(next.milestones.map(() => ""));
    setDescriptionInputs([...next.milestones]);
  }

  function updateMilestone(index: number, value: string) {
    setMilestoneInputs((prev) => prev.map((m, i) => (i === index ? value : m)));
  }

  function updateDescription(index: number, value: string) {
    setDescriptionInputs((prev) => prev.map((d, i) => (i === index ? value : d)));
  }

  function addMilestone() {
    setMilestoneInputs((prev) => [...prev, ""]);
    setDescriptionInputs((prev) => [...prev, ""]);
  }

  function removeMilestone(index: number) {
    setMilestoneInputs((prev) => prev.filter((_, i) => i !== index));
    setDescriptionInputs((prev) => prev.filter((_, i) => i !== index));
  }

  type PendingTrade = {
    arbiterAddress: Address;
    bondAmount: bigint;
    milestoneAmounts: bigint[];
    fundingWindow: bigint;
    milestoneConfirmWindow: bigint;
    deliveryWindow: bigint;
  };
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);

  function openReview() {
    if (!addresses.escrowFactory || !account || !token || decimals === undefined || !isAddress(counterpartyInput)) {
      return;
    }

    // Empty selection means "use EscrowFactory's default arbiter" — zeroAddress
    // resolves to it on-chain, same as leaving the field untouched.
    const arbiterAddress = (arbiterInput || zeroAddress) as Address;
    const bondAmount = parseUnits(bondInput || "0", decimals);
    const filledIndices = milestoneInputs.map((v, i) => i).filter((i) => milestoneInputs[i].trim() !== "");
    const milestoneAmounts = filledIndices.map((i) => parseUnits(milestoneInputs[i], decimals));
    pendingLabels.current = filledIndices.map((i, n) => descriptionInputs[i]?.trim() || `Milestone ${n + 1}`);

    setPendingTrade({
      arbiterAddress,
      bondAmount,
      milestoneAmounts,
      fundingWindow: BigInt(fundingWindowInput),
      milestoneConfirmWindow: BigInt(milestoneWindowInput),
      deliveryWindow: BigInt(deliveryWindowInput),
    });
  }

  function confirmSubmit() {
    if (!pendingTrade || !addresses.escrowFactory || !account || !token) return;
    const { arbiterAddress, bondAmount, milestoneAmounts, fundingWindow, milestoneConfirmWindow, deliveryWindow } = pendingTrade;

    if (myRole === "buyer") {
      writeContract({
        address: addresses.escrowFactory,
        abi: escrowFactoryAbi,
        functionName: "createTrade",
        args: [
          counterpartyInput as Address,
          arbiterAddress,
          token,
          bondAmount,
          milestoneAmounts,
          fundingWindow,
          milestoneConfirmWindow,
          deliveryWindow,
        ],
        value: vaultCreationFee ?? 0n,
      });
    } else {
      // createTradeFor is permissionless: fund() still requires the buyer's
      // own approval, so naming them here can't move their funds without
      // their consent — it only decides who the vault will later expect to
      // fund and confirm it.
      writeContract({
        address: addresses.escrowFactory,
        abi: escrowFactoryAbi,
        functionName: "createTradeFor",
        args: [
          counterpartyInput as Address,
          account,
          arbiterAddress,
          token,
          bondAmount,
          milestoneAmounts,
          fundingWindow,
          milestoneConfirmWindow,
          deliveryWindow,
        ],
        value: vaultCreationFee ?? 0n,
      });
    }
    setPendingTrade(null);
  }

  const milestoneTotal = milestoneInputs.reduce((sum, m) => sum + (parseFloat(m) || 0), 0);

  const reviewLineItems = pendingTrade
    ? [
        { label: "Your role", value: myRole === "buyer" ? "Buyer" : "Seller" },
        { label: "Counterparty", value: `${counterpartyInput.slice(0, 6)}…${counterpartyInput.slice(-4)}` },
        ...pendingTrade.milestoneAmounts.map((amount, i) => ({
          label: descriptionInputs.filter((_, di) => milestoneInputs[di].trim() !== "")[i] || `Milestone ${i + 1}`,
          value: `${milestoneInputs.filter((m) => m.trim() !== "")[i]} ${symbol ?? "token"}`,
        })),
        { label: "Total", value: `${milestoneTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${symbol ?? "token"}` },
        ...(pendingTrade.bondAmount > 0n ? [{ label: "Seller bond", value: `${bondInput} ${symbol ?? "token"}` }] : []),
      ]
    : [];

  const reviewContract =
    pendingTrade && addresses.escrowFactory && token && account && isAddress(counterpartyInput)
      ? myRole === "buyer"
        ? {
            address: addresses.escrowFactory,
            abi: escrowFactoryAbi,
            functionName: "createTrade",
            args: [
              counterpartyInput as Address,
              pendingTrade.arbiterAddress,
              token,
              pendingTrade.bondAmount,
              pendingTrade.milestoneAmounts,
              pendingTrade.fundingWindow,
              pendingTrade.milestoneConfirmWindow,
              pendingTrade.deliveryWindow,
            ],
          }
        : {
            address: addresses.escrowFactory,
            abi: escrowFactoryAbi,
            functionName: "createTradeFor",
            args: [
              counterpartyInput as Address,
              account,
              pendingTrade.arbiterAddress,
              token,
              pendingTrade.bondAmount,
              pendingTrade.milestoneAmounts,
              pendingTrade.fundingWindow,
              pendingTrade.milestoneConfirmWindow,
              pendingTrade.deliveryWindow,
            ],
          }
      : undefined;

  const canSubmit =
    isConnected &&
    Boolean(token) &&
    tokenReady &&
    isAddress(counterpartyInput) &&
    !arbiterConflict &&
    milestoneInputs.some((m) => m.trim() !== "") &&
    !isPending &&
    !isConfirming;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display text-white">Create Escrow</h1>
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
          <label className="block text-sm font-medium mb-2">Trade Description (optional)</label>
          <textarea
            rows={2}
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 text-sm focus:outline-none focus:border-trust-500 resize-none"
            placeholder="What's this trade for? e.g. Sale of 3-bedroom unit at 123 Main St"
            value={tradeDescription}
            onChange={(e) => setTradeDescription(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            Saved only in this browser (not on-chain, not visible to the counterparty) — a personal reference for
            what this whole trade is about.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-3">Your Role</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMyRole("buyer")}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium border ${
                myRole === "buyer"
                  ? "bg-trust-600 border-trust-500 text-white"
                  : "bg-ink-800 border-ink-700 text-ink-300 hover:text-white hover:border-ink-600"
              }`}
            >
              I&apos;m the Buyer
            </button>
            <button
              type="button"
              onClick={() => setMyRole("seller")}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium border ${
                myRole === "seller"
                  ? "bg-success-600 border-success-500 text-white"
                  : "bg-ink-800 border-ink-700 text-ink-300 hover:text-white hover:border-ink-600"
              }`}
            >
              I&apos;m the Seller
            </button>
          </div>
          <p className="text-xs text-ink-500 mt-2">
            {myRole === "buyer"
              ? "You fund the milestones and confirm delivery."
              : "You deliver the milestones and post the performance bond."}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">{myRole === "buyer" ? "Seller Address" : "Buyer Address"}</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            placeholder="0x…"
            value={counterpartyInput}
            onChange={(e) => setCounterpartyInput(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            {myRole === "buyer"
              ? "The counterparty delivering the milestones. You (the connected wallet) become the buyer."
              : "The counterparty funding the milestones. You (the connected wallet) become the seller."}
          </p>
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
          <label className="block text-sm font-medium mb-2">Arbiter</label>
          <select
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
            value={arbiterInput}
            onChange={(e) => setArbiterInput(e.target.value)}
          >
            <option value="">{defaultArbiter ? `Default (${defaultArbiter.slice(0, 6)}…${defaultArbiter.slice(-4)})` : "Default"}</option>
            {accredited
              .filter((a) => !defaultArbiter || a.toLowerCase() !== defaultArbiter.toLowerCase())
              .map((a) => (
                <option key={a} value={a}>
                  {a.slice(0, 6)}…{a.slice(-4)}
                </option>
              ))}
          </select>
          <p className="text-xs text-ink-500 mt-1">
            {arbitratorsLoading
              ? "Loading accredited arbitrators…"
              : "Every trade has a real arbiter able to rule on a dispute. Must be distinct from both parties to the trade."}
          </p>
          {arbiterConflict && (
            <div className="mt-2 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-sm text-danger-400">
              Arbiter cannot be you or the counterparty.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Funding Deadline</label>
            <select
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500"
              value={fundingWindowInput}
              onChange={(e) => setFundingWindowInput(e.target.value)}
            >
              {DEADLINE_WINDOW_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-500 mt-1">
              How long the buyer has to fund after the bond is posted. Past it, anyone can trigger a refund to the
              seller and the trade cancels.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Milestone Confirmation Window</label>
            <select
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500"
              value={milestoneWindowInput}
              onChange={(e) => setMilestoneWindowInput(e.target.value)}
            >
              {DEADLINE_WINDOW_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-500 mt-1">
              How long the buyer has to confirm each milestone once docs are submitted. Past it, anyone can release it
              to the seller — silence counts as accepted delivery.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Delivery Window</label>
            <select
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500"
              value={deliveryWindowInput}
              onChange={(e) => setDeliveryWindowInput(e.target.value)}
            >
              {DEADLINE_WINDOW_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-500 mt-1">
              How long the seller has to submit docs for each milestone after funding. Past it, anyone can trigger a
              refund to the buyer for that milestone.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium">Milestones</label>
            <button type="button" onClick={addMilestone} className="text-sm text-trust-400 hover:text-trust-300 font-medium">
              + Add Milestone
            </button>
          </div>
          <p className="text-xs text-ink-500 mb-3">
            Descriptions are saved only in this browser (not on-chain, not visible to the seller) — a personal
            reference for what each amount is for.
          </p>
          <div className="space-y-3">
            {milestoneInputs.map((value, i) => (
              <div key={i} className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] space-y-2">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder={`Milestone ${i + 1} description (saved locally)`}
                    className="flex-1 bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
                    value={descriptionInputs[i] ?? ""}
                    onChange={(e) => updateDescription(i, e.target.value)}
                  />
                  {milestoneInputs.length > 1 && (
                    <button type="button" onClick={() => removeMilestone(i)} className="p-2 text-ink-500 hover:text-danger-400 shrink-0">
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
                <input
                  type="number"
                  placeholder="Amount"
                  className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                  value={value}
                  onChange={(e) => updateMilestone(i, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] flex justify-between items-center">
            <span className="text-sm text-ink-400">Total Amount</span>
            <span className="font-mono font-semibold text-ink-100">
              {milestoneTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {symbol ?? "token"}
            </span>
          </div>
        </div>

        {vaultCreationFee !== undefined && vaultCreationFee > 0n && (
          <p className="text-xs text-ink-500 text-center mb-2">
            A vault-creation fee of {formatEther(vaultCreationFee)} ETH applies, on top of the {symbol ?? "token"} amounts above.
          </p>
        )}

        <button
          onClick={openReview}
          disabled={!canSubmit}
          className="btn-press w-full py-4 rounded-lg bg-trust-600 hover:bg-trust-500 disabled:bg-ink-700 disabled:cursor-not-allowed text-white font-semibold text-lg glow-trust disabled:shadow-none"
        >
          {isPending || isConfirming ? "Creating…" : "Review & Create Escrow"}
        </button>
      </div>

      <TransactionReviewModal
        open={pendingTrade !== null}
        onCancel={() => setPendingTrade(null)}
        onConfirm={confirmSubmit}
        isSubmitting={isPending || isConfirming}
        title="Review Escrow Creation"
        lineItems={reviewLineItems}
        ethValue={vaultCreationFee ?? 0n}
        ethValueLabel="Vault-creation fee"
        contract={reviewContract}
      />
    </div>
  );
}
