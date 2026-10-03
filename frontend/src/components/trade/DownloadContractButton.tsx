"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { escrowVaultAbi, marketplaceAbi } from "@/generated/contracts";
import { addresses } from "@/lib/addresses";
import { useListingIdByVault } from "@/hooks/useListingTitleByVault";
import { useListingMetadata } from "@/hooks/useListingMetadata";
import { downloadContractPdf, loadLogoDataUrl, type ContractPdfModel } from "@/lib/contractPdf";
import { MILESTONE_STATUS } from "@/components/ui/badges";
import { toast } from "@/lib/toast";

const QUANTITY_SCALE = 10n ** 18n; // Marketplace.QUANTITY_SCALE

// "DocsSubmitted" -> "Docs Submitted"
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");

/**
 * "Download contract (PDF)" for a trade: a printable summary of the core
 * payment terms fixed at creation (value, token, unit price and quantity when
 * the trade came from a marketplace listing, bond, milestone split, deadline
 * windows), the escrow procedures, the parties, and a QR code to the vault.
 * Everything is read from the chain (plus the off-chain description/labels
 * already loaded on the page) at click time; the PDF itself is generated in
 * the browser.
 */
export function DownloadContractButton({
  vault,
  buyer,
  seller,
  arbiter,
  token,
  symbol,
  decimals,
  totalAmount,
  bondAmount,
  statusLabel,
  description,
  milestones,
  milestoneLabels,
  fundingDeadline,
}: {
  vault: Address;
  buyer: Address;
  seller: Address;
  arbiter?: Address;
  token: Address;
  symbol: string;
  decimals: number;
  totalAmount: bigint;
  bondAmount: bigint;
  statusLabel: string;
  description?: string;
  milestones: { index: number; amount: bigint; status: number }[];
  milestoneLabels: string[];
  fundingDeadline?: bigint;
}) {
  const [busy, setBusy] = useState(false);

  const { data: windows } = useReadContracts({
    contracts: [
      { address: vault, abi: escrowVaultAbi, functionName: "milestoneConfirmWindow" },
      { address: vault, abi: escrowVaultAbi, functionName: "deliveryWindow" },
    ],
  });

  // If this vault was bought from a marketplace listing, pull its unit pricing
  // and the (off-chain) unit/category/location so the PDF can state the price
  // per unit the way the listing did.
  const listingId = useListingIdByVault().get(vault.toLowerCase());
  const { data: pricing } = useReadContract({
    address: addresses.marketplace,
    abi: marketplaceAbi,
    functionName: "listingPricing",
    args: listingId !== undefined ? [BigInt(listingId)] : undefined,
    query: { enabled: Boolean(addresses.marketplace) && listingId !== undefined },
  });
  const { metadata: listingMeta } = useListingMetadata(addresses.marketplace, listingId);

  async function download() {
    setBusy(true);
    try {
      const [confirmWindow, deliveryWindow] = (windows?.map((w) => w.result) ?? []) as [bigint | undefined, bigint | undefined];
      const [, , unitPrice, bondRatePerUnit] = pricing ?? [];

      let listing: ContractPdfModel["listing"];
      if (listingId !== undefined && unitPrice !== undefined) {
        // Quantity isn't stored per vault — it is the purchase total divided by
        // the unit price. Only state it when that divides exactly.
        const scaled = totalAmount * QUANTITY_SCALE;
        listing = {
          id: listingId,
          title: listingMeta.title || undefined,
          category: listingMeta.terms.category,
          location: listingMeta.terms.location,
          conditionNotes: listingMeta.terms.conditionNotes,
          unit: listingMeta.terms.unit,
          unitPrice,
          quantity: unitPrice > 0n && scaled % unitPrice === 0n ? scaled / unitPrice : undefined,
          bondRatePerUnit: bondRatePerUnit ?? 0n,
        };
      }

      const model: ContractPdfModel = {
        generatedAt: new Date(),
        chainName: "Sepolia",
        explorerBaseUrl: "https://sepolia.etherscan.io",
        vault,
        factory: addresses.escrowFactory,
        status: statusLabel,
        token: { address: token, symbol, decimals },
        totalAmount,
        bondAmount,
        buyer,
        seller,
        arbiter,
        description: description || undefined,
        listing,
        milestones: milestones.map((m) => ({
          index: m.index,
          label: milestoneLabels[m.index] || listingMeta.terms.milestoneLabels?.[m.index] || `Milestone ${m.index + 1}`,
          amount: m.amount,
          status: spaced(MILESTONE_STATUS[m.status] ?? "Unknown"),
        })),
        fundingDeadline: fundingDeadline ? Number(fundingDeadline) : undefined,
        milestoneConfirmWindow: Number(confirmWindow ?? 0n),
        deliveryWindow: Number(deliveryWindow ?? 0n),
        logoDataUrl: await loadLogoDataUrl(),
      };
      await downloadContractPdf(model);
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
      disabled={busy || milestones.length === 0}
      className="btn-press mt-3 inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-200 hover:bg-ink-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
      </svg>
      {busy ? "Generating…" : "Download contract (PDF)"}
    </button>
  );
}
