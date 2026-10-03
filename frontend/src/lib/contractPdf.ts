/**
 * Escrow contract PDFs — printable summaries of the core payment terms, laid
 * out like the reference Garantor vault document: brand header, title, three
 * summary boxes, the terms, how funds move, parties/addresses, and a QR code
 * to the on-chain contract. Two documents share one layout:
 *
 *  - buildContractPdf: a trade (escrow vault) — what was fixed when it was
 *    created, plus its milestone status.
 *  - buildListingPdf: a marketplace listing — the terms the seller entered
 *    when creating it (unit price, quantity, bond rate, milestone split,
 *    deadline windows), i.e. what any purchase will inherit.
 *
 * Deliberately self-contained (only relative imports, no app aliases) and fed
 * plain data models, so the same functions run in the browser (the download
 * buttons) and under Node (smoke tests). The heavy PDF/QR libraries are
 * imported dynamically — nothing is added to the page bundle until someone
 * actually asks for a PDF.
 *
 * Both are informational summaries only; the deployed contract is the sole
 * authoritative record (the footer says so).
 */
import { formatUnits } from "viem";

// ─── Models ──────────────────────────────────────────────

export interface ContractPdfMilestone {
  index: number;
  label: string;
  amount: bigint;
  status: string;
}

export interface ContractPdfListing {
  id: number;
  title?: string;
  category?: string;
  location?: string;
  conditionNotes?: string;
  /** UNIT_OPTIONS value, e.g. "m2" — rendered via unitName. */
  unit?: string;
  unitPrice: bigint;
  /** Marketplace.QUANTITY_SCALE-scaled (1e18 = one whole unit); undefined when it can't be derived exactly. */
  quantity?: bigint;
  bondRatePerUnit: bigint;
}

interface PdfBase {
  generatedAt: Date;
  chainName: string;
  explorerBaseUrl: string;
  token: { address: string; symbol: string; decimals: number };
  /** undefined / zero address = no arbiter (mutual settlement only). */
  arbiter?: string;
  description?: string;
  /** PNG data URL of the (white-wordmark) logo — drawn on the dark header band. */
  logoDataUrl?: string;
}

export interface ContractPdfModel extends PdfBase {
  vault: string;
  factory?: string;
  status: string;
  totalAmount: bigint;
  bondAmount: bigint;
  buyer: string;
  seller: string;
  listing?: ContractPdfListing;
  milestones: ContractPdfMilestone[];
  /** Absolute unix seconds; 0 / undefined = no funding deadline. */
  fundingDeadline?: number;
  /** Seconds; 0 = no window. */
  milestoneConfirmWindow: number;
  deliveryWindow: number;
}

export interface ListingPdfModel extends PdfBase {
  marketplace: string;
  listingId: number;
  status: string;
  title?: string;
  category?: string;
  location?: string;
  conditionNotes?: string;
  /** UNIT_OPTIONS value, e.g. "m2". */
  unit?: string;
  /** Quantities are Marketplace.QUANTITY_SCALE-scaled (1e18 = one whole unit). */
  totalQuantity: bigint;
  remainingQuantity: bigint;
  unitPrice: bigint;
  bondRatePerUnit: bigint;
  seller: string;
  milestones: { label: string; bps: number }[];
  /** Seconds; 0 = no window. */
  fundingWindow: number;
  milestoneConfirmWindow: number;
  deliveryWindow: number;
}

// ─── Formatting ──────────────────────────────────────────

const QUANTITY_SCALE = 10n ** 18n;
const QUANTITY_DECIMALS = 18;
const ZERO = "0x0000000000000000000000000000000000000000";

const UNIT_NAMES: Record<string, string> = {
  unit: "unit",
  kg: "kg",
  ton: "metric ton",
  g: "gram",
  lb: "lb",
  l: "liter",
  m2: "sq meter",
  m3: "cu meter",
  hectare: "hectare",
  hour: "hour",
  day: "day",
};
const unitName = (unit?: string) => (unit ? (UNIT_NAMES[unit] ?? unit) : "");

/** "1,250.5" — thousands-grouped, trailing zeros trimmed. */
function formatAmount(amount: bigint, decimals: number): string {
  const [whole, frac] = formatUnits(amount, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "None";
  const units: [string, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [name, size] of units) {
    if (seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

const utc = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
const short = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;
const isRealAddress = (a?: string) => Boolean(a) && a!.toLowerCase() !== ZERO;

function firstLine(text?: string): string | undefined {
  const line = text?.split("\n").find((l) => l.trim());
  return line ? (line.length > 90 ? `${line.slice(0, 87)}...` : line) : undefined;
}

// Palette: dark brand band + warm summary boxes, like the reference sheet.
const INK = "#0b1020";
const MUTED = "#5b6478";
const BAND = "#05070c";
const BOX_BG = "#f6f1e9";
const BOX_LINE = "#e6dccb";
const RULE = "#dcdfe6";

// ─── Shared layout ───────────────────────────────────────

async function createLayout(base: PdfBase, footerLabel: string) {
  const [{ jsPDF }, QRCode] = await Promise.all([import("jspdf"), import("qrcode").then((m) => m.default ?? m)]);

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const M = 16; // side margin
  const W = PAGE_W - M * 2;
  const FOOT = 16; // reserved bottom space
  let y = 0;

  function band(tall: boolean) {
    const h = tall ? 24 : 12;
    doc.setFillColor(BAND);
    doc.rect(0, 0, PAGE_W, h, "F");
    if (base.logoDataUrl) {
      const logoH = tall ? 10 : 6;
      doc.addImage(base.logoDataUrl, "PNG", M, (h - logoH) / 2, logoH * (720 / 145), logoH);
    } else {
      doc.setTextColor("#ffffff").setFont("helvetica", "bold").setFontSize(tall ? 14 : 10).text("PLEDGON", M, h / 2 + 1.5);
    }
    if (tall) {
      doc.setTextColor("#9aa3b8").setFont("helvetica", "normal").setFontSize(8);
      doc.text(`${base.chainName} | Generated ${utc(base.generatedAt)}`, PAGE_W - M, h / 2 + 1, { align: "right" });
    }
    return h;
  }

  const ensure = (h: number) => {
    if (y + h > PAGE_H - FOOT) {
      doc.addPage();
      y = band(false) + 10;
    }
  };

  return {
    skip(h: number) {
      y += h;
    },
    ensure,

    header(title: string, subtitle: string) {
      y = band(true) + 11;
      doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(17).text(title, M, y);
      y += 6;
      doc.setTextColor(MUTED).setFont("helvetica", "normal").setFontSize(8.8);
      doc.text(doc.splitTextToSize(subtitle, W)[0] as string, M, y);
      y += 7;
    },

    summaryBoxes(boxes: [string, string][]) {
      const gap = 4;
      const bw = (W - gap * 2) / 3;
      boxes.forEach(([label, value], i) => {
        const x = M + i * (bw + gap);
        doc.setFillColor(BOX_BG).setDrawColor(BOX_LINE).setLineWidth(0.3).roundedRect(x, y, bw, 15, 1.2, 1.2, "FD");
        doc.setTextColor(MUTED).setFont("helvetica", "bold").setFontSize(6.8).text(label, x + 3.5, y + 5);
        doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(9.2);
        doc.text(doc.splitTextToSize(value, bw - 7)[0] as string, x + 3.5, y + 11);
      });
      y += 23;
    },

    section(text: string) {
      ensure(14);
      doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(10.5).text(text, M, y);
      y += 2;
      doc.setDrawColor(RULE).setLineWidth(0.3).line(M, y, M + W, y);
      y += 5;
    },

    note(text: string) {
      doc.setTextColor(MUTED).setFont("helvetica", "italic").setFontSize(8.2);
      doc.text(doc.splitTextToSize(text, W) as string[], M, y);
      y += 5.5;
    },

    kv(rows: [string, string][], opts: { mono?: boolean } = {}) {
      const labelW = 52;
      const lineH = 4.3;
      for (const [label, value] of rows) {
        doc.setFont(opts.mono ? "courier" : "helvetica", "normal").setFontSize(opts.mono ? 8.2 : 9);
        const lines = doc.splitTextToSize(value, W - labelW) as string[];
        // Keep the label with at least the first lines of its value, then let a
        // long value (e.g. a multi-paragraph description) flow across pages
        // line by line rather than running off the bottom of one.
        ensure(Math.min(lines.length, 3) * lineH + 3.2);
        doc.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(MUTED).text(label.toUpperCase(), M, y + 0.4);
        for (const line of lines.length ? lines : [""]) {
          ensure(lineH + 1);
          doc.setFont(opts.mono ? "courier" : "helvetica", "normal").setFontSize(opts.mono ? 8.2 : 9).setTextColor(INK);
          doc.text(line, M + labelW, y + 0.4);
          y += lineH;
        }
        y += 3.2; // padding below the row
        doc.setDrawColor("#eceef3").setLineWidth(0.2).line(M, y - 1.8, M + W, y - 1.8);
      }
      y += 3;
    },

    /** Milestone table; the status column appears only when rows carry one. */
    milestones(
      rows: { n: number; label: string; share: string; amount: string; status?: string }[],
      opts: { amountHeader: string },
    ) {
      const hasStatus = rows.some((r) => r.status !== undefined);
      const cols = { n: M + 2, label: M + 12, share: M + (hasStatus ? 104 : 116), amount: M + W - (hasStatus ? 38 : 2), status: M + W - 2 };
      ensure(10);
      doc.setFillColor("#eef0f5").rect(M, y - 4, W, 6.4, "F");
      doc.setTextColor(MUTED).setFont("helvetica", "bold").setFontSize(7.4);
      doc.text("#", cols.n, y);
      doc.text("MILESTONE", cols.label, y);
      doc.text("SHARE", cols.share, y, { align: "right" });
      doc.text(opts.amountHeader, cols.amount, y, { align: "right" });
      if (hasStatus) doc.text("STATUS", cols.status, y, { align: "right" });
      y += 5.6;
      for (const r of rows) {
        ensure(7);
        doc.setTextColor(INK).setFont("helvetica", "normal").setFontSize(8.8);
        doc.text(String(r.n), cols.n, y);
        doc.text(doc.splitTextToSize(r.label, 86)[0] as string, cols.label, y);
        doc.text(r.share, cols.share, y, { align: "right" });
        doc.setFont("helvetica", "bold").text(r.amount, cols.amount, y, { align: "right" });
        if (hasStatus) doc.setFont("helvetica", "normal").setTextColor(MUTED).text(r.status ?? "", cols.status, y, { align: "right" });
        y += 4.4;
        doc.setDrawColor("#eceef3").setLineWidth(0.2).line(M, y - 2.5, M + W, y - 2.5);
      }
      y += 5;
    },

    /** Word-wrapped paragraph with a bold lead-in, e.g. "Funding - The buyer deposits...". */
    procedure(lead: string, text: string) {
      const lineH = 4.1;
      doc.setFontSize(8.6);
      const tokens: { word: string; bold: boolean }[] = [
        ...lead.split(" ").map((word) => ({ word, bold: true })),
        ...text.split(" ").map((word) => ({ word, bold: false })),
      ];
      let x = M;
      const lines: { word: string; bold: boolean; x: number }[][] = [[]];
      for (const t of tokens) {
        doc.setFont("helvetica", t.bold ? "bold" : "normal");
        const w = doc.getTextWidth(t.word + " ");
        if (x + w - doc.getTextWidth(" ") > M + W && lines[lines.length - 1].length) {
          lines.push([]);
          x = M;
        }
        lines[lines.length - 1].push({ ...t, x });
        x += w;
      }
      ensure(lines.length * lineH + 3);
      for (const line of lines) {
        for (const t of line) {
          doc.setFont("helvetica", t.bold ? "bold" : "normal").setTextColor(t.bold ? INK : "#2b3245");
          doc.text(t.word, t.x, y);
        }
        y += lineH;
      }
      y += 2.2;
    },

    async qrBlock(url: string, caption: string) {
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: INK, light: "#ffffff" } });
      ensure(46);
      y += 2;
      doc.addImage(qr, "PNG", M, y, 30, 30);
      doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(9).text("Verify on-chain", M + 36, y + 6);
      doc.setTextColor("#2b3245").setFont("helvetica", "normal").setFontSize(8.4);
      doc.text(doc.splitTextToSize(caption, W - 36) as string[], M + 36, y + 11);
      doc.setTextColor(MUTED).setFont("courier", "normal").setFontSize(7.2);
      doc.text(doc.splitTextToSize(url, W - 36) as string[], M + 36, y + 21);
      y += 36;
    },

    /** Disclaimer, then "label | Page x of y" footers on every page; returns the file bytes. */
    finish(disclaimer: string): ArrayBuffer {
      ensure(22);
      doc.setDrawColor(RULE).setLineWidth(0.3).line(M, y, M + W, y);
      y += 4.5;
      doc.setTextColor(MUTED).setFont("helvetica", "normal").setFontSize(7.4);
      doc.text(doc.splitTextToSize(disclaimer, W) as string[], M, y, { lineHeightFactor: 1.35 });
      const pages = doc.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setTextColor("#8a92a6").setFont("helvetica", "normal").setFontSize(7.2);
        doc.text(`PLEDGON  |  ${footerLabel}`, M, PAGE_H - 9);
        doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 9, { align: "right" });
      }
      return doc.output("arraybuffer");
    },
  };
}

const explorerAddressUrl = (base: string, address: string) => `${base.replace(/\/$/, "")}/address/${address}`;

const FUNDING_TEXT =
  "The seller posts the performance bond (if any), then the buyer deposits the full trade value in a single transfer; the buyer's rolling volume must stay within their compliance tier's cap. Before funding, either party can cancel and the seller's bond is returned. If the funding deadline passes unfunded, anyone may expire the vault and the bond returns to the seller. Once funded, the vault can only be unwound through release, settlement or arbitration.";
const DELIVERY_TEXT =
  "For each milestone the seller submits delivery documents (a document hash). The buyer confirms receipt to release that milestone's payment, or it releases automatically once the Chainlink DON verifies the agreed off-chain condition. If the buyer neither confirms nor disputes within the confirmation window, anyone may release the milestone to the seller; if the seller submits nothing within the delivery window, anyone may refund it to the buyer.";
const releaseText = (hasArbiter: boolean) =>
  hasArbiter
    ? "Either party may dispute a milestone; the arbiter then allocates it between buyer and seller and may also forfeit the bond. The parties can bypass arbitration by agreeing a split between themselves, or jointly wind the trade down: every open milestone is refunded to the buyer and any remaining bond returns to the seller. Once every milestone is settled, any remaining bond returns to the seller."
    : "This trade has no arbiter, so a disputed milestone can only be resolved by the parties agreeing a split between themselves, or by jointly winding the trade down: every open milestone is refunded to the buyer and any remaining bond returns to the seller. Once every milestone is settled, any remaining bond returns to the seller.";

const DISCLAIMER_VAULT =
  "This document is an informational summary generated from the on-chain vault state and off-chain descriptions at the time of generation. It is provided for reference and dispute-resolution convenience only and is not itself the binding agreement between the parties - the smart contract deployed at the vault address above is the sole authoritative record of the trade's terms and fund movements.";
const DISCLAIMER_LISTING =
  "This document is an informational summary of a marketplace listing's terms, generated from the on-chain listing state and off-chain descriptions at the time of generation. Remaining quantity and status change as purchases are made. It is provided for reference only and is not itself the binding agreement - the Marketplace contract and the escrow vault opened by each purchase are the sole authoritative record of the terms and fund movements.";

// ─── Trade (escrow vault) ────────────────────────────────

export async function buildContractPdf(model: ContractPdfModel): Promise<{ bytes: ArrayBuffer; filename: string }> {
  const L = await createLayout(model, `Vault ${short(model.vault)}`);
  const hasArbiter = isRealAddress(model.arbiter);
  const { token } = model;
  const money = (amount: bigint) => `${formatAmount(amount, token.decimals)} ${token.symbol}`;

  const subtitle = [model.listing?.title ?? firstLine(model.description), `Vault ${short(model.vault)}`].filter(Boolean).join("  |  ");
  L.header("MILESTONE ESCROW CONTRACT", subtitle);
  L.summaryBoxes([
    ["STATUS", model.status],
    ["SETTLEMENT MODEL", hasArbiter ? "Milestone + arbiter" : "Milestone, no arbiter"],
    ["TRADE VALUE", money(model.totalAmount)],
  ]);

  L.section("PAYMENT TERMS");
  const terms: [string, string][] = [["Trade value", money(model.totalAmount)], ["Payment token", `${token.symbol}  (${short(token.address)})`]];
  const listing = model.listing;
  if (listing) {
    const u = unitName(listing.unit);
    terms.push(["Unit price", u ? `${money(listing.unitPrice)} / ${u}` : money(listing.unitPrice)]);
    if (listing.quantity !== undefined) {
      terms.push(["Quantity", `${formatAmount(listing.quantity, QUANTITY_DECIMALS)}${u ? ` ${u}` : ""}`]);
    }
  }
  const bondPct = model.totalAmount > 0n ? Number((model.bondAmount * 10_000n) / model.totalAmount) / 100 : 0;
  terms.push([
    "Seller performance bond",
    model.bondAmount === 0n
      ? "None"
      : `${money(model.bondAmount)}  (${bondPct}% of trade value)${
          listing && listing.bondRatePerUnit > 0n ? `  -  ${money(listing.bondRatePerUnit)} / ${unitName(listing.unit) || "unit"}` : ""
        }`,
  ]);
  terms.push(["Funding deadline", model.fundingDeadline ? utc(new Date(model.fundingDeadline * 1000)) : "None - the buyer may fund at any time"]);
  terms.push(["Delivery window", model.deliveryWindow ? `${formatDuration(model.deliveryWindow)} after funding` : "None"]);
  terms.push([
    "Confirmation window",
    model.milestoneConfirmWindow ? `${formatDuration(model.milestoneConfirmWindow)} after delivery documents are submitted` : "None",
  ]);
  L.kv(terms);

  L.section("MILESTONE SCHEDULE");
  const total = model.milestones.reduce((s, m) => s + m.amount, 0n);
  L.milestones(
    model.milestones.map((m) => ({
      n: m.index + 1,
      label: m.label,
      share: `${total > 0n ? (Number((m.amount * 10_000n) / total) / 100).toFixed(2) : "0.00"}%`,
      amount: money(m.amount),
      status: m.status,
    })),
    { amountHeader: "AMOUNT" },
  );

  L.section("ESCROW PROCEDURES");
  L.note("Understand this before either party deposits - it describes exactly how funds move on-chain.");
  L.procedure(
    "Creation -",
    "The vault is deployed through the escrow factory with the buyer, seller, optional arbiter, payment token, milestone amounts, seller bond and deadline windows fixed on-chain. No funds move at creation.",
  );
  L.procedure("Funding -", FUNDING_TEXT);
  L.procedure("Delivery & Confirmation -", DELIVERY_TEXT);
  L.procedure("Fund Release & Dispute -", releaseText(hasArbiter));

  L.skip(2);
  L.ensure(64); // keep the whole parties table on one page
  L.section("PARTIES & ADDRESSES");
  L.kv(
    [
      ["Buyer wallet", model.buyer],
      ["Seller wallet", model.seller],
      ["Arbiter", hasArbiter ? model.arbiter! : "None - mutual settlement only"],
      ["Vault address (on-chain)", model.vault],
      ...(model.factory ? ([["Factory address", model.factory]] as [string, string][]) : []),
      ["Payment token address", token.address],
    ],
    { mono: true },
  );

  const descLines: [string, string][] = [];
  if (listing) {
    descLines.push(["Marketplace listing", `#${listing.id}${listing.title ? `  -  ${listing.title}` : ""}`]);
    if (listing.category) descLines.push(["Category", listing.category]);
    if (listing.location) descLines.push(["Location", listing.location]);
    if (listing.conditionNotes) descLines.push(["Condition / delivery", listing.conditionNotes]);
  }
  if (model.description) descLines.push(["Description / terms", model.description]);
  if (descLines.length) {
    L.section("DESCRIPTION / TERMS");
    L.kv(descLines);
  }

  await L.qrBlock(
    explorerAddressUrl(model.explorerBaseUrl, model.vault),
    `Scan to view this vault on ${model.chainName} Etherscan and verify its on-chain state independently.`,
  );
  const bytes = L.finish(DISCLAIMER_VAULT);
  return { bytes, filename: `pledgon-escrow-${model.vault.slice(2, 10).toLowerCase()}.pdf` };
}

// ─── Marketplace listing ─────────────────────────────────

export async function buildListingPdf(model: ListingPdfModel): Promise<{ bytes: ArrayBuffer; filename: string }> {
  const L = await createLayout(model, `Listing #${model.listingId}`);
  const hasArbiter = isRealAddress(model.arbiter);
  const { token } = model;
  const money = (amount: bigint) => `${formatAmount(amount, token.decimals)} ${token.symbol}`;
  const u = unitName(model.unit);
  const perUnit = (amount: bigint) => (u ? `${money(amount)} / ${u}` : money(amount));
  const qty = (q: bigint) => `${formatAmount(q, QUANTITY_DECIMALS)}${u ? ` ${u}` : ""}`;

  // Values if the whole listing were bought — what the vault of a full purchase would hold.
  const fullValue = (model.totalQuantity * model.unitPrice) / QUANTITY_SCALE;
  const fullBond = (model.totalQuantity * model.bondRatePerUnit) / QUANTITY_SCALE;

  L.header("MARKETPLACE LISTING TERMS", [model.title ?? firstLine(model.description), `Listing #${model.listingId}`].filter(Boolean).join("  |  "));
  L.summaryBoxes([
    ["STATUS", model.status],
    ["SETTLEMENT MODEL", hasArbiter ? "Milestone + arbiter" : "Milestone, no arbiter"],
    ["UNIT PRICE", perUnit(model.unitPrice)],
  ]);

  L.section("PAYMENT TERMS");
  L.kv([
    ["Unit price", perUnit(model.unitPrice)],
    ["Quantity offered", qty(model.totalQuantity)],
    ["Quantity remaining", qty(model.remainingQuantity)],
    ["Value of full quantity", money(fullValue)],
    ["Payment token", `${token.symbol}  (${short(token.address)})`],
    [
      "Seller performance bond",
      model.bondRatePerUnit === 0n ? "None" : `${perUnit(model.bondRatePerUnit)}  -  ${money(fullBond)} on the full quantity`,
    ],
    ["Funding deadline", model.fundingWindow ? `${formatDuration(model.fundingWindow)} after a purchase opens its vault` : "None - the buyer may fund at any time"],
    ["Delivery window", model.deliveryWindow ? `${formatDuration(model.deliveryWindow)} after funding` : "None"],
    [
      "Confirmation window",
      model.milestoneConfirmWindow ? `${formatDuration(model.milestoneConfirmWindow)} after delivery documents are submitted` : "None",
    ],
  ]);

  L.section("MILESTONE SCHEDULE");
  L.note("Every purchase is split across these milestones by the same percentages; amounts below are for the full quantity.");
  // Same rounding as the contract: each milestone takes its share, the last takes the remainder.
  let allocated = 0n;
  const rows = model.milestones.map((m, i) => {
    const amount = i === model.milestones.length - 1 ? fullValue - allocated : (fullValue * BigInt(m.bps)) / 10_000n;
    allocated += amount;
    return { n: i + 1, label: m.label, share: `${(m.bps / 100).toFixed(2)}%`, amount: money(amount) };
  });
  L.milestones(rows, { amountHeader: "AMOUNT (FULL QTY)" });

  L.section("ESCROW PROCEDURES");
  L.note("Understand this before buying - it describes exactly how funds move on-chain.");
  L.procedure(
    "Listing -",
    "The seller fixes the unit price, quantity, per-unit bond, milestone split, payment token, arbiter and deadline windows on-chain. Publishing a listing moves no funds. The seller may delist at any time to stop new purchases, and the platform administrator may remove a listing that breaches the terms of use; neither affects trades already opened.",
  );
  L.procedure(
    "Purchase -",
    "A buyer picks any quantity up to what remains and the purchase opens a dedicated escrow vault for it, with the terms above fixed on-chain and the listing's remaining quantity reduced accordingly. No funds move until the vault is funded.",
  );
  L.procedure("Funding -", FUNDING_TEXT);
  L.procedure("Delivery & Confirmation -", DELIVERY_TEXT);
  L.procedure("Fund Release & Dispute -", releaseText(hasArbiter));

  L.skip(2);
  L.ensure(50);
  L.section("PARTIES & ADDRESSES");
  L.kv(
    [
      ["Seller wallet", model.seller],
      ["Arbiter", hasArbiter ? model.arbiter! : "None - mutual settlement only"],
      ["Marketplace contract", model.marketplace],
      ["Payment token address", token.address],
    ],
    { mono: true },
  );

  const descLines: [string, string][] = [];
  if (model.category) descLines.push(["Category", model.category]);
  if (model.location) descLines.push(["Location", model.location]);
  if (model.conditionNotes) descLines.push(["Condition / delivery", model.conditionNotes]);
  if (model.description) descLines.push(["Description / terms", model.description]);
  if (descLines.length) {
    L.section("DESCRIPTION / TERMS");
    L.kv(descLines);
  }

  await L.qrBlock(
    explorerAddressUrl(model.explorerBaseUrl, model.marketplace),
    `Scan to view the Marketplace contract on ${model.chainName} Etherscan. This listing is #${model.listingId} in it.`,
  );
  const bytes = L.finish(DISCLAIMER_LISTING);
  return { bytes, filename: `pledgon-listing-${model.listingId}.pdf` };
}

// ─── Browser helpers ─────────────────────────────────────

function saveBytes(bytes: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Browser: build the trade PDF and trigger a download. */
export async function downloadContractPdf(model: ContractPdfModel): Promise<void> {
  const { bytes, filename } = await buildContractPdf(model);
  saveBytes(bytes, filename);
}

/** Browser: build the listing-terms PDF and trigger a download. */
export async function downloadListingPdf(model: ListingPdfModel): Promise<void> {
  const { bytes, filename } = await buildListingPdf(model);
  saveBytes(bytes, filename);
}

/** Browser: fetch the brand logo as a PNG data URL for the header band. */
export async function loadLogoDataUrl(path = "/logo.png"): Promise<string | undefined> {
  try {
    const blob = await (await fetch(path)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined; // the PDF falls back to a text wordmark
  }
}
