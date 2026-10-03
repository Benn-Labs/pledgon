"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { marketplaceAbi, complianceConsumerAbi } from "@/generated/contracts";
import { addresses, isLendingConfigured } from "@/lib/addresses";
import { useEscrowAttention } from "@/hooks/useEscrowAttention";
import { useTotalValueLocked } from "@/hooks/useTotalValueLocked";
import { useRecentTrades } from "@/hooks/useRecentTrades";
import { useLendingPosition } from "@/hooks/useLendingPosition";
import { formatToken, formatVaultNumber } from "@/lib/format";
import { TradeStatusBadge } from "@/components/ui/badges";
import { TradeProgressBar } from "@/components/ui/TradeProgressBar";
import { CountdownBadge } from "@/components/ui/CountdownBadge";
import { HealthFactorGauge } from "@/components/ui/HealthFactorGauge";
import { TokenAmount } from "@/components/ui/TokenAmount";
import { HomeIcon, MarketplaceIcon, EscrowIcon, LendingIcon, ShieldAlertIcon, SwapIcon, FaucetIcon } from "@/components/ui/icons";

const CLOSED_STATUSES = new Set(["Completed", "Cancelled"]);

function QuickAccessTile({
  href,
  icon,
  iconBg,
  title,
  caption,
  dim = false,
}: {
  href: string;
  icon: ReactNode;
  iconBg: string;
  title: string;
  caption: ReactNode;
  dim?: boolean;
}) {
  return (
    <Link href={href} className={`deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5 ${dim ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>
        <svg className="w-4 h-4 text-ink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="font-semibold text-white">{title}</div>
      <div className="text-sm text-ink-300 mt-0.5">{caption}</div>
    </Link>
  );
}

export default function DashboardPage() {
  const { address: account, isConnected } = useAccount();
  const { activeCount, attentionCount, isLoading: attentionLoading } = useEscrowAttention();
  const { escrow: escrowTvl, lendingCollateral, lendingLiquidity, isLoading: tvlLoading } = useTotalValueLocked();
  const { trades: recentTrades, isLoading: recentLoading } = useRecentTrades(10);
  const lending = useLendingPosition();
  const [tradeTab, setTradeTab] = useState<"active" | "closed">("active");

  const { data: listingCount } = useReadContract({
    address: addresses.marketplace,
    abi: marketplaceAbi,
    functionName: "listingCount",
    query: { enabled: Boolean(addresses.marketplace) },
  });

  const { data: tier } = useReadContract({
    address: addresses.complianceConsumer,
    abi: complianceConsumerAbi,
    functionName: "tierOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(addresses.complianceConsumer && account) },
  });

  const activeTrades = useMemo(() => recentTrades.filter((t) => !CLOSED_STATUSES.has(t.status)), [recentTrades]);
  const closedTrades = useMemo(() => recentTrades.filter((t) => CLOSED_STATUSES.has(t.status)), [recentTrades]);
  const visibleTrades = tradeTab === "active" ? activeTrades : closedTrades;

  if (!isConnected) {
    return (
      <div className="fade-in max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-display text-white mb-2">Welcome to PLEDGON</h1>
        <p className="text-ink-400">
          Milestone escrow, independently verified — connect a wallet to browse the marketplace, view your active
          trades, and see your compliance standing.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <p className="text-[11px] font-bold text-ink-400 uppercase tracking-[0.09em] mb-1">Overview</p>
          <h1 className="text-3xl font-display text-white">Dashboard</h1>
          <p className="text-ink-400 mt-1">
            {account?.slice(0, 6)}…{account?.slice(-4)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/escrow/create"
            className="btn-press px-4 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold glow-trust flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Escrow
          </Link>
          <Link
            href="/marketplace/create"
            className="btn-press px-4 py-2.5 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-white text-sm font-semibold flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Listing
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Link href="/escrow" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="w-9 h-9 rounded-lg bg-trust-500/15 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-trust-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4l8 4-8 4-8-4 8-4zm-8 8l8 4 8-4M4 16l8 4 8-4" />
              </svg>
            </div>
            <span className="text-xs font-bold text-ink-400 uppercase tracking-wider">Active Trades</span>
          </div>
          <div className="text-5xl font-extrabold text-white">
            {attentionLoading ? <span className="block h-10 w-14 rounded bg-ink-800 animate-pulse" /> : activeCount}
          </div>
          {!attentionLoading && activeCount === 0 && <div className="text-sm text-ink-300 mt-1">No trades in progress</div>}
        </Link>
        <Link
          href="/escrow"
          className={`deal-card block rounded-xl p-5 border ${
            attentionCount > 0 ? "bg-warning-500/10 border-warning-500/30" : "bg-ink-900 border-ink-800"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                attentionCount > 0 ? "bg-warning-500/15" : "bg-success-500/15"
              }`}
            >
              {attentionCount > 0 ? (
                <svg className="w-4 h-4 text-warning-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-success-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <span className={`text-xs font-bold uppercase tracking-wider ${attentionCount > 0 ? "text-warning-400" : "text-ink-400"}`}>
              Needs Attention
            </span>
          </div>
          <div className={`text-5xl font-extrabold ${attentionCount > 0 ? "text-warning-400" : "text-white"}`}>
            {attentionLoading ? <span className="block h-10 w-14 rounded bg-ink-800 animate-pulse" /> : attentionCount}
          </div>
          {!attentionLoading && attentionCount === 0 && <div className="text-sm text-ink-300 mt-1">You&apos;re all caught up</div>}
        </Link>
        <Link href="/marketplace" className="deal-card block bg-ink-900 border border-ink-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="w-9 h-9 rounded-lg bg-warning-500/15 flex items-center justify-center shrink-0">
              <HomeIcon className="w-4 h-4 text-warning-400" />
            </div>
            <span className="text-xs font-bold text-ink-400 uppercase tracking-wider">Marketplace Listings</span>
          </div>
          <div className="text-5xl font-extrabold text-white">{listingCount?.toString() ?? "…"}</div>
          {listingCount === 0n && <div className="text-sm text-ink-300 mt-1">Nothing listed yet</div>}
        </Link>
      </div>

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-trust-500/15 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-trust-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4l8 4-8 4-8-4 8-4zm-8 8l8 4 8-4M4 16l8 4 8-4"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Total Value Locked</h2>
            <p className="text-sm text-ink-400">Real on-chain balances, grouped by what the value actually is</p>
          </div>
        </div>

        {tvlLoading ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : (
          <div className="border-t border-ink-800 pt-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-ink-400 uppercase tracking-wider mb-3">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                Escrow Vaults
              </div>
              {escrowTvl.length === 0 ? (
                <div className="rounded-lg border border-ink-800 py-8 px-4 flex flex-col items-center text-center">
                  <svg className="w-7 h-7 text-ink-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 8l3-5h12l3 5m-18 0v10a1 1 0 001 1h14a1 1 0 001-1V8m-18 0h18M9 12h6"
                    />
                  </svg>
                  <p className="text-white font-semibold">Nothing in escrow yet</p>
                  <p className="text-xs text-ink-500 mt-1">Held until milestones release it.</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {escrowTvl.map((t) => (
                    <div key={t.token} className="px-4 py-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                      <TokenAmount amount={t.amount} decimals={t.decimals} symbol={t.symbol} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(lendingCollateral || lendingLiquidity) && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-ink-400 uppercase tracking-wider mb-3">
                  <LendingIcon className="w-3.5 h-3.5" />
                  Lending Pool
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {lendingCollateral && (
                    <div className="px-4 py-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                      <div className="flex items-center gap-1.5 text-xs text-ink-400 mb-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-warning-400 shrink-0" />
                        Collateral Deposited
                      </div>
                      <TokenAmount amount={lendingCollateral.amount} decimals={lendingCollateral.decimals} symbol={lendingCollateral.symbol} />
                    </div>
                  )}
                  {lendingLiquidity && (
                    <div className="px-4 py-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                      <div className="flex items-center gap-1.5 text-xs text-ink-400 mb-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-trust-400 shrink-0" />
                        Available to Borrow
                      </div>
                      <TokenAmount amount={lendingLiquidity.amount} decimals={lendingLiquidity.decimals} symbol={lendingLiquidity.symbol} />
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-ink-800/30 border border-ink-800">
                  <svg className="w-3.5 h-3.5 text-ink-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-ink-500">Different assets — never combined into one figure.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isLendingConfigured && (
        <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-warning-500/15 flex items-center justify-center shrink-0">
              <LendingIcon className="w-5 h-5 text-warning-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white">Lending Position</h2>
              <p className="text-sm text-ink-400">Your collateral, debt, and liquidation-protection standing.</p>
            </div>
          </div>

          {!lending.hasPosition ? (
            <p className="text-sm text-ink-400">No open position yet — deposit collateral on the Lending page to get started.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-3">
                <div className="col-span-2 p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] flex flex-col items-center justify-center">
                  <div className="flex items-center gap-1.5 text-xs text-ink-400 uppercase tracking-wider font-bold mb-1 self-start">
                    <ShieldAlertIcon className="w-3.5 h-3.5 text-success-400" />
                    Health Factor
                  </div>
                  <HealthFactorGauge
                    hasDebt={lending.debtAmount > 0n}
                    hasPrice={lending.hasPrice}
                    ltvBps={lending.ltvBps}
                    liquidationThresholdBps={lending.liquidationThresholdBps}
                    healthFactor={lending.healthFactor}
                  />
                </div>
                <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                  <div className="text-xs text-ink-400 mb-1.5">Collateral</div>
                  {lending.collDecimals !== undefined ? (
                    <TokenAmount
                      amount={lending.collateralAmount}
                      decimals={lending.collDecimals}
                      symbol={lending.collSymbol}
                      className="text-sm font-bold text-white"
                    />
                  ) : (
                    <span className="text-sm text-ink-500">…</span>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                  <div className="text-xs text-ink-400 mb-1.5">Debt</div>
                  {lending.debtDecimals !== undefined ? (
                    <TokenAmount
                      amount={lending.debtAmount}
                      decimals={lending.debtDecimals}
                      symbol={lending.debtSymbol}
                      maxDecimals={2}
                      className="text-sm font-bold text-white"
                    />
                  ) : (
                    <span className="text-sm text-ink-500">…</span>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                  <div className="text-xs text-ink-400 mb-1.5">Liq. Threshold</div>
                  <div className="text-sm font-bold text-white">
                    {lending.liquidationThresholdBps !== undefined ? `${Number(lending.liquidationThresholdBps) / 100}%` : "…"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                  <div className="text-xs text-ink-400 mb-1.5">Current LTV</div>
                  <div className="text-sm font-bold text-white">
                    {lending.debtAmount === 0n ? "0%" : lending.ltvBps !== undefined ? `${Number(lending.ltvBps) / 100}%` : "—"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-ink-950/60 border border-ink-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
                  <div className="text-xs text-ink-400 mb-1.5">Est. Liq. Price</div>
                  <div className="text-sm font-bold text-white">
                    {lending.debtAmount === 0n
                      ? "N/A"
                      : lending.liquidationPrice !== undefined
                        ? `${(Number(lending.liquidationPrice) / 10 ** lending.priceDecimals).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${lending.debtSymbol ?? ""}`
                        : "—"}
                  </div>
                </div>
              </div>

              {!lending.hasPrice && lending.debtAmount > 0n && (
                <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
                  <svg className="w-3.5 h-3.5 text-warning-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-warning-400">Needs a live price feed to show real figures — none has reported yet.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-ink-800/60">
            <button
              onClick={() => setTradeTab("active")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tradeTab === "active" ? "bg-ink-700 text-white" : "text-ink-400 hover:text-white"
              }`}
            >
              Active ({activeTrades.length})
            </button>
            <button
              onClick={() => setTradeTab("closed")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tradeTab === "closed" ? "bg-ink-700 text-white" : "text-ink-400 hover:text-white"
              }`}
            >
              Closed ({closedTrades.length})
            </button>
          </div>
          <Link href="/escrow" className="flex items-center gap-0.5 text-sm text-trust-400 hover:text-trust-300 font-medium">
            View all
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        {recentLoading ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : visibleTrades.length === 0 ? (
          <div className="rounded-lg border border-ink-800 py-10 px-4 flex flex-col items-center text-center">
            <svg className="w-8 h-8 text-ink-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 8l3-5h12l3 5m-18 0v10a1 1 0 001 1h14a1 1 0 001-1V8m-18 0h18M9 12h6"
              />
            </svg>
            <p className="text-white font-semibold">{tradeTab === "active" ? "No active trades" : "No closed trades yet"}</p>
            {tradeTab === "active" && (
              <>
                <p className="text-sm text-ink-400 mt-1">Create an escrow or purchase a listing to get started.</p>
                <div className="flex gap-2 mt-4">
                  <Link
                    href="/escrow/create"
                    className="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold"
                  >
                    Create Escrow
                  </Link>
                  <Link
                    href="/marketplace"
                    className="btn-press px-4 py-2 rounded-lg bg-ink-800 hover:bg-ink-700 border border-ink-700 text-white text-sm font-semibold"
                  >
                    Browse Marketplace
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleTrades.map((t) => (
              <Link
                key={t.vault}
                href={`/escrow/${t.vault}`}
                className="deal-card block p-3 rounded-lg bg-ink-800/40 border border-ink-700"
              >
                <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-500 font-mono">{formatVaultNumber(t.index)}</span>
                    <span className="text-xs text-ink-400 capitalize">{t.role}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.currentDeadline && <CountdownBadge deadline={t.currentDeadline.deadline} label={t.currentDeadline.label} />}
                    <TradeStatusBadge status={t.status} size="sm" />
                  </div>
                </div>
                {(t.listingTitle || t.description) && (
                  <p className="text-xs text-ink-500 mb-2 line-clamp-1">{t.listingTitle || t.description}</p>
                )}
                <TradeProgressBar progress={t.progress} />
                {t.decimals !== undefined && (
                  <div className="flex justify-between text-xs mt-2 pt-2 border-t border-ink-800/60">
                    <span className="text-ink-500">Trade Value</span>
                    <span className="font-mono text-ink-300">{formatToken(t.totalAmount, t.decimals, t.symbol)}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAccessTile
          href="/marketplace"
          icon={<MarketplaceIcon className="w-4 h-4 text-warning-400" />}
          iconBg="bg-warning-500/15"
          title="Marketplace"
          caption={listingCount !== undefined ? `${listingCount.toString()} listing${listingCount === 1n ? "" : "s"}` : "Browse & create listings"}
        />
        <QuickAccessTile
          href="/escrow"
          icon={<EscrowIcon className="w-4 h-4 text-success-400" />}
          iconBg="bg-success-500/15"
          title="Escrow"
          caption={
            <>
              {activeCount} active trade{activeCount === 1 ? "" : "s"}
              {attentionCount > 0 && <span className="text-warning-400"> · {attentionCount} need attention</span>}
            </>
          }
        />
        <QuickAccessTile
          href="/lending"
          icon={<LendingIcon className="w-4 h-4 text-warning-400" />}
          iconBg="bg-warning-500/15"
          title="Lending"
          dim={!isLendingConfigured}
          caption={
            !isLendingConfigured
              ? "Not deployed yet"
              : !lending.hasPosition
                ? "No open position — deposit to get started"
                : `Collateral ${lending.collDecimals !== undefined ? formatToken(lending.collateralAmount, lending.collDecimals, lending.collSymbol) : "…"} · Debt ${
                    lending.debtDecimals !== undefined ? formatToken(lending.debtAmount, lending.debtDecimals, lending.debtSymbol) : "…"
                  }`
          }
        />
        <QuickAccessTile
          href="/compliance"
          icon={<ShieldAlertIcon className="w-4 h-4 text-trust-400" />}
          iconBg="bg-trust-500/15"
          title="Compliance"
          caption={tier !== undefined ? `Tier ${tier} · your KYC tier & caps` : "Your KYC tier & caps"}
        />
        <QuickAccessTile
          href="/swap"
          icon={<SwapIcon className="w-4 h-4 text-trust-400" />}
          iconBg="bg-trust-500/15"
          title="Swap"
          caption="Trade real, liquid assets"
        />
        <QuickAccessTile
          href="/faucet"
          icon={<FaucetIcon className="w-4 h-4 text-success-400" />}
          iconBg="bg-success-500/15"
          title="Faucet"
          caption="Mint testnet tokens"
        />
      </div>
    </div>
  );
}
