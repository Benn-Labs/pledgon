"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount, useChainId, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useToken } from "@/hooks/useToken";
import { toast } from "@/lib/toast";
import { useSignedListingMetadataWrite } from "@/hooks/useSignedMetadataWrite";
import { useAccreditedArbitrators } from "@/hooks/useAccreditedArbitrators";
import { DEADLINE_WINDOW_OPTIONS } from "@/lib/deadlineWindows";
import { MARKETPLACE_CATEGORIES, sumPercent, toMilestoneBps } from "@/lib/marketplaceCategories";
import { UNIT_OPTIONS, unitLabel } from "@/lib/units";

const QUANTITY_DECIMALS = 18; // matches Marketplace.QUANTITY_SCALE

export default function CreateListingPage() {
  const router = useRouter();
  const { address: account, isConnected } = useAccount();
  const chainId = useChainId();
  const { write: writeListingMetadata } = useSignedListingMetadataWrite();
  const { defaultArbiter, accredited, isLoading: arbitratorsLoading } = useAccreditedArbitrators();

  const [tokenInput, setTokenInput] = useState("");
  const [bondRateInput, setBondRateInput] = useState("0");
  const [milestonePercentInputs, setMilestonePercentInputs] = useState<string[]>(() =>
    MARKETPLACE_CATEGORIES[0].milestones.length > 0
      ? MARKETPLACE_CATEGORIES[0].milestones.map((m) => String(m.weightPercent))
      : ["100"],
  );
  const [milestoneLabelInputs, setMilestoneLabelInputs] = useState<string[]>(() =>
    MARKETPLACE_CATEGORIES[0].milestones.length > 0 ? MARKETPLACE_CATEGORIES[0].milestones.map((m) => m.label) : [""],
  );
  const [arbiterInput, setArbiterInput] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [categoryId, setCategoryId] = useState<string>(MARKETPLACE_CATEGORIES[0].id);
  const [location, setLocation] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [unitInput, setUnitInput] = useState<string>(MARKETPLACE_CATEGORIES[0].defaultUnit);
  const [unitPriceInput, setUnitPriceInput] = useState("");
  const [fundingWindowInput, setFundingWindowInput] = useState<string>(DEADLINE_WINDOW_OPTIONS[0].seconds);
  const [milestoneWindowInput, setMilestoneWindowInput] = useState<string>(DEADLINE_WINDOW_OPTIONS[0].seconds);
  const [deliveryWindowInput, setDeliveryWindowInput] = useState<string>(DEADLINE_WINDOW_OPTIONS[0].seconds);

  const category = MARKETPLACE_CATEGORIES.find((c) => c.id === categoryId) ?? MARKETPLACE_CATEGORIES[0];

  const token = isAddress(tokenInput) ? (tokenInput as Address) : undefined;
  const { decimals, symbol, isReady: tokenReady } = useToken(token);

  // Empty selection means "use the default arbiter" — never the seller.
  const arbiterIsSeller = arbiterInput !== "" && account && arbiterInput.toLowerCase() === account.toLowerCase();

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  const handledHash = useRef<`0x${string}` | undefined>(undefined);

  const percentTotal = sumPercent(milestonePercentInputs.map((p) => parseFloat(p)));
  const percentValid = Math.abs(percentTotal - 100) < 0.01;

  const fullListingValue = (parseFloat(quantityInput) || 0) * (parseFloat(unitPriceInput) || 0);

  useEffect(() => {
    // Guard against firing more than once for the same receipt — see
    // useSignedMetadataWrite.ts for the runaway-signature-prompt bug this
    // class of guard prevents (a re-created callback re-triggering this
    // effect would otherwise re-sign and re-invoke on every render).
    if (!receipt || handledHash.current === receipt.transactionHash) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: marketplaceAbi, ...log });
        if (decoded.eventName === "ListingCreated") {
          handledHash.current = receipt.transactionHash;
          const listingId = Number(decoded.args.listingId);
          toast("Listing created successfully", "success");
          router.push("/marketplace");
          const milestoneLabels = milestoneLabelInputs.map((l, n) => l.trim() || `Milestone ${n + 1}`);
          // Best-effort: the on-chain listing already exists and is fully
          // functional without this — a second wallet signature just
          // publishes the richer thumbnail/description/terms alongside it.
          if (addresses.marketplace) {
            writeListingMetadata({
              chainId,
              marketplaceAddress: addresses.marketplace,
              listingId,
              title,
              description,
              thumbnailUrl,
              terms: { category: category.label, location, conditionNotes, unit: unitInput, milestoneLabels },
            }).then(({ ok, error: saveError }) => {
              if (!ok) {
                toast(`Listing created — thumbnail/description couldn't be saved (${saveError ?? "unknown error"})`, "error");
              }
            });
          }
          return;
        }
      } catch {
        // not a Marketplace event, skip
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form fields are read at submit time, not meant to re-trigger this effect
  }, [receipt, router]);

  useEffect(() => {
    if (error) toast(error.message, "error");
  }, [error]);

  function selectCategory(id: string) {
    const next = MARKETPLACE_CATEGORIES.find((c) => c.id === id) ?? MARKETPLACE_CATEGORIES[0];
    setCategoryId(id);
    setUnitInput(next.defaultUnit);
    if (next.milestones.length === 0) {
      setMilestoneLabelInputs([""]);
      setMilestonePercentInputs(["100"]);
    } else {
      setMilestoneLabelInputs(next.milestones.map((m) => m.label));
      setMilestonePercentInputs(next.milestones.map((m) => String(m.weightPercent)));
    }
  }

  function updateMilestonePercent(index: number, value: string) {
    setMilestonePercentInputs((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function updateMilestoneLabel(index: number, value: string) {
    setMilestoneLabelInputs((prev) => prev.map((l, i) => (i === index ? value : l)));
  }

  function addMilestone() {
    setMilestonePercentInputs((prev) => [...prev, ""]);
    setMilestoneLabelInputs((prev) => [...prev, ""]);
  }

  function removeMilestone(index: number) {
    setMilestonePercentInputs((prev) => prev.filter((_, i) => i !== index));
    setMilestoneLabelInputs((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    if (!addresses.marketplace || !token || decimals === undefined || !percentValid) return;

    const arbiterAddress = (arbiterInput || zeroAddress) as Address;
    const milestoneBps = toMilestoneBps(milestonePercentInputs.map((p) => parseFloat(p) || 0));
    const totalQuantity = parseUnits(quantityInput || "0", QUANTITY_DECIMALS);
    const unitPrice = parseUnits(unitPriceInput || "0", decimals);
    const bondRatePerUnit = parseUnits(bondRateInput || "0", decimals);

    writeContract({
      address: addresses.marketplace,
      abi: marketplaceAbi,
      functionName: "createListing",
      args: [
        token,
        milestoneBps,
        arbiterAddress,
        title,
        totalQuantity,
        unitPrice,
        bondRatePerUnit,
        BigInt(fundingWindowInput),
        BigInt(milestoneWindowInput),
        BigInt(deliveryWindowInput),
      ],
    });
  }

  const canSubmit =
    isConnected &&
    Boolean(token) &&
    tokenReady &&
    !arbiterIsSeller &&
    percentValid &&
    parseFloat(quantityInput) > 0 &&
    milestonePercentInputs.length > 0 &&
    !isPending &&
    !isConfirming;

  return (
    <div className="fade-in max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-display text-white">Create Listing</h1>
        <p className="text-ink-400 mt-1">List your service or asset with milestone-based escrow protection</p>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Title</label>
          <input
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500"
            placeholder="What are you offering?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">Stored on-chain as the listing's metadata — keep it short.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Thumbnail Image URL</label>
          <div className="flex gap-3 items-start">
            <input
              className="flex-1 bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono text-sm focus:outline-none focus:border-trust-500"
              placeholder="https://…"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
            />
            <div className="w-16 h-16 rounded-lg bg-ink-800 border border-ink-700 shrink-0 overflow-hidden flex items-center justify-center">
              {thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-provided URL, not a local/optimizable asset
                <img
                  src={thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <svg className="w-6 h-6 text-ink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 10h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-500 mt-1">
            A link to an already-hosted image (your own site, IPFS gateway, etc.) — nothing is uploaded or stored on
            our end besides this URL.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-3">Category</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MARKETPLACE_CATEGORIES.map((c) => (
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
            {category.milestones.length > 0
              ? "Prefills a milestone payout split below (as percentages) — edit, add, or remove any of it."
              : "No preset breakdown — build the milestone split below from scratch."}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Location (optional)</label>
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 text-sm focus:outline-none focus:border-trust-500"
              placeholder="City, region, or remote"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Condition / Delivery Notes (optional)</label>
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 text-sm focus:outline-none focus:border-trust-500"
              placeholder="e.g. New, ships in 3 days"
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            rows={3}
            className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500 resize-none"
            placeholder="Describe what you're offering in full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="text-xs text-ink-500 mt-1">
            Saved alongside the thumbnail and category above — everything except the title lives off-chain, signed
            by your wallet so buyers know it really came from you.
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
            {token && tokenReady
              ? `${symbol}, ${decimals} decimals — tier caps assume ~1:1 USD peg for stablecoins`
              : token && !tokenReady
                ? "Reading token…"
                : "Tier caps assume ~1:1 USD peg for stablecoins"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-3">Supply & Pricing</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-ink-400 mb-2">Total Quantity Available</label>
              <input
                type="number"
                className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                placeholder="e.g. 5000"
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-400 mb-2">Unit</label>
              <select
                className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500"
                value={unitInput}
                onChange={(e) => setUnitInput(e.target.value)}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-400 mb-2">Unit Price</label>
              <div className="relative">
                <input
                  type="number"
                  className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                  placeholder="0.00"
                  value={unitPriceInput}
                  onChange={(e) => setUnitPriceInput(e.target.value)}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">{symbol ?? "token"}</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-ink-500 mt-2">
            Buyers can purchase any part of this quantity — a purchase decrements what's left instead of closing the
            listing, until it's fully sold.
            {fullListingValue > 0 &&
              ` Full listing value if sold out: ${fullListingValue.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol ?? "token"}.`}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Bond Rate (per {unitLabel(unitInput)})</label>
          <div className="relative">
            <input
              className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
              placeholder="0.00"
              value={bondRateInput}
              onChange={(e) => setBondRateInput(e.target.value)}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">{symbol ?? "token"}</span>
          </div>
          <p className="text-xs text-ink-500 mt-1">
            Charged per unit purchased, not a flat amount — a buyer taking 100 of 5000 posts 100 × this rate as your
            performance bond for their trade, locked until it completes and returned upon completion. It can be
            slashed if you fail to deliver.
          </p>
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
              : "Must be a different address from your wallet. The arbiter resolves disputes and can slash your bond."}
          </p>
          {arbiterIsSeller && (
            <div className="mt-2 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-sm text-danger-400">
              Arbiter cannot be the same as seller address
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
              How long a buyer has to fund after purchasing, once you post the bond.
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
              How long the buyer has to confirm each milestone once you submit docs — past it, silence releases it to
              you.
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
              How long you have to submit docs for each milestone after the buyer funds. Past it, anyone can refund it
              to the buyer.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium">Milestone Payout Split</label>
            <button type="button" onClick={addMilestone} className="text-sm text-trust-400 hover:text-trust-300 font-medium">
              + Add Milestone
            </button>
          </div>
          <p className="text-xs text-ink-500 mb-3">
            Percentages of whatever a buyer's purchase totals — the actual amount is only known once they pick a
            quantity, shown to them before they buy.
          </p>
          <div className="space-y-3">
            {milestonePercentInputs.map((value, i) => (
              <div key={i} className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] space-y-2">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder={`Milestone ${i + 1} label (shown to buyers)`}
                    className="flex-1 bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-ink-200 focus:outline-none focus:border-trust-500"
                    value={milestoneLabelInputs[i] ?? ""}
                    onChange={(e) => updateMilestoneLabel(i, e.target.value)}
                  />
                  {milestonePercentInputs.length > 1 && (
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
                <div className="relative">
                  <input
                    type="number"
                    placeholder="Percent"
                    className="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-10 text-ink-200 font-mono focus:outline-none focus:border-trust-500"
                    value={value}
                    onChange={(e) => updateMilestonePercent(i, e.target.value)}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm">%</span>
                </div>
              </div>
            ))}
          </div>
          <div
            className={`mt-3 p-3 rounded-lg border flex justify-between items-center ${
              percentValid ? "bg-ink-800/50 border-ink-700" : "bg-danger-500/10 border-danger-500/30"
            }`}
          >
            <span className={`text-sm ${percentValid ? "text-ink-400" : "text-danger-400"}`}>
              {percentValid ? "Total" : "Must total exactly 100%"}
            </span>
            <span className={`font-mono font-semibold ${percentValid ? "text-ink-100" : "text-danger-400"}`}>
              {percentTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}%
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
