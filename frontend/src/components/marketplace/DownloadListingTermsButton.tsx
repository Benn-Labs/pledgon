"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { marketplaceAbi } from "@/generated/contracts";
import { downloadListingPdf, loadLogoDataUrl, type ListingPdfModel } from "@/lib/contractPdf";
import { LISTING_STATUS } from "@/components/ui/badges";
import type { ListingMetadata } from "@/hooks/useListingMetadata";
import { toast } from "@/lib/toast";

/**
 * "Download terms (PDF)" for a marketplace listing: the payment terms the
 * seller entered when creating it — unit price, quantity, per-unit bond,
 * milestone split, deadline windows, arbiter — plus how funds move once
 * someone buys. Available to everyone (a prospective buyer wants it before
 * purchasing); generated in the browser from what the page already loaded.
 */
export function DownloadListingTermsButton({
  marketplace,
  listingId,
  seller,
  arbiter,
  token,
  symbol,
  decimals,
  status,
  metadataURI,
  metadata,
  pricing,
  milestoneBps,
}: {
  marketplace: Address;
  listingId: number;
  seller: Address;
  arbiter: Address;
  token: Address;
  symbol: string;
  decimals: number;
  status: number;
  metadataURI: string;
  metadata: ListingMetadata;
  /** listingPricing(): totalQuantity, remainingQuantity, unitPrice, bondRatePerUnit */
  pricing: readonly [bigint, bigint, bigint, bigint];
  milestoneBps: readonly number[];
}) {
  const [busy, setBusy] = useState(false);

  const { data: windows } = useReadContract({
    address: marketplace,
    abi: marketplaceAbi,
    functionName: "listingWindows",
    args: [BigInt(listingId)],
  });

  async function download() {
    setBusy(true);
    try {
      const [totalQuantity, remainingQuantity, unitPrice, bondRatePerUnit] = pricing;
      const [fundingWindow, milestoneConfirmWindow, deliveryWindow] = windows ?? [0n, 0n, 0n];
      const model: ListingPdfModel = {
        generatedAt: new Date(),
        chainName: "Sepolia",
        explorerBaseUrl: "https://sepolia.etherscan.io",
        marketplace,
        listingId,
        status: LISTING_STATUS[status] === "TakenDown" ? "Removed" : (LISTING_STATUS[status] ?? "Unknown"),
        title: metadata.title || metadataURI || undefined,
        description: metadata.description || undefined,
        category: metadata.terms.category,
        location: metadata.terms.location,
        conditionNotes: metadata.terms.conditionNotes,
        unit: metadata.terms.unit,
        token: { address: token, symbol, decimals },
        arbiter,
        seller,
        totalQuantity,
        remainingQuantity,
        unitPrice,
        bondRatePerUnit,
        milestones: milestoneBps.map((bps, i) => ({
          label: metadata.terms.milestoneLabels?.[i] || `Milestone ${i + 1}`,
          bps,
        })),
        fundingWindow: Number(fundingWindow),
        milestoneConfirmWindow: Number(milestoneConfirmWindow),
        deliveryWindow: Number(deliveryWindow),
        logoDataUrl: await loadLogoDataUrl(),
      };
      await downloadListingPdf(model);
    } catch (e) {
      toast(`Couldn't generate the PDF (${e instanceof Error ? e.message.slice(0, 100) : "unknown error"})`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy || windows === undefined || milestoneBps.length === 0}
      className="btn-press inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-200 hover:bg-ink-700 hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
      </svg>
      {busy ? "Generating…" : "Download terms (PDF)"}
    </button>
  );
}
