/**
 * Escrow contract summary PDF — the core payment terms fixed when a trade (or
 * the marketplace listing it was bought from) was created, laid out like the
 * reference Garantor vault document: brand header, title, three summary
 * boxes, the terms, how funds move, parties/addresses, and a QR code to the
 * on-chain vault.
 *
 * Deliberately self-contained (only relative imports, no app aliases) and fed
 * a plain data model, so the same function runs in the browser (the vault
 * page's download button) and under Node (smoke tests). The heavy PDF/QR
 * libraries are imported dynamically — nothing is added to the page bundle
 * until someone actually asks for a PDF.
 *
 * The PDF is an informational summary only; the deployed vault contract is the
 * sole authoritative record (the footer says so).
 */
import { formatUnits } from "viem";

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

export interface ContractPdfModel {
  generatedAt: Date;
  chainName: string;
  explorerBaseUrl: string;
  vault: string;
  factory?: string;
  status: string;
  token: { address: string; symbol: string; decimals: number };
  totalAmount: bigint;
  bondAmount: bigint;
  buyer: string;
  seller: string;
  /** undefined / zero address = no arbiter (mutual settlement only). */
  arbiter?: string;
  description?: string;
  listing?: ContractPdfListing;
  milestones: ContractPdfMilestone[];
  /** Absolute unix seconds; 0 / undefined = no funding deadline. */
  fundingDeadline?: number;
  /** Seconds; 0 = no window. */
  milestoneConfirmWindow: number;
  deliveryWindow: number;
  /** PNG data URL of the (white-wordmark) logo — drawn on the dark header band. */
  logoDataUrl?: string;
}

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

// Palette: dark brand band + warm summary boxes, like the reference sheet.
const INK = "#0b1020";
const MUTED = "#5b6478";
const BAND = "#05070c";
const BOX_BG = "#f6f1e9";
const BOX_LINE = "#e6dccb";
const RULE = "#dcdfe6";

export async function buildContractPdf(model: ContractPdfModel): Promise<{ bytes: ArrayBuffer; filename: string }> {
  const [{ jsPDF }, QRCode] = await Promise.all([import("jspdf"), import("qrcode").then((m) => m.default ?? m)]);

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const M = 16; // side margin
  const W = PAGE_W - M * 2;
  const FOOT = 16; // reserved bottom space
  let y = 0;

  const hasArbiter = Boolean(model.arbiter) && model.arbiter!.toLowerCase() !== ZERO;
  const { token } = model;
  const money = (amount: bigint) => `${formatAmount(amount, token.decimals)} ${token.symbol}`;

  // ── page chrome ────────────────────────────────────────
  function band(tall: boolean) {
    const h = tall ? 24 : 12;
    doc.setFillColor(BAND);
    doc.rect(0, 0, PAGE_W, h, "F");
    if (model.logoDataUrl) {
      const logoH = tall ? 10 : 6;
      doc.addImage(model.logoDataUrl, "PNG", M, (h - logoH) / 2, logoH * (720 / 145), logoH);
    } else {
      doc.setTextColor("#ffffff").setFont("helvetica", "bold").setFontSize(tall ? 14 : 10).text("PLEDGON", M, h / 2 + 1.5);
    }
    if (tall) {
      doc.setTextColor("#9aa3b8").setFont("helvetica", "normal").setFontSize(8);
      doc.text(`${model.chainName} | Generated ${utc(model.generatedAt)}`, PAGE_W - M, h / 2 + 1, { align: "right" });
    }
    return h;
  }

  function newPage() {
    doc.addPage();
    y = band(false) + 10;
  }

  function ensure(h: number) {
    if (y + h > PAGE_H - FOOT) newPage();
  }

  function sectionTitle(text: string) {
    ensure(14);
    doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(10.5).text(text, M, y);
    y += 2;
    doc.setDrawColor(RULE).setLineWidth(0.3).line(M, y, M + W, y);
    y += 5;
  }

  /** Word-wrapped paragraph with a bold lead-in, e.g. "Funding - The buyer deposits...". */
  function procedure(lead: string, text: string) {
    const size = 8.6;
    const lineH = 4.1;
    doc.setFontSize(size);
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
  }

  function kvTable(rows: [string, string][], opts: { mono?: boolean } = {}) {
    const labelW = 52;
    const lineH = 4.3;
    for (const [label, value] of rows) {
      doc.setFont(opts.mono ? "courier" : "helvetica", "normal").setFontSize(opts.mono ? 8.2 : 9);
      const lines = doc.splitTextToSize(value, W - labelW) as string[];
      const h = Math.max(lines.length * lineH, lineH) + 3.2;
      ensure(h);
      doc.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(MUTED).text(label.toUpperCase(), M, y + 0.4);
      doc.setFont(opts.mono ? "courier" : "helvetica", "normal").setFontSize(opts.mono ? 8.2 : 9).setTextColor(INK);
      doc.text(lines, M + labelW, y + 0.4);
      y += h;
      doc.setDrawColor("#eceef3").setLineWidth(0.2).line(M, y - 1.8, M + W, y - 1.8);
    }
    y += 3;
  }

  // ── page 1 header ──────────────────────────────────────
  y = band(true) + 11;
  doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(17).text("MILESTONE ESCROW CONTRACT", M, y);
  y += 6;
  doc.setTextColor(MUTED).setFont("helvetica", "normal").setFontSize(8.8);
  const subtitle = [model.listing?.title ?? firstLine(model.description), `Vault ${short(model.vault)}`].filter(Boolean).join("  |  ");
  doc.text(doc.splitTextToSize(subtitle, W)[0] as string, M, y);
  y += 7;

  // Summary boxes
  const boxes: [string, string][] = [
    ["STATUS", model.status],
    ["SETTLEMENT MODEL", hasArbiter ? "Milestone + arbiter" : "Milestone, no arbiter"],
    ["TRADE VALUE", money(model.totalAmount)],
  ];
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

  // ── payment terms (the core) ───────────────────────────
  sectionTitle("PAYMENT TERMS");
  const terms: [string, string][] = [["Trade value", money(model.totalAmount)], ["Payment token", `${token.symbol}  (${short(token.address)})`]];
  const L = model.listing;
  if (L) {
    const perUnit = (amount: bigint) => {
      const u = unitName(L.unit);
      return u ? `${money(amount)} / ${u}` : money(amount);
    };
    terms.push(["Unit price", perUnit(L.unitPrice)]);
    if (L.quantity !== undefined) {
      const u = unitName(L.unit);
      terms.push(["Quantity", `${formatAmount(L.quantity, QUANTITY_DECIMALS)}${u ? ` ${u}` : ""}`]);
    }
  }
  const bondPct = model.totalAmount > 0n ? Number((model.bondAmount * 10_000n) / model.totalAmount) / 100 : 0;
  terms.push([
    "Seller performance bond",
    model.bondAmount === 0n
      ? "None"
      : `${money(model.bondAmount)}  (${bondPct}% of trade value)${
          L && L.bondRatePerUnit > 0n ? `  -  ${money(L.bondRatePerUnit)} / ${unitName(L.unit) || "unit"}` : ""
        }`,
  ]);
  terms.push([
    "Funding deadline",
    model.fundingDeadline ? utc(new Date(model.fundingDeadline * 1000)) : "None - the buyer may fund at any time",
  ]);
  terms.push(["Delivery window", model.deliveryWindow ? `${formatDuration(model.deliveryWindow)} after funding` : "None"]);
  terms.push([
    "Confirmation window",
    model.milestoneConfirmWindow ? `${formatDuration(model.milestoneConfirmWindow)} after delivery documents are submitted` : "None",
  ]);
  kvTable(terms);

  // ── milestone schedule ─────────────────────────────────
  sectionTitle("MILESTONE SCHEDULE");
  const cols = { n: M + 2, label: M + 12, share: M + 104, amount: M + W - 38, status: M + W - 2 };
  ensure(10);
  doc.setFillColor("#eef0f5").rect(M, y - 4, W, 6.4, "F");
  doc.setTextColor(MUTED).setFont("helvetica", "bold").setFontSize(7.4);
  doc.text("#", cols.n, y);
  doc.text("MILESTONE", cols.label, y);
  doc.text("SHARE", cols.share, y, { align: "right" });
  doc.text("AMOUNT", cols.amount, y, { align: "right" });
  doc.text("STATUS", cols.status, y, { align: "right" });
  y += 5.6;
  const total = model.milestones.reduce((s, m) => s + m.amount, 0n);
  for (const m of model.milestones) {
    ensure(7);
    const pct = total > 0n ? (Number((m.amount * 10_000n) / total) / 100).toFixed(2) : "0.00";
    doc.setTextColor(INK).setFont("helvetica", "normal").setFontSize(8.8);
    doc.text(String(m.index + 1), cols.n, y);
    doc.text(doc.splitTextToSize(m.label, 86)[0] as string, cols.label, y);
    doc.text(`${pct}%`, cols.share, y, { align: "right" });
    doc.setFont("helvetica", "bold").text(money(m.amount), cols.amount, y, { align: "right" });
    doc.setFont("helvetica", "normal").setTextColor(MUTED).text(m.status, cols.status, y, { align: "right" });
    y += 4.4;
    doc.setDrawColor("#eceef3").setLineWidth(0.2).line(M, y - 2.5, M + W, y - 2.5);
  }
  y += 5;

  // ── escrow procedures ──────────────────────────────────
  sectionTitle("ESCROW PROCEDURES");
  doc.setTextColor(MUTED).setFont("helvetica", "italic").setFontSize(8.2);
  doc.text("Understand this before either party deposits - it describes exactly how funds move on-chain.", M, y);
  y += 5.5;
  procedure(
    "Creation -",
    "The vault is deployed through the escrow factory with the buyer, seller, optional arbiter, payment token, milestone amounts, seller bond and deadline windows fixed on-chain. No funds move at creation.",
  );
  procedure(
    "Funding -",
    "The seller posts the performance bond (if any), then the buyer deposits the full trade value in a single transfer; the buyer's rolling volume must stay within their compliance tier's cap. Before funding, either party can cancel and the seller's bond is returned. If the funding deadline passes unfunded, anyone may expire the vault and the bond returns to the seller. Once funded, the vault can only be unwound through release, settlement or arbitration.",
  );
  procedure(
    "Delivery & Confirmation -",
    "For each milestone the seller submits delivery documents (a document hash). The buyer confirms receipt to release that milestone's payment, or it releases automatically once the Chainlink DON verifies the agreed off-chain condition. If the buyer neither confirms nor disputes within the confirmation window, anyone may release the milestone to the seller; if the seller submits nothing within the delivery window, anyone may refund it to the buyer.",
  );
  procedure(
    "Fund Release & Dispute -",
    hasArbiter
      ? "Either party may dispute a milestone; the arbiter then allocates it between buyer and seller and may also forfeit the bond. The parties can bypass arbitration by agreeing a split between themselves, or jointly wind the trade down: every open milestone is refunded to the buyer and any remaining bond returns to the seller. Once every milestone is settled, any remaining bond returns to the seller."
      : "This trade has no arbiter, so a disputed milestone can only be resolved by the parties agreeing a split between themselves, or by jointly winding the trade down: every open milestone is refunded to the buyer and any remaining bond returns to the seller. Once every milestone is settled, any remaining bond returns to the seller.",
  );

  // ── parties & addresses ────────────────────────────────
  y += 2;
  ensure(64); // keep the whole table on one page
  sectionTitle("PARTIES & ADDRESSES");
  kvTable(
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

  // ── description / terms ────────────────────────────────
  const descLines: [string, string][] = [];
  if (L) {
    descLines.push(["Marketplace listing", `#${L.id}${L.title ? `  -  ${L.title}` : ""}`]);
    if (L.category) descLines.push(["Category", L.category]);
    if (L.location) descLines.push(["Location", L.location]);
    if (L.conditionNotes) descLines.push(["Condition / delivery", L.conditionNotes]);
  }
  if (model.description) descLines.push(["Description / terms", model.description]);
  if (descLines.length) {
    sectionTitle("DESCRIPTION / TERMS");
    kvTable(descLines);
  }

  // ── on-chain verification ──────────────────────────────
  const url = `${model.explorerBaseUrl.replace(/\/$/, "")}/address/${model.vault}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: INK, light: "#ffffff" } });
  ensure(46);
  y += 2;
  doc.addImage(qr, "PNG", M, y, 30, 30);
  doc.setTextColor(INK).setFont("helvetica", "bold").setFontSize(9).text("Verify on-chain", M + 36, y + 6);
  doc.setTextColor("#2b3245").setFont("helvetica", "normal").setFontSize(8.4);
  doc.text(
    doc.splitTextToSize(
      `Scan to view this vault on ${model.chainName} Etherscan and verify its on-chain state independently.`,
      W - 36,
    ) as string[],
    M + 36,
    y + 11,
  );
  doc.setTextColor(MUTED).setFont("courier", "normal").setFontSize(7.2);
  doc.text(doc.splitTextToSize(url, W - 36) as string[], M + 36, y + 21);
  y += 36;

  // ── disclaimer + footers on every page ─────────────────
  ensure(22);
  doc.setDrawColor(RULE).setLineWidth(0.3).line(M, y, M + W, y);
  y += 4.5;
  doc.setTextColor(MUTED).setFont("helvetica", "normal").setFontSize(7.4);
  doc.text(
    doc.splitTextToSize(
      "This document is an informational summary generated from the on-chain vault state and off-chain descriptions at the time of generation. It is provided for reference and dispute-resolution convenience only and is not itself the binding agreement between the parties - the smart contract deployed at the vault address above is the sole authoritative record of the trade's terms and fund movements.",
      W,
    ) as string[],
    M,
    y,
    { lineHeightFactor: 1.35 },
  );

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setTextColor("#8a92a6").setFont("helvetica", "normal").setFontSize(7.2);
    doc.text(`PLEDGON  |  Vault ${short(model.vault)}`, M, PAGE_H - 9);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 9, { align: "right" });
  }

  return { bytes: doc.output("arraybuffer"), filename: `pledgon-escrow-${model.vault.slice(2, 10).toLowerCase()}.pdf` };
}

function firstLine(text?: string): string | undefined {
  const line = text?.split("\n").find((l) => l.trim());
  return line ? (line.length > 90 ? `${line.slice(0, 87)}...` : line) : undefined;
}

/** Browser: build the PDF and trigger a download. */
export async function downloadContractPdf(model: ContractPdfModel): Promise<void> {
  const { bytes, filename } = await buildContractPdf(model);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
